import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { runBd } from "./bd";
import { clearProject } from "./cache";
import { listIssues } from "./issues";
import { ensureServe, isServerMode, stopServe } from "./serve";

// Follows the events journal (beads 1.3+, opt-in) for projects whose board is
// open, and clears their cache on every journal record. Server-mode projects
// read it from their `bd serve` (`events:watch`); everything else, or a serve
// that won't start, runs `bd events tail --follow`. While a feed is live,
// routes can cache bd output for WATCHED_TTL_MS instead of re-running bd on
// every poll, and subscribed boards are pushed a "change" instead of polling.
// Changes the journal doesn't record (syncs, `bd sql`, defer dates passing)
// are caught by re-checking subscribed projects every SWEEP_MS, and by the TTL
// for boards that still poll.

export const WATCHED_TTL_MS = 15_000;
const IDLE_MS = 60_000;
const RETRY_MS = 60_000;
const SWEEP_MS = 15_000;
const CHANGE_DEBOUNCE_MS = 100;

export type WatchEvent = "live" | "polling" | "change";
type Listener = (event: WatchEvent) => void;

type Watcher = {
  state: "off" | "starting" | "live";
  // Ends the running feed (kills the follower or aborts the stream).
  stopFeed: (() => void) | null;
  lastSeq: number;
  lastUsed: number;
  retryAt: number;
  listeners: Set<Listener>;
  changeTimer: NodeJS.Timeout | null;
  // bd output from the last re-check; null until the next one sets a baseline.
  snapshot: string | null;
  checking: boolean;
};

const watchers = new Map<string, Watcher>();
let sweeper: NodeJS.Timeout | null = null;

// Followers are long-lived children: never leave them behind.
process.once("exit", stopAllWatchers);

function getWatcher(path: string): Watcher {
  let watcher = watchers.get(path);
  if (!watcher) {
    watcher = {
      state: "off",
      stopFeed: null,
      lastSeq: 0,
      lastUsed: 0,
      retryAt: 0,
      listeners: new Set(),
      changeTimer: null,
      snapshot: null,
      checking: false,
    };
    watchers.set(path, watcher);
  }
  return watcher;
}

// Marks the project's board as in use and starts following its journal if
// needed. Returns true when a feed is live, so callers can cache longer.
export function watchProject(path: string): boolean {
  const watcher = getWatcher(path);
  watcher.lastUsed = Date.now();
  // Server-mode boards read through bd serve even when the journal is off.
  if (isServerMode(path)) void ensureServe(path);
  if (watcher.state === "live") return true;
  if (watcher.state === "off" && Date.now() >= watcher.retryAt) {
    watcher.state = "starting";
    ensureSweeper();
    void start(path, watcher);
  }
  return false;
}

// Like watchProject, but never starts a feed or keeps one alive.
export function isWatched(path: string): boolean {
  return watchers.get(path)?.state === "live";
}

// Pushes "live" or "polling" (now and on every switch) and "change" whenever
// the project changes while live. The feed stays up while anyone listens.
export function subscribe(path: string, listener: Listener): () => void {
  const watcher = getWatcher(path);
  watcher.listeners.add(listener);
  listener(watchProject(path) ? "live" : "polling");
  return () => {
    watcher.listeners.delete(listener);
    watcher.lastUsed = Date.now();
  };
}

export function stopAllWatchers(): void {
  for (const [path, watcher] of watchers) stop(path, watcher);
  watchers.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

function notify(watcher: Watcher, event: WatchEvent): void {
  for (const listener of watcher.listeners) listener(event);
}

function changed(path: string, watcher: Watcher): void {
  clearProject(path);
  if (watcher.changeTimer) return;
  // Coalesce bursts (a replayed backlog, a multi-issue close) into one push.
  watcher.changeTimer = setTimeout(() => {
    watcher.changeTimer = null;
    notify(watcher, "change");
  }, CHANGE_DEBOUNCE_MS);
}

// Applies one journal record: advance the checkpoint, then report a change.
function recorded(path: string, watcher: Watcher, seq: unknown): void {
  if (typeof seq === "number" && seq > watcher.lastSeq) watcher.lastSeq = seq;
  watcher.snapshot = null;
  changed(path, watcher);
}

async function start(path: string, watcher: Watcher): Promise<void> {
  try {
    const data = (await runBd(["config", "get", "events-journal"], path)) as { value?: string } | null;
    if (data?.value !== "true") throw new Error("events journal is off");
  } catch {
    watcher.state = "off";
    watcher.retryAt = Date.now() + RETRY_MS;
    return;
  }
  if (watcher.state !== "starting") return; // stopped while checking

  const stream = isServerMode(path) ? await openServeStream(path, watcher) : null;
  if (watcher.state !== "starting") {
    stream?.controller.abort();
    return;
  }
  if (stream) followServe(path, watcher, stream.response, stream.controller);
  else followTail(path, watcher);
}

// Marks the feed live; `end` is called when it stops on its own.
function goLive(path: string, watcher: Watcher, stopFeed: () => void): (truncated: boolean) => void {
  watcher.stopFeed = stopFeed;
  watcher.state = "live";
  watcher.snapshot = null;
  notify(watcher, "live");
  return (truncated) => {
    if (watcher.stopFeed !== stopFeed) return;
    watcher.stopFeed = null;
    watcher.state = "off";
    watcher.retryAt = Date.now() + RETRY_MS;
    // The checkpoint fell out of retention: start over from the beginning.
    if (truncated) watcher.lastSeq = 0;
    clearProject(path);
    notify(watcher, "polling");
  };
}

function followTail(path: string, watcher: Watcher): void {
  const beadsBin = process.env.BEADS_BIN ?? "bd";
  const args = ["events", "tail", "--since", String(watcher.lastSeq), "--follow", "--json"];
  const child = spawn(/* turbopackIgnore: true */ beadsBin, args, { cwd: path, stdio: ["ignore", "pipe", "pipe"] });
  const end = goLive(path, watcher, () => child.kill());

  let truncated = false;
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let record: { seq?: unknown; code?: unknown };
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.code === "events_journal_truncated") truncated = true;
    else recorded(path, watcher, record.seq);
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("events_journal_truncated")) truncated = true;
  });
  child.on("error", () => end(truncated));
  child.on("close", () => end(truncated));
}

// Opens `events:watch` on the project's bd serve, or returns null to fall back
// to the CLI follower.
async function openServeStream(
  path: string,
  watcher: Watcher,
): Promise<{ response: Response; controller: AbortController } | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = await ensureServe(path);
    if (!url) return null;
    const controller = new AbortController();
    try {
      const response = await fetch(`${url}/v0/beads/events:watch?since=${watcher.lastSeq}`, {
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (response.ok && response.body) return { response, controller };
      controller.abort();
      if (response.status === 410) watcher.lastSeq = 0; // checkpoint pruned: replay what's retained
      else if (response.status === 409) stopServe(path); // serve predates the journal: restart it
      else return null;
    } catch {
      return null;
    }
  }
  return null;
}

function followServe(path: string, watcher: Watcher, response: Response, controller: AbortController): void {
  const end = goLive(path, watcher, () => controller.abort());
  let truncated = false;

  // Each SSE event is a block of `field: value` lines ended by a blank line:
  // `id` carries the seq, `data` the record, `event: truncated` a pruned
  // checkpoint. Lines starting with ":" are heartbeats.
  const handle = (block: string) => {
    let seq: number | undefined;
    let hasData = false;
    let event = "message";
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) seq = Number(line.slice(3).trim());
      else if (line.startsWith("data:")) hasData = true;
      else if (line.startsWith("event:")) event = line.slice(6).trim();
    }
    if (event === "truncated") truncated = true;
    else if (hasData) recorded(path, watcher, seq);
  };

  void (async () => {
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value.replace(/\r\n?/g, "\n");
        let blank = buffer.indexOf("\n\n");
        while (blank >= 0) {
          handle(buffer.slice(0, blank));
          buffer = buffer.slice(blank + 2);
          blank = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // aborted or the server went away
    }
    end(truncated);
  })();
}

function stop(path: string, watcher: Watcher): void {
  const stopFeed = watcher.stopFeed;
  watcher.stopFeed = null;
  watcher.state = "off";
  watcher.retryAt = 0;
  if (watcher.changeTimer) clearTimeout(watcher.changeTimer);
  watcher.changeTimer = null;
  if (stopFeed) stopFeed();
  clearProject(path);
}

// Catches changes the journal never records by comparing bd output with the
// previous re-check. Only runs for boards that are subscribed, not polling.
async function recheck(path: string, watcher: Watcher): Promise<void> {
  if (watcher.checking) return;
  watcher.checking = true;
  try {
    const [all, ready] = await Promise.all([listIssues(path, { all: true }), listIssues(path, { ready: true })]);
    const snapshot = JSON.stringify([all, ready]);
    if (watcher.snapshot !== null && watcher.snapshot !== snapshot) changed(path, watcher);
    watcher.snapshot = snapshot;
  } catch {
    // bd failing is not a change; the next sweep tries again.
  } finally {
    watcher.checking = false;
  }
}

function sweep(): void {
  const now = Date.now();
  for (const [path, watcher] of watchers) {
    if (watcher.listeners.size > 0) {
      // Retries a failed feed once RETRY_MS passes and keeps bd serve alive.
      watchProject(path);
      if (watcher.state === "live") void recheck(path, watcher);
    } else if (watcher.state === "live" && now - watcher.lastUsed > IDLE_MS) {
      stop(path, watcher);
    }
  }
}

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(sweep, SWEEP_MS);
  sweeper.unref();
}

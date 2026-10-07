import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { runBd } from "./bd";
import { clearProject } from "./cache";

// Follows `bd events tail --follow` (beads 1.3+, journal opt-in) for projects
// whose board is open, and clears their cache on every journal record. While a
// follower is live, routes can cache bd output for WATCHED_TTL_MS instead of
// re-running bd on every poll, and subscribed boards are pushed a "change"
// instead of polling. Changes the journal doesn't record (syncs, `bd sql`,
// defer dates passing) are caught by re-checking subscribed projects every
// SWEEP_MS, and by the TTL for boards that still poll.

export const WATCHED_TTL_MS = 15_000;
const IDLE_MS = 60_000;
const RETRY_MS = 60_000;
const SWEEP_MS = 15_000;
const CHANGE_DEBOUNCE_MS = 100;

export type WatchEvent = "live" | "polling" | "change";
type Listener = (event: WatchEvent) => void;

type Watcher = {
  state: "off" | "starting" | "live";
  child: ChildProcess | null;
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
      child: null,
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
// needed. Returns true when a follower is live, so callers can cache longer.
export function watchProject(path: string): boolean {
  const watcher = getWatcher(path);
  watcher.lastUsed = Date.now();
  if (watcher.state === "live") return true;
  if (watcher.state === "off" && Date.now() >= watcher.retryAt) {
    watcher.state = "starting";
    ensureSweeper();
    void start(path, watcher);
  }
  return false;
}

// Like watchProject, but never starts a follower or keeps one alive.
export function isWatched(path: string): boolean {
  return watchers.get(path)?.state === "live";
}

// Pushes "live" or "polling" (now and on every switch) and "change" whenever
// the project changes while live. The follower stays up while anyone listens.
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

  const beadsBin = process.env.BEADS_BIN ?? "bd";
  const args = ["events", "tail", "--since", String(watcher.lastSeq), "--follow", "--json"];
  const child = spawn(/* turbopackIgnore: true */ beadsBin, args, { cwd: path, stdio: ["ignore", "pipe", "pipe"] });
  watcher.child = child;
  watcher.state = "live";
  watcher.snapshot = null;
  notify(watcher, "live");

  let truncated = false;
  createInterface({ input: child.stdout! }).on("line", (line) => {
    let record: { seq?: unknown; code?: unknown };
    try {
      record = JSON.parse(line);
    } catch {
      return;
    }
    if (record.code === "events_journal_truncated") truncated = true;
    if (typeof record.seq === "number" && record.seq > watcher.lastSeq) watcher.lastSeq = record.seq;
    watcher.snapshot = null;
    changed(path, watcher);
  });
  child.stderr!.on("data", (chunk: Buffer) => {
    if (chunk.toString().includes("events_journal_truncated")) truncated = true;
  });

  const onEnd = () => {
    if (watcher.child !== child) return;
    watcher.child = null;
    watcher.state = "off";
    watcher.retryAt = Date.now() + RETRY_MS;
    // The checkpoint fell out of retention: start over from the beginning.
    if (truncated) watcher.lastSeq = 0;
    clearProject(path);
    notify(watcher, "polling");
  };
  child.on("error", onEnd);
  child.on("close", onEnd);
}

function stop(path: string, watcher: Watcher): void {
  const child = watcher.child;
  watcher.child = null;
  watcher.state = "off";
  watcher.retryAt = 0;
  if (watcher.changeTimer) clearTimeout(watcher.changeTimer);
  watcher.changeTimer = null;
  if (child) child.kill();
  clearProject(path);
}

// Catches changes the journal never records by comparing bd output with the
// previous re-check. Only runs for boards that are subscribed, not polling.
async function recheck(path: string, watcher: Watcher): Promise<void> {
  if (watcher.checking) return;
  watcher.checking = true;
  try {
    const [all, ready] = await Promise.all([
      runBd(["list", "--all", "--limit", "0"], path),
      runBd(["list", "--ready", "--limit", "0"], path),
    ]);
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
      watcher.lastUsed = now;
      if (watcher.state === "live") void recheck(path, watcher);
      else watchProject(path); // retries a failed follower once RETRY_MS passes
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

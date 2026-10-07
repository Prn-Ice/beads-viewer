import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { runBd } from "./bd";
import { clearProject } from "./cache";

// Follows `bd events tail --follow` (beads 1.3+, journal opt-in) for projects
// whose board is open, and clears their cache on every journal record. While a
// follower is live, routes can cache bd output for WATCHED_TTL_MS instead of
// re-running bd on every poll. Changes the journal doesn't record (syncs,
// `bd sql`, defer dates passing) still show up once that TTL expires.

export const WATCHED_TTL_MS = 15_000;
const IDLE_MS = 60_000;
const RETRY_MS = 60_000;
const SWEEP_MS = 15_000;

type Watcher = {
  state: "off" | "starting" | "live";
  child: ChildProcess | null;
  lastSeq: number;
  lastUsed: number;
  retryAt: number;
};

const watchers = new Map<string, Watcher>();
let sweeper: NodeJS.Timeout | null = null;

// Followers are long-lived children: never leave them behind.
process.once("exit", stopAllWatchers);

// Marks the project's board as in use and starts following its journal if
// needed. Returns true when a follower is live, so callers can cache longer.
export function watchProject(path: string): boolean {
  let watcher = watchers.get(path);
  if (!watcher) {
    watcher = { state: "off", child: null, lastSeq: 0, lastUsed: 0, retryAt: 0 };
    watchers.set(path, watcher);
  }
  watcher.lastUsed = Date.now();
  if (watcher.state === "live") return true;
  if (watcher.state === "off" && Date.now() >= watcher.retryAt) {
    watcher.state = "starting";
    void start(path, watcher);
  }
  return false;
}

// Like watchProject, but never starts a follower or keeps one alive.
export function isWatched(path: string): boolean {
  return watchers.get(path)?.state === "live";
}

export function stopAllWatchers(): void {
  for (const [path, watcher] of watchers) stop(path, watcher);
  watchers.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
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
  ensureSweeper();

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
    clearProject(path);
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
  };
  child.on("error", onEnd);
  child.on("close", onEnd);
}

function stop(path: string, watcher: Watcher): void {
  const child = watcher.child;
  watcher.child = null;
  watcher.state = "off";
  watcher.retryAt = 0;
  if (child) child.kill();
  clearProject(path);
}

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const [path, watcher] of watchers) {
      if (watcher.state === "live" && Date.now() - watcher.lastUsed > IDLE_MS) stop(path, watcher);
    }
  }, SWEEP_MS);
  sweeper.unref();
}

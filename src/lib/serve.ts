import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

// Runs `bd serve` (beads 1.3+, loopback HTTP API) for open boards of projects
// whose database is a Dolt server: reads then cost one HTTP request instead of
// spawning bd, and the events journal arrives over `events:watch`. Embedded
// projects (the beads default) can't be served, so callers fall back to the CLI
// whenever serveUrl() returns null.

const START_TIMEOUT_MS = 15_000;
const IDLE_MS = 60_000;
const RETRY_MS = 60_000;
const SWEEP_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;
const LISTENING = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

type Server = {
  child: ChildProcess | null;
  url: string | null;
  ready: Promise<string | null> | null;
  lastUsed: number;
  retryAt: number;
};

const servers = new Map<string, Server>();
let sweeper: NodeJS.Timeout | null = null;

process.once("exit", stopAllServers);

// True when .beads/metadata.json points at a Dolt server, which bd serve needs.
export function isServerMode(path: string): boolean {
  try {
    const metadata = JSON.parse(readFileSync(join(path, ".beads", "metadata.json"), "utf8"));
    return metadata.dolt_mode === "server" || metadata.dolt_mode === "proxied-server";
  } catch {
    return false;
  }
}

// The running server's base URL, without starting one. Keeps it alive.
export function serveUrl(path: string): string | null {
  const server = servers.get(path);
  if (!server?.url) return null;
  server.lastUsed = Date.now();
  return server.url;
}

// Starts bd serve for a server-mode project if needed and resolves its base
// URL, or null when the project can't be served (embedded, old bd, Dolt down).
export function ensureServe(path: string): Promise<string | null> {
  let server = servers.get(path);
  if (!server) {
    server = { child: null, url: null, ready: null, lastUsed: 0, retryAt: 0 };
    servers.set(path, server);
  }
  server.lastUsed = Date.now();
  if (server.url) return Promise.resolve(server.url);
  if (server.ready) return server.ready;
  if (Date.now() < server.retryAt || !isServerMode(path)) return Promise.resolve(null);
  server.ready = start(path, server);
  return server.ready;
}

export function stopServe(path: string): void {
  const server = servers.get(path);
  if (!server) return;
  const child = server.child;
  server.child = null;
  server.url = null;
  server.ready = null;
  if (child) child.kill();
}

export function stopAllServers(): void {
  for (const path of servers.keys()) stopServe(path);
  servers.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

function start(path: string, server: Server): Promise<string | null> {
  return new Promise((resolve) => {
    const beadsBin = process.env.BEADS_BIN ?? "bd";
    // Port 0 lets bd pick a free port; it prints the address it bound.
    const child = spawn(/* turbopackIgnore: true */ beadsBin, ["serve", "--addr", "127.0.0.1:0"], {
      cwd: path,
      stdio: ["ignore", "pipe", "ignore"],
    });
    server.child = child;

    const fail = () => {
      if (server.child !== child) return;
      clearTimeout(timer);
      server.child = null;
      server.url = null;
      server.ready = null;
      server.retryAt = Date.now() + RETRY_MS;
      child.kill();
      resolve(null);
    };
    const timer = setTimeout(fail, START_TIMEOUT_MS);
    child.on("error", fail);
    child.on("close", fail);

    createInterface({ input: child.stdout! }).on("line", (line) => {
      const match = line.match(LISTENING);
      if (!match || server.url || server.child !== child) return;
      clearTimeout(timer);
      server.url = match[1];
      server.ready = null;
      ensureSweeper();
      resolve(server.url);
    });
  });
}

// GETs a JSON endpoint from the project's running server. Returns null when no
// server is up or the request fails, so the caller falls back to the CLI.
export async function serveGet<T>(path: string, endpoint: string): Promise<T | null> {
  const url = serveUrl(path);
  if (!url) return null;
  try {
    const res = await fetch(`${url}${endpoint}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ensureSweeper(): void {
  if (sweeper) return;
  sweeper = setInterval(() => {
    for (const [path, server] of servers) {
      if (server.url && Date.now() - server.lastUsed > IDLE_MS) stopServe(path);
    }
  }, SWEEP_MS);
  sweeper.unref();
}

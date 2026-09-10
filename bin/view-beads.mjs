#!/usr/bin/env node
// view-beads: start (or reuse) the local dashboard server and open it in the browser.

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8439;
const MAX_PORT_TRIES = 5;
const STARTUP_TIMEOUT_MS = 15_000;
const scriptDir = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  let port = DEFAULT_PORT;
  let open = true;
  let host = "127.0.0.1";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port" || arg === "-p") {
      port = Number(argv[++i]);
    } else if (arg === "--no-open") {
      open = false;
    } else if (arg === "--host") {
      host = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Usage: view-beads [options]

Start or reuse the beads dashboard server and open it in your browser.

Options:
  -p, --port <port>  Preferred port (default ${DEFAULT_PORT}; next free port if busy)
      --host <host>  Host to bind (default 127.0.0.1)
      --no-open      Do not open the browser, only print the URL`);
      process.exit(0);
    }
  }
  if (Number.isNaN(port) || port < 1 || port > 65535) {
    console.error(`view-beads: invalid port: ${argv.join(" ")}`);
    process.exit(1);
  }
  if (process.env.VIEW_BEADS_NO_OPEN || process.env.CI) open = false;
  return { port, open, host };
}

function resolveServerPath() {
  const fromEnv = process.env.VIEW_BEADS_SERVER;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const built = join(scriptDir, "..", ".next", "standalone", "server.js");
  if (existsSync(built)) return built;
  return null;
}

function buildId(serverPath) {
  return String(statSync(serverPath).mtimeMs);
}

function pidFile(port) {
  return join(tmpdir(), `view-beads-${port}.pid`);
}

async function health(url) {
  try {
    const res = await fetch(`${url}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body.app === "view-beads" ? body : null;
  } catch {
    return null;
  }
}

async function waitFor(url, timeoutMs, want) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const body = await health(url);
    if (want ? body : !body) return body;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

function stopServer(port) {
  const file = pidFile(port);
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }
  try {
    unlinkSync(file);
  } catch {
    /* already gone */
  }
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

function startServer(serverPath, port, host, id) {
  const child = spawn(process.execPath, [serverPath], {
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: host,
      VIEW_BEADS_BUILD: id,
    },
    cwd: process.cwd(),
    stdio: "ignore",
    detached: true,
  });
  child.on("error", () => {});
  child.unref();
  writeFileSync(pidFile(port), String(child.pid));
}

async function main() {
  const { port, open, host } = parseArgs(process.argv.slice(2));
  const serverPath = resolveServerPath();
  if (!serverPath) {
    console.error(
      "view-beads: built server not found. Run `npm run build`, or set VIEW_BEADS_SERVER to server.js",
    );
    process.exit(1);
  }
  const id = buildId(serverPath);

  for (let attempt = 0; attempt < MAX_PORT_TRIES; attempt++) {
    const candidatePort = port + attempt;
    const url = `http://${host}:${candidatePort}`;

    const running = await health(url);
    if (running && running.build === id) {
      console.log(`view-beads (already running): ${url}`);
      if (open) openBrowser(url);
      return;
    }

    if (running) {
      stopServer(candidatePort);
      await waitFor(url, 3_000, false);
    }

    startServer(serverPath, candidatePort, host, id);
    if (await waitFor(url, STARTUP_TIMEOUT_MS, true)) {
      console.log(`view-beads: ${url}`);
      if (open) openBrowser(url);
      return;
    }
  }

  console.error(
    `view-beads: could not start the server on ports ${port}-${port + MAX_PORT_TRIES - 1}`,
  );
  process.exit(1);
}

main();

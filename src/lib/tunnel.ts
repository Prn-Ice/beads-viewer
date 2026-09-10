import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { readConfig, type TunnelSettings } from "@/lib/config";

const START_TIMEOUT_MS = 30_000;

const TRYCLOUDFLARE_URL = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;
const REGISTERED_CONNECTION = /Registered tunnel connection/i;

export function extractTunnelUrl(output: string): string | null {
  const match = output.match(TRYCLOUDFLARE_URL);
  return match ? match[0] : null;
}

export type TunnelMode = TunnelSettings["mode"];

export interface TunnelConfig {
  mode: TunnelMode;
  args: string[];
  // Quick tunnels report their URL from cloudflared output; named and token
  // tunnels get theirs from the configured settings.url instead.
  needsShareUrl: boolean;
}

// The active tunnel settings: env vars win over the config file (same
// precedence as BEADS_GITHUB_REPOS), quick tunnel is the default.
export function tunnelSettings(): {
  settings: TunnelSettings;
  source: "env" | "file" | "default";
} {
  const token = process.env.CLOUDFLARED_TUNNEL_TOKEN?.trim();
  if (token) {
    return {
      settings: {
        mode: "token",
        name: "",
        token,
        url: process.env.CLOUDFLARED_SHARE_URL?.trim() ?? "",
      },
      source: "env",
    };
  }
  const name = process.env.CLOUDFLARED_TUNNEL_NAME?.trim();
  if (name) {
    return {
      settings: {
        mode: "named",
        name,
        token: "",
        url: process.env.CLOUDFLARED_SHARE_URL?.trim() ?? "",
      },
      source: "env",
    };
  }
  const fromFile = readConfig().tunnel;
  if (fromFile) return { settings: fromFile, source: "file" };
  return {
    settings: { mode: "quick", name: "", token: "", url: "" },
    source: "default",
  };
}

export function tunnelConfig(port: number, settings: TunnelSettings): TunnelConfig {
  if (settings.mode === "token") {
    return {
      mode: "token",
      args: ["tunnel", "--no-autoupdate", "run", "--token", settings.token],
      needsShareUrl: true,
    };
  }
  if (settings.mode === "named") {
    return {
      mode: "named",
      args: ["tunnel", "--no-autoupdate", "run", "--url", `http://127.0.0.1:${port}`, settings.name],
      needsShareUrl: true,
    };
  }
  return {
    mode: "quick",
    args: ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    needsShareUrl: false,
  };
}

type TunnelState =
  | { status: "stopped" }
  | { status: "starting"; child: ChildProcess; promise: Promise<string> }
  | { status: "running"; url: string; child: ChildProcess };

let state: TunnelState = { status: "stopped" };

export function tunnelUrl(): string | null {
  return state.status === "running" ? state.url : null;
}

// Start a Cloudflare tunnel to the local server and resolve with the public
// URL. Quick tunnels get their random URL from cloudflared output; named and
// token tunnels use the configured public URL and resolve once cloudflared
// registers a connection to the edge. A tunnel that is already running
// resolves immediately; callers join one that is still starting.
export function startTunnel(port: number): Promise<string> {
  if (state.status === "running") return Promise.resolve(state.url);
  if (state.status === "starting") return state.promise;

  const { settings } = tunnelSettings();
  const config = tunnelConfig(port, settings);
  const shareUrl = settings.url;
  if (config.needsShareUrl && !shareUrl) {
    return Promise.reject(
      new Error(
        "Set the public URL of your tunnel to share it (e.g. https://board.example.com)",
      ),
    );
  }

  const cloudflaredBin = process.env.CLOUDFLARED_BIN ?? "cloudflared";
  const child = spawn(cloudflaredBin, config.args, {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const promise = new Promise<string>((resolve, reject) => {
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      fail(new Error("cloudflared took too long to start the tunnel"));
    }, START_TIMEOUT_MS);

    function succeed(url: string) {
      if (settled) return;
      if (state.status !== "starting" || state.child !== child) return;
      settled = true;
      clearTimeout(timer);
      state = { status: "running", url, child };
      resolve(url);
    }

    function fail(err: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (state.status !== "stopped" && state.child === child) {
        state = { status: "stopped" };
      }
      reject(err);
    }

    function onChunk(chunk: Buffer) {
      output += chunk;
      if (config.mode === "quick") {
        const quickUrl = extractTunnelUrl(output);
        if (quickUrl) succeed(quickUrl);
      } else if (shareUrl && REGISTERED_CONNECTION.test(output)) {
        succeed(shareUrl);
      }
    }

    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        fail(
          new Error(
            "cloudflared not found. Install it (https://developers.cloudflare.com/cloudflared/) or set CLOUDFLARED_BIN.",
          ),
        );
      } else {
        fail(new Error(`failed to start cloudflared: ${err.message}`));
      }
    });
    child.on("close", (code) => {
      if (state.status !== "stopped" && state.child === child) {
        state = { status: "stopped" };
      }
      if (!settled) {
        const reason = output.trim() || `exited ${code ?? "early"}`;
        fail(new Error(`cloudflared ${reason} before the tunnel connected`));
      }
    });
  });

  state = { status: "starting", child, promise };
  return promise;
}

// Kill cloudflared; resolves once the child has exited. The close handler
// settles any pending start promise and resets the state.
export function stopTunnel(): Promise<void> {
  if (state.status === "stopped") return Promise.resolve();
  const child = state.child;
  const done = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  child.kill("SIGTERM");
  return done;
}

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  extractTunnelUrl,
  startTunnel,
  stopTunnel,
  tunnelConfig,
  tunnelSettings,
  tunnelUrl,
} from "./tunnel";

const FAKE_CLOUDFLARED = fileURLToPath(
  new URL("../../tests/fixtures/fake-cloudflared.mjs", import.meta.url),
);

const ORIGINAL_BIN = process.env.CLOUDFLARED_BIN;
const ORIGINAL_URL = process.env.FAKE_CLOUDFLARED_URL;
const ORIGINAL_FAIL = process.env.FAKE_CLOUDFLARED_FAIL;
const ORIGINAL_TOKEN = process.env.CLOUDFLARED_TUNNEL_TOKEN;
const ORIGINAL_NAME = process.env.CLOUDFLARED_TUNNEL_NAME;
const ORIGINAL_SHARE_URL = process.env.CLOUDFLARED_SHARE_URL;
const ORIGINAL_CONFIG = process.env.VIEW_BEADS_CONFIG;

let configDir: string;

beforeEach(() => {
  process.env.CLOUDFLARED_BIN = FAKE_CLOUDFLARED;
  delete process.env.FAKE_CLOUDFLARED_URL;
  delete process.env.FAKE_CLOUDFLARED_FAIL;
  delete process.env.CLOUDFLARED_TUNNEL_TOKEN;
  delete process.env.CLOUDFLARED_TUNNEL_NAME;
  delete process.env.CLOUDFLARED_SHARE_URL;
  configDir = mkdtempSync(join(tmpdir(), "view-beads-tunnel-"));
  process.env.VIEW_BEADS_CONFIG = join(configDir, "config.json");
});

afterEach(async () => {
  await stopTunnel();
  rmSync(configDir, { recursive: true, force: true });
  if (ORIGINAL_BIN === undefined) delete process.env.CLOUDFLARED_BIN;
  else process.env.CLOUDFLARED_BIN = ORIGINAL_BIN;
  if (ORIGINAL_URL === undefined) delete process.env.FAKE_CLOUDFLARED_URL;
  else process.env.FAKE_CLOUDFLARED_URL = ORIGINAL_URL;
  if (ORIGINAL_FAIL === undefined) delete process.env.FAKE_CLOUDFLARED_FAIL;
  else process.env.FAKE_CLOUDFLARED_FAIL = ORIGINAL_FAIL;
  if (ORIGINAL_TOKEN === undefined) delete process.env.CLOUDFLARED_TUNNEL_TOKEN;
  else process.env.CLOUDFLARED_TUNNEL_TOKEN = ORIGINAL_TOKEN;
  if (ORIGINAL_NAME === undefined) delete process.env.CLOUDFLARED_TUNNEL_NAME;
  else process.env.CLOUDFLARED_TUNNEL_NAME = ORIGINAL_NAME;
  if (ORIGINAL_SHARE_URL === undefined) delete process.env.CLOUDFLARED_SHARE_URL;
  else process.env.CLOUDFLARED_SHARE_URL = ORIGINAL_SHARE_URL;
  if (ORIGINAL_CONFIG === undefined) delete process.env.VIEW_BEADS_CONFIG;
  else process.env.VIEW_BEADS_CONFIG = ORIGINAL_CONFIG;
});

const QUICK = { mode: "quick" as const, name: "", token: "", url: "" };

describe("tunnelConfig", () => {
  it("builds quick tunnel args pointed at the server port", () => {
    expect(tunnelConfig(8439, QUICK)).toEqual({
      mode: "quick",
      args: ["tunnel", "--url", "http://127.0.0.1:8439", "--no-autoupdate"],
      needsShareUrl: false,
    });
  });

  it("builds named tunnel args with an ad-hoc url", () => {
    expect(
      tunnelConfig(8439, { mode: "named", name: "view-beads", token: "", url: "https://board.example.com" }),
    ).toEqual({
      mode: "named",
      args: ["tunnel", "--no-autoupdate", "run", "--url", "http://127.0.0.1:8439", "view-beads"],
      needsShareUrl: true,
    });
  });

  it("builds token tunnel args", () => {
    expect(
      tunnelConfig(8439, { mode: "token", name: "", token: "secret-token", url: "https://board.example.com" }),
    ).toEqual({
      mode: "token",
      args: ["tunnel", "--no-autoupdate", "run", "--token", "secret-token"],
      needsShareUrl: true,
    });
  });
});

describe("tunnelSettings", () => {
  it("defaults to a quick tunnel", () => {
    expect(tunnelSettings()).toEqual({ settings: QUICK, source: "default" });
  });

  it("reads a token tunnel from env and wins over the config file", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        tunnel: { mode: "named", name: "view-beads", url: "https://file.example.com" },
      }),
    );
    process.env.CLOUDFLARED_TUNNEL_TOKEN = "secret-token";
    process.env.CLOUDFLARED_SHARE_URL = "https://env.example.com";
    expect(tunnelSettings()).toEqual({
      settings: { mode: "token", name: "", token: "secret-token", url: "https://env.example.com" },
      source: "env",
    });
  });

  it("reads a named tunnel from env", () => {
    process.env.CLOUDFLARED_TUNNEL_NAME = "view-beads";
    process.env.CLOUDFLARED_SHARE_URL = "https://env.example.com";
    expect(tunnelSettings()).toEqual({
      settings: { mode: "named", name: "view-beads", token: "", url: "https://env.example.com" },
      source: "env",
    });
  });

  it("falls back to the config file when no env vars are set", () => {
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        tunnel: { mode: "named", name: "view-beads", url: "https://file.example.com" },
      }),
    );
    expect(tunnelSettings()).toEqual({
      settings: { mode: "named", name: "view-beads", token: "", url: "https://file.example.com" },
      source: "file",
    });
  });
});

describe("extractTunnelUrl", () => {
  it("finds a trycloudflare.com URL in cloudflared output", () => {
    const output =
      "Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):\n" +
      "  https://sunny-mars-123.trycloudflare.com\n";
    expect(extractTunnelUrl(output)).toBe("https://sunny-mars-123.trycloudflare.com");
  });

  it("returns null when no tunnel URL is present", () => {
    expect(extractTunnelUrl("ERR Failed to dial the edge, quitting.")).toBeNull();
  });

  it("ignores partial URLs in a single chunk", () => {
    expect(extractTunnelUrl("https://sun")).toBeNull();
  });
});

describe("startTunnel", () => {
  it("resolves with the tunnel URL and reports it from tunnelUrl", async () => {
    const url = await startTunnel(8439);
    expect(url).toBe("https://fake-tunnel-abc123.trycloudflare.com");
    expect(tunnelUrl()).toBe(url);
  });

  it("returns the same tunnel when one is already running", async () => {
    const first = await startTunnel(8439);
    process.env.FAKE_CLOUDFLARED_FAIL = "1";
    const second = await startTunnel(8439);
    expect(second).toBe(first);
    expect(tunnelUrl()).toBe(first);
  });

  it("rejects when cloudflared exits before reporting a URL", async () => {
    process.env.FAKE_CLOUDFLARED_FAIL = "1";
    await expect(startTunnel(8439)).rejects.toThrow(/before the tunnel connected/);
    expect(tunnelUrl()).toBeNull();
  });

  it("rejects with install guidance when cloudflared is missing", async () => {
    process.env.CLOUDFLARED_BIN = "/nonexistent/cloudflared";
    await expect(startTunnel(8439)).rejects.toThrow(/cloudflared not found/);
  });

  it("resolves with the configured URL for a named tunnel", async () => {
    process.env.CLOUDFLARED_TUNNEL_NAME = "view-beads";
    process.env.CLOUDFLARED_SHARE_URL = "https://board.example.com";
    await expect(startTunnel(8439)).resolves.toBe("https://board.example.com");
    expect(tunnelUrl()).toBe("https://board.example.com");
  });

  it("resolves with the configured URL for a token tunnel", async () => {
    process.env.CLOUDFLARED_TUNNEL_TOKEN = "secret-token";
    process.env.CLOUDFLARED_SHARE_URL = "https://board.example.com";
    await expect(startTunnel(8439)).resolves.toBe("https://board.example.com");
    expect(tunnelUrl()).toBe("https://board.example.com");
  });

  it("rejects a named tunnel without a public URL", async () => {
    process.env.CLOUDFLARED_TUNNEL_NAME = "view-beads";
    await expect(startTunnel(8439)).rejects.toThrow(/public URL/);
    expect(tunnelUrl()).toBeNull();
  });
});

describe("stopTunnel", () => {
  it("clears the tunnel URL", async () => {
    await startTunnel(8439);
    expect(tunnelUrl()).not.toBeNull();
    await stopTunnel();
    expect(tunnelUrl()).toBeNull();
  });

  it("is a no-op when no tunnel is running", async () => {
    await expect(stopTunnel()).resolves.toBeUndefined();
  });
});

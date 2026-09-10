import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST, PUT, serverPort } from "./route";

vi.mock("@/lib/tunnel", () => ({
  startTunnel: vi.fn(),
  stopTunnel: vi.fn(),
  tunnelSettings: vi.fn(),
  tunnelUrl: vi.fn(),
}));

import { startTunnel, stopTunnel, tunnelSettings, tunnelUrl } from "@/lib/tunnel";

const ORIGINAL_PORT = process.env.PORT;
const ORIGINAL_CONFIG = process.env.VIEW_BEADS_CONFIG;

let configDir: string;

beforeEach(() => {
  configDir = mkdtempSync(join(tmpdir(), "view-beads-share-"));
  process.env.VIEW_BEADS_CONFIG = join(configDir, "config.json");
  vi.mocked(startTunnel).mockResolvedValue("https://fake-tunnel-abc123.trycloudflare.com");
  vi.mocked(stopTunnel).mockResolvedValue(undefined);
  vi.mocked(tunnelUrl).mockReturnValue(null);
  vi.mocked(tunnelSettings).mockReturnValue({
    settings: { mode: "quick", name: "", token: "", url: "" },
    source: "default",
  });
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(configDir, { recursive: true, force: true });
  if (ORIGINAL_PORT === undefined) delete process.env.PORT;
  else process.env.PORT = ORIGINAL_PORT;
  if (ORIGINAL_CONFIG === undefined) delete process.env.VIEW_BEADS_CONFIG;
  else process.env.VIEW_BEADS_CONFIG = ORIGINAL_CONFIG;
});

describe("serverPort", () => {
  it("reads the port from the Host header", () => {
    const request = new Request("http://127.0.0.1:8439/api/share", {
      headers: { Host: "127.0.0.1:8439" },
    });
    expect(serverPort(request)).toBe(8439);
  });

  it("falls back to PORT when the host has no port", () => {
    process.env.PORT = "4242";
    const request = new Request("http://localhost/api/share", {
      headers: { Host: "localhost" },
    });
    expect(serverPort(request)).toBe(4242);
  });

  it("falls back to the default when neither is available", () => {
    delete process.env.PORT;
    const request = new Request("http://localhost/api/share", {
      headers: { Host: "localhost" },
    });
    expect(serverPort(request)).toBe(8439);
  });
});

describe("GET /api/share", () => {
  it("reports the active tunnel URL and the public settings", async () => {
    vi.mocked(tunnelUrl).mockReturnValue("https://fake-tunnel-abc123.trycloudflare.com");
    vi.mocked(tunnelSettings).mockReturnValue({
      settings: { mode: "token", name: "", token: "secret-token", url: "https://board.example.com" },
      source: "file",
    });
    expect(await (await GET()).json()).toEqual({
      url: "https://fake-tunnel-abc123.trycloudflare.com",
      settings: { mode: "token", name: "", url: "https://board.example.com", hasToken: true },
      source: "file",
    });
  });

  it("never returns the token itself", async () => {
    vi.mocked(tunnelSettings).mockReturnValue({
      settings: { mode: "token", name: "", token: "secret-token", url: "https://board.example.com" },
      source: "file",
    });
    const body = JSON.stringify(await (await GET()).json());
    expect(body).not.toContain("secret-token");
    expect(body).toContain("hasToken");
  });

  it("reports null when no tunnel is running", async () => {
    const body = await (await GET()).json() as Record<string, unknown>;
    expect(body.url).toBeNull();
  });
});

describe("POST /api/share", () => {
  function post(body?: unknown) {
    return POST(
      new Request("http://127.0.0.1:8439/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json", Host: "127.0.0.1:8439" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  it("starts a tunnel for the server port and returns its URL", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://fake-tunnel-abc123.trycloudflare.com" });
    expect(startTunnel).toHaveBeenCalledWith(8439);
  });

  it("returns 500 with the error message when the tunnel fails", async () => {
    vi.mocked(startTunnel).mockRejectedValue(new Error("cloudflared not found. Install it"));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "cloudflared not found. Install it",
    });
  });

  it("refuses to save settings when env vars manage the tunnel", async () => {
    vi.mocked(tunnelSettings).mockReturnValue({
      settings: { mode: "token", name: "", token: "env-token", url: "https://env.example.com" },
      source: "env",
    });
    const res = await post({ settings: { mode: "quick" } });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "tunnel settings are configured via environment variables",
    });
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid settings", async () => {
    const res = await post({ settings: { mode: "named" } });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid tunnel settings" });
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it("persists valid settings and starts the tunnel", async () => {
    vi.mocked(startTunnel).mockResolvedValue("https://board.example.com");
    const res = await post({
      settings: { mode: "named", name: "view-beads", url: "https://board.example.com" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://board.example.com" });
    expect(startTunnel).toHaveBeenCalledWith(8439);
  });
});

describe("PUT /api/share", () => {
  function put(body: unknown) {
    return PUT(
      new Request("http://127.0.0.1:8439/api/share", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("persists valid settings without starting the tunnel", async () => {
    const res = await put({
      settings: { mode: "token", token: "secret-token", url: "https://board.example.com" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { mode: "token", name: "", url: "https://board.example.com", hasToken: true },
      source: "file",
    });
    expect(startTunnel).not.toHaveBeenCalled();
  });

  it("returns 409 when env vars manage the tunnel", async () => {
    vi.mocked(tunnelSettings).mockReturnValue({
      settings: { mode: "named", name: "view-beads", token: "", url: "https://env.example.com" },
      source: "env",
    });
    const res = await put({ settings: { mode: "quick" } });
    expect(res.status).toBe(409);
  });
});

describe("DELETE /api/share", () => {
  it("stops the tunnel", async () => {
    expect(await (await DELETE()).json()).toEqual({ url: null });
    expect(stopTunnel).toHaveBeenCalled();
  });
});

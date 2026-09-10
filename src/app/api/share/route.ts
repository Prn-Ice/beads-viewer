import {
  normalizeTunnelSettings,
  writeTunnelSettings,
  type TunnelSettings,
} from "@/lib/config";
import { startTunnel, stopTunnel, tunnelSettings, tunnelUrl } from "@/lib/tunnel";

const DEFAULT_PORT = 8439;

// The tunnel must point at whatever port this server is listening on. The
// request's Host header is authoritative (view-beads binds a chosen port,
// next dev uses 3000); fall back to PORT, then the CLI default.
export function serverPort(request: Request): number {
  const host = request.headers.get("host");
  if (host) {
    const match = host.match(/:(\d+)$/);
    if (match) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) return port;
    }
  }
  const fromEnv = Number(process.env.PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  return DEFAULT_PORT;
}

// The token itself is never sent to the browser — anyone with a share link
// could open the panel. The field instead reports whether one is saved.
function publicSettings(settings: TunnelSettings) {
  return {
    mode: settings.mode,
    name: settings.name,
    url: settings.url,
    hasToken: settings.token !== "",
  };
}

export async function GET(): Promise<Response> {
  const { settings, source } = tunnelSettings();
  return Response.json({ url: tunnelUrl(), settings: publicSettings(settings), source });
}

export async function POST(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    settings?: unknown;
  } | null;
  if (body?.settings !== undefined) {
    const { source } = tunnelSettings();
    if (source === "env") {
      return Response.json(
        { error: "tunnel settings are configured via environment variables" },
        { status: 409 },
      );
    }
    const settings = normalizeTunnelSettings(body.settings);
    if (!settings) {
      return Response.json({ error: "invalid tunnel settings" }, { status: 400 });
    }
    writeTunnelSettings(settings);
  }
  try {
    const url = await startTunnel(serverPort(request));
    return Response.json({ url });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}

// Save tunnel settings without starting the tunnel.
export async function PUT(request: Request): Promise<Response> {
  const body = (await request.json().catch(() => null)) as {
    settings?: unknown;
  } | null;
  const { source } = tunnelSettings();
  if (source === "env") {
    return Response.json(
      { error: "tunnel settings are configured via environment variables" },
      { status: 409 },
    );
  }
  const settings = normalizeTunnelSettings(body?.settings);
  if (!settings) {
    return Response.json({ error: "invalid tunnel settings" }, { status: 400 });
  }
  writeTunnelSettings(settings);
  return Response.json({ settings: publicSettings(settings), source: "file" });
}

export async function DELETE(): Promise<Response> {
  await stopTunnel();
  return Response.json({ url: null });
}

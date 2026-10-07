import { existsSync } from "node:fs";
import { join } from "node:path";
import { subscribe } from "@/lib/events";

const HEARTBEAT_MS = 20_000;

// Server-Sent Events for one project's board. Sends `live` when changes will be
// pushed (the board can stop polling), `polling` when they can't, and `change`
// when the board should reload. Heartbeats keep proxies and tunnels from
// closing an idle stream.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = decodeURIComponent(id);
  if (!existsSync(join(path, ".beads"))) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }

  const encoder = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream({
    start(controller) {
      const write = (text: string) => {
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup(); // the stream is already closed
        }
      };
      const unsubscribe = subscribe(path, (event) => write(`event: ${event}\ndata: {}\n\n`));
      const heartbeat = setInterval(() => write(": heartbeat\n\n"), HEARTBEAT_MS);
      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      request.signal.addEventListener("abort", () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

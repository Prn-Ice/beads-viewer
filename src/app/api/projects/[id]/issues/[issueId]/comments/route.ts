import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import type { Comment } from "@/lib/types";

const TTL_MS = 5_000;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const { id, issueId } = await params;
  const path = decodeURIComponent(id);
  if (!existsSync(join(path, ".beads"))) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }

  const comments = await cached<Comment[]>(`comments|${path}|${issueId}`, TTL_MS, async () => {
    const data = await runBd(["comments", issueId], path);
    return (data ?? []) as Comment[];
  });

  return Response.json(comments);
}

import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import type { EpicChild } from "@/lib/epic-progress";
import type { BeadsIssue } from "@/lib/types";

const TTL_MS = 5_000;

function lightChild(issue: BeadsIssue): EpicChild {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    issue_type: issue.issue_type,
    priority: issue.priority,
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const { id, issueId } = await params;
  const path = decodeURIComponent(id);
  if (!existsSync(join(path, ".beads"))) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }

  // bd list --parent returns only DIRECT children; --status all includes closed
  // issues (the same semantics as `bd children`, which accepts no --limit).
  // --limit 0 avoids the default 50-result cap so the count is complete.
  const children = await cached<EpicChild[]>(`children|${path}|${issueId}`, TTL_MS, async () => {
    const data = await runBd(["list", "--parent", issueId, "--status", "all", "--limit", "0"], path);
    return (data as BeadsIssue[]).map(lightChild);
  });

  return Response.json(children);
}

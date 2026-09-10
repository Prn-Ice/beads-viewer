import { existsSync } from "node:fs";
import { join } from "node:path";
import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import { countChildren } from "@/lib/hierarchy";
import type { BeadsIssue, IssueListResponse } from "@/lib/types";

const TTL_MS = 1_000;

function lightIssue(issue: BeadsIssue) {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    issue_type: issue.issue_type,
    assignee: issue.assignee,
    labels: issue.labels,
    parent: issue.parent,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    closed_at: issue.closed_at,
    due_at: issue.due_at,
    defer_until: issue.defer_until,
    pinned: issue.pinned,
    dependency_count: issue.dependency_count,
    dependent_count: issue.dependent_count,
    comment_count: issue.comment_count,
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const path = decodeURIComponent(id);
  if (!existsSync(join(path, ".beads"))) {
    return Response.json({ error: "unknown project" }, { status: 404 });
  }
  const scope = new URL(request.url).searchParams.get("scope") ?? "open";
  if (scope !== "open" && scope !== "all") {
    return Response.json({ error: "scope must be 'open' or 'all'" }, { status: 400 });
  }

  const data = await cached<IssueListResponse>(`list|${path}|${scope}`, TTL_MS, async () => {
    const args = ["list", "--limit", "0"];
    if (scope === "all") args.push("--all");
    const [issuesRaw, readyRaw] = await Promise.all([
      runBd(args, path),
      runBd(["list", "--limit", "0", "--ready"], path),
    ]);
    // Child counts come from the all-status list so they stay complete when the
    // open scope hides closed children. Reuse the payload for the all scope.
    const allRaw = scope === "all" ? issuesRaw : await runBd(["list", "--limit", "0", "--all"], path);
    return {
      issues: (issuesRaw as BeadsIssue[]).map(lightIssue),
      readyIds: (readyRaw as BeadsIssue[]).map((issue) => issue.id),
      childCounts: countChildren(allRaw as BeadsIssue[]),
    };
  });

  return Response.json(data);
}

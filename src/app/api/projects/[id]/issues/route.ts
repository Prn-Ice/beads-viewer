import { existsSync } from "node:fs";
import { join } from "node:path";
import { cached } from "@/lib/cache";
import { watchProject, WATCHED_TTL_MS } from "@/lib/events";
import { countChildren } from "@/lib/hierarchy";
import { listIssues } from "@/lib/issues";
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

  // An open board follows the project's events journal when it can; journal
  // records clear the cache, so polls are served from memory in between.
  const ttl = watchProject(path) ? WATCHED_TTL_MS : TTL_MS;
  const data = await cached<IssueListResponse>(`list|${path}|${scope}`, ttl, async () => {
    const [issues, ready] = await Promise.all([
      listIssues(path, { all: scope === "all" }),
      listIssues(path, { ready: true }),
    ]);
    // Child counts come from the all-status list so they stay complete when the
    // open scope hides closed children. Reuse the payload for the all scope.
    const all = scope === "all" ? issues : await listIssues(path, { all: true });
    return {
      issues: issues.map(lightIssue),
      readyIds: ready.map((issue) => issue.id),
      childCounts: countChildren(all),
    };
  });

  return Response.json(data);
}

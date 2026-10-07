import { runBd } from "./bd";
import { serveGet } from "./serve";
import type { BeadsIssue, ProjectSummary } from "./types";

// The board's hot-path reads. They go through the project's `bd serve` when
// one is running (same records as the CLI, served in milliseconds) and fall
// back to spawning bd otherwise.

export async function listIssues(path: string, options: { all?: boolean; ready?: boolean } = {}): Promise<BeadsIssue[]> {
  const endpoint = options.ready
    ? "/v0/beads/ready?limit=0"
    : `/v0/beads/issues?limit=0&sort=priority${options.all ? "&all=true" : ""}`; // bd list's order
  const page = await serveGet<{ items: BeadsIssue[] }>(path, endpoint);
  if (page && Array.isArray(page.items)) return page.items;

  const args = ["list", "--limit", "0"];
  if (options.all) args.push("--all");
  if (options.ready) args.push("--ready");
  return (await runBd(args, path)) as BeadsIssue[];
}

export async function projectSummary(path: string): Promise<ProjectSummary> {
  const stats = await serveGet<{ summary: ProjectSummary }>(path, "/v0/beads/stats");
  if (stats?.summary) return stats.summary;
  const data = await runBd(["status"], path);
  return (data as { summary: ProjectSummary }).summary;
}

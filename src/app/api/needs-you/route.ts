import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import { discoverProjects } from "@/lib/discovery";
import { listMaterializedGithubProjects } from "@/lib/github";
import {
  NEEDS_YOU_ARGS,
  normalizeCandidate,
  sortNeedsYouIssues,
  type NeedsYouIssue,
  type NeedsYouProject,
  type NeedsYouResponse,
} from "@/lib/needs-you";

const TTL_MS = 5_000;
const CONCURRENCY = 3;

// Run fn over items with at most `limit` promises in flight, preserving order.
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function GET(): Promise<Response> {
  const projects = [...discoverProjects(process.cwd()), ...listMaterializedGithubProjects()];
  const loaded = await mapWithLimit(projects, CONCURRENCY, async (project): Promise<NeedsYouProject> => {
    try {
      const issues = await cached<NeedsYouIssue[]>(`needs-you|${project.path}`, TTL_MS, async () => {
        const raw = await runBd(NEEDS_YOU_ARGS, project.path);
        if (!Array.isArray(raw)) throw new Error("Unexpected bd output");
        return raw
          .map((entry) => normalizeCandidate(entry))
          .filter((issue): issue is NeedsYouIssue => issue !== null);
      });
      return { path: project.path, name: project.name, issues: sortNeedsYouIssues(issues) };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { path: project.path, name: project.name, issues: [], error: message };
    }
  });

  const response: NeedsYouResponse = { fetchedAt: Date.now(), projects: loaded };
  return Response.json(response);
}

import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import { configuredGithubRepos, loadGithubProject } from "@/lib/github";
import type { GithubRepoResponse, Project, ProjectSummary } from "@/lib/types";

const TTL_MS = 1_000;

// Sync a single configured repo and return it as a project (or why not).
// Only repos in the configured set (env or config file) are accepted, so this
// endpoint can never be used to clone arbitrary URLs.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug: rawSlug } = await params;
  const slug = decodeURIComponent(rawSlug);
  const repo = configuredGithubRepos().find((r) => r.slug === slug);
  if (!repo) {
    return Response.json({ error: "unknown repo" }, { status: 404 });
  }

  const result = await loadGithubProject(repo);
  if (result.state !== "ok") {
    const body: GithubRepoResponse = { slug, ...result };
    return Response.json(body);
  }

  let summary: ProjectSummary | null = null;
  try {
    summary = await cached<ProjectSummary>(`status|${result.path}`, TTL_MS, async () => {
      const data = await runBd(["status"], result.path);
      return (data as { summary: ProjectSummary }).summary;
    });
  } catch {
    summary = null;
  }

  const project: Project = {
    id: encodeURIComponent(result.path),
    name: result.name,
    path: result.path,
    source: "github",
    summary,
  };
  const body: GithubRepoResponse = { slug, state: "ok", project };
  return Response.json(body);
}

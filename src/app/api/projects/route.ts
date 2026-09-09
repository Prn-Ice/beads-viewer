import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import { discoverProjects } from "@/lib/discovery";
import type { Project, ProjectSummary } from "@/lib/types";

const TTL_MS = 1_000;

// Local projects only: instant, never blocked on GitHub syncs. Remote repos
// load separately via /api/github/repos so they can stream in one by one.
export async function GET() {
  const projects = discoverProjects(process.cwd());

  const results = await Promise.all(
    projects.map(async (project): Promise<Project> => {
      const id = encodeURIComponent(project.path);
      try {
        const summary = await cached<ProjectSummary>(`status|${project.path}`, TTL_MS, async () => {
          const data = await runBd(["status"], project.path);
          return (data as { summary: ProjectSummary }).summary;
        });
        return { id, name: project.name, path: project.path, source: "local", worktree: project.worktree, summary };
      } catch {
        return { id, name: project.name, path: project.path, source: "local", worktree: project.worktree, summary: null };
      }
    }),
  );

  return Response.json(results);
}

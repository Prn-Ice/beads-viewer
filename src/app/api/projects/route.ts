import { runBd } from "@/lib/bd";
import { cached } from "@/lib/cache";
import { discoverProjects } from "@/lib/discovery";
import type { Project, ProjectSummary } from "@/lib/types";

const TTL_MS = 5_000;

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
        return { id, name: project.name, path: project.path, summary };
      } catch {
        return { id, name: project.name, path: project.path, summary: null };
      }
    }),
  );

  return Response.json(results);
}

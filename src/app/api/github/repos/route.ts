import { configuredGithubRepos } from "@/lib/github";
import type { GithubRepoRef } from "@/lib/types";

// Instant: just the configured repo slugs, no syncing. The dashboard fetches
// this first, then loads each repo via /api/github/repos/[slug] one by one.
export async function GET() {
  const repos: GithubRepoRef[] = configuredGithubRepos();
  return Response.json(repos);
}

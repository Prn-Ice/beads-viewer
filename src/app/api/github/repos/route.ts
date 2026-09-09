import { parseGithubRepos } from "@/lib/github";
import type { GithubRepoRef } from "@/lib/types";

// Instant: just the configured repo slugs, no syncing. The dashboard fetches
// this first, then loads each repo via /api/github/repos/[slug] one by one.
export async function GET() {
  const repos: GithubRepoRef[] = parseGithubRepos(process.env.BEADS_GITHUB_REPOS);
  return Response.json(repos);
}

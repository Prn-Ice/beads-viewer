import { GITHUB_SLUG_RE, readConfig, writeGithubRepos } from "@/lib/config";
import { parseGithubRepos } from "@/lib/github";

// The current repo selection and where it comes from. BEADS_GITHUB_REPOS, when
// set, is an explicit override that wins over the config file.
export async function GET() {
  const env = process.env.BEADS_GITHUB_REPOS?.trim();
  const file = readConfig().githubRepos;
  const source = env ? "env" : file.length ? "file" : "none";
  const repos = env ? parseGithubRepos(env).map((repo) => repo.slug) : file;
  return Response.json({ repos, source });
}

// Persist the selected repos to the local config file. Refused when the env
// var is set (the file would silently do nothing, which is confusing).
export async function PUT(request: Request) {
  const env = process.env.BEADS_GITHUB_REPOS?.trim();
  if (env) {
    return Response.json({ error: "repos are configured via BEADS_GITHUB_REPOS" }, { status: 409 });
  }

  let repos: string[];
  try {
    const body = (await request.json()) as { repos?: unknown };
    repos = Array.isArray(body?.repos) ? (body.repos as string[]) : [];
  } catch {
    return Response.json({ error: "invalid request body" }, { status: 400 });
  }

  const normalized = repos.map((r) => r.trim().replace(/\/+$/, "").replace(/\.git$/, ""));
  if (normalized.some((slug) => slug !== "" && !GITHUB_SLUG_RE.test(slug))) {
    return Response.json({ error: "invalid repo slug" }, { status: 400 });
  }

  const valid = parseGithubRepos(repos.join(","));
  writeGithubRepos(valid.map((r) => r.slug));
  return Response.json({ repos: valid.map((r) => r.slug) });
}

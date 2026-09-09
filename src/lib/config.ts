import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Shared slug pattern for "owner/repo" GitHub repos. Both parseGithubRepos and
// the config write path validate against this so the two never disagree.
export const GITHUB_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface ViewBeadsConfig {
  githubRepos: string[];
}

function configPath(): string {
  return process.env.VIEW_BEADS_CONFIG ?? join(homedir(), ".config", "view-beads", "config.json");
}

// Normalize and validate slugs, dropping malformed entries and duplicates.
function normalizeSlugs(input: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of input) {
    const slug = entry.trim().replace(/\/+$/, "").replace(/\.git$/, "");
    if (!GITHUB_SLUG_RE.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    out.push(slug);
  }
  return out;
}

// Read the local config. Missing or corrupt file yields an empty config — the
// file is small and read synchronously on every request, and the server
// re-reads it each time so edits take effect without a restart.
export function readConfig(): ViewBeadsConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as { githubRepos?: unknown };
    const list = Array.isArray(parsed?.githubRepos) ? (parsed.githubRepos as string[]) : [];
    return { githubRepos: normalizeSlugs(list) };
  } catch {
    return { githubRepos: [] };
  }
}

// Persist the selected repos atomically (tmp file + rename) so a crash never
// leaves a half-written config behind.
export function writeGithubRepos(repos: string[]): void {
  const path = configPath();
  const valid = normalizeSlugs(repos);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ githubRepos: valid }, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

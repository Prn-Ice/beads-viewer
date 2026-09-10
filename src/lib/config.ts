import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Shared slug pattern for "owner/repo" GitHub repos. Both parseGithubRepos and
// the config write path validate against this so the two never disagree.
export const GITHUB_SLUG_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export type TunnelMode = "quick" | "named" | "token";

export interface TunnelSettings {
  mode: TunnelMode;
  name: string;
  token: string;
  url: string;
}

export interface ViewBeadsConfig {
  githubRepos: string[];
  tunnel?: TunnelSettings;
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

// Normalize and validate tunnel settings. Named tunnels need a name, token
// tunnels a token, and both need a public URL (cloudflared never reports the
// hostname of a proper tunnel, so the panel has to show a configured one).
export function normalizeTunnelSettings(input: unknown): TunnelSettings | null {
  if (typeof input !== "object" || input === null) return null;
  const raw = input as Record<string, unknown>;
  if (raw.mode !== "quick" && raw.mode !== "named" && raw.mode !== "token") return null;
  const mode: TunnelMode = raw.mode;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const token = typeof raw.token === "string" ? raw.token.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  if (mode === "named" && !name) return null;
  if (mode === "token" && !token) return null;
  if (mode !== "quick" && !url) return null;
  return { mode, name, token, url };
}

// Read the local config. Missing or corrupt file yields an empty config — the
// file is small and read synchronously on every request, and the server
// re-reads it each time so edits take effect without a restart.
export function readConfig(): ViewBeadsConfig {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as { githubRepos?: unknown; tunnel?: unknown };
    const list = Array.isArray(parsed?.githubRepos) ? (parsed.githubRepos as string[]) : [];
    const tunnel = normalizeTunnelSettings(parsed?.tunnel);
    return {
      githubRepos: normalizeSlugs(list),
      ...(tunnel ? { tunnel } : {}),
    };
  } catch {
    return { githubRepos: [] };
  }
}

// Persist atomically (tmp file + rename) so a crash never leaves a
// half-written config behind.
function writeConfig(next: ViewBeadsConfig): void {
  const path = configPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  renameSync(tmp, path);
}

// Persist the selected repos, keeping any tunnel settings.
export function writeGithubRepos(repos: string[]): void {
  writeConfig({ ...readConfig(), githubRepos: normalizeSlugs(repos) });
}

// Persist (or clear) the tunnel settings, keeping the repo selection.
export function writeTunnelSettings(tunnel: TunnelSettings | null): void {
  const next = { ...readConfig() };
  if (tunnel) next.tunnel = tunnel;
  else delete next.tunnel;
  writeConfig(next);
}

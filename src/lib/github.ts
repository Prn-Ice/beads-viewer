import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const GIT_TIMEOUT_MS = 120_000;
const SYNC_TTL_MS = 60_000;

export interface GithubRepo {
  slug: string; // "owner/repo"
}

// Parse BEADS_GITHUB_REPOS: comma-separated "owner/repo" entries.
export function parseGithubRepos(envValue: string | undefined): GithubRepo[] {
  if (!envValue) return [];
  const seen = new Set<string>();
  const repos: GithubRepo[] = [];
  for (const entry of envValue.split(",")) {
    const slug = entry.trim().replace(/\/+$/, "").replace(/\.git$/, "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(slug) || seen.has(slug)) continue;
    seen.add(slug);
    repos.push({ slug });
  }
  return repos;
}

function cacheRoot(): string {
  return process.env.BEADS_GITHUB_CACHE ?? join(homedir(), ".cache", "view-beads", "github");
}

export function cloneDir(repo: GithubRepo): string {
  return join(cacheRoot(), repo.slug);
}

function remoteUrl(slug: string): string {
  const base = process.env.BEADS_GITHUB_URL_BASE ?? "https://github.com";
  return `${base}/${slug}.git`;
}

function run(command: string, args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        // The server must never block on an interactive credential prompt;
        // git would ask on /dev/tty and hang the request until timeout.
        GIT_TERMINAL_PROMPT: "0",
        GCM_INTERACTIVE: "never",
      },
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} ${args[0]} timed out`));
    }, GIT_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`failed to start ${command}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim()}`));
        return;
      }
      resolve(stdout);
    });
  });
}

// Always pass the token via -c (per-invocation config) so it never lands in
// the clone's .git/config. GitHub's git endpoint only accepts Basic auth —
// Bearer gets a 401 and git would fall back to prompting — and scrub both the
// raw and base64 forms from any error we rethrow.
function runGit(args: string[], token: string): Promise<string> {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  const auth = ["-c", `http.extraheader=Authorization: Basic ${basic}`];
  return run("git", [...auth, ...args]).catch((err) => {
    const message = String(err instanceof Error ? err.message : err)
      .replaceAll(token, "***")
      .replaceAll(basic, "***");
    throw new Error(message);
  });
}

let tokenPromise: Promise<string> | null = null;

function ghToken(): Promise<string> {
  tokenPromise ??= run(process.env.GH_BIN ?? "gh", ["auth", "token"]).then((out) => {
    const token = out.trim();
    if (!token) throw new Error("gh auth token returned empty");
    return token;
  });
  // Don't cache failures: gh may be installed/authenticated later.
  tokenPromise.catch(() => {
    tokenPromise = null;
  });
  return tokenPromise;
}

const lastSync = new Map<string, number>();
const inflight = new Map<string, Promise<SyncOutcome>>();

export interface SyncOutcome {
  dir: string;
  /** True when the checkout gained new content (fresh clone or new commits). */
  changed: boolean;
}

export function syncGithubRepo(
  repo: GithubRepo,
  token: string,
  opts?: { force?: boolean },
): Promise<SyncOutcome> {
  const pending = inflight.get(repo.slug);
  if (pending) return pending;
  const promise = doSync(repo, token, opts).finally(() => {
    inflight.delete(repo.slug);
  });
  inflight.set(repo.slug, promise);
  return promise;
}

async function doSync(
  repo: GithubRepo,
  token: string,
  opts?: { force?: boolean },
): Promise<SyncOutcome> {
  const dir = cloneDir(repo);
  const isCloned = existsSync(join(dir, ".git"));
  const fresh = (lastSync.get(repo.slug) ?? 0) > Date.now() - SYNC_TTL_MS;
  if (isCloned && !opts?.force && fresh) return { dir, changed: false };

  try {
    if (isCloned) {
      const before = (await runGit(["-C", dir, "rev-parse", "HEAD"], token)).trim();
      await runGit(["-C", dir, "fetch", "--depth", "1", "origin", "HEAD"], token);
      await runGit(["-C", dir, "reset", "--hard", "FETCH_HEAD"], token);
      const after = (await runGit(["-C", dir, "rev-parse", "HEAD"], token)).trim();
      lastSync.set(repo.slug, Date.now());
      return { dir, changed: before !== after };
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dirname(dir), { recursive: true });
    await runGit(
      ["clone", "--depth", "1", "--filter=blob:none", "--sparse", remoteUrl(repo.slug), dir],
      token,
    );
    // A repo without .beads is fine: the checkout just stays empty.
    await runGit(["-C", dir, "sparse-checkout", "set", ".beads"], token).catch(() => {});
    lastSync.set(repo.slug, Date.now());
    return { dir, changed: true };
  } catch (err) {
    lastSync.set(repo.slug, Date.now()); // back off instead of retrying every poll
    if (isCloned) return { dir, changed: false }; // keep serving the stale clone
    // A failed clone (e.g. killed mid-transfer) leaves a partial .git that
    // would poison every later sync — remove it.
    rmSync(dir, { recursive: true, force: true });
    throw err;
  }
}

function hasDatabase(beadsDir: string): boolean {
  return existsSync(join(beadsDir, "embeddeddolt")) || existsSync(join(beadsDir, "dolt"));
}

// Git-synced beads repos contain only the JSONL exports — the database itself
// is gitignored — so bd cannot read a fresh clone until we materialize one
// with `bd init` + `bd import` (upsert). The database is derived local state;
// the clone is never pushed back. `bd init` does not emit JSON even with
// --json, so both run without it.
async function ensureDatabase(dir: string, beadsDir: string, changed: boolean): Promise<void> {
  const bd = process.env.BEADS_BIN ?? "bd";
  if (!hasDatabase(beadsDir)) {
    // --skip-agents/--skip-hooks keep bd from writing .claude/.codex agent
    // files and git hooks into what is meant to be a read-only mirror.
    await run(bd, ["init", "--skip-agents", "--skip-hooks"], dir);
    // bd init wires sync.remote back at the GitHub repo, which would let bd
    // auto-sync push to it. These clones are read-only views: drop the remote.
    const configPath = join(beadsDir, "config.yaml");
    try {
      const config = readFileSync(configPath, "utf8");
      const stripped = config.replace(/^sync\.remote:.*\n?/m, "");
      if (stripped !== config) writeFileSync(configPath, stripped);
    } catch {
      // Missing config.yaml is fine; bd regenerates what it needs.
    }
    await run(bd, ["import"], dir);
  } else if (changed && existsSync(join(beadsDir, "issues.jsonl"))) {
    await run(bd, ["import"], dir);
  }
}

// Kick off a forced re-sync of every configured repo. Fire-and-forget: the
// syncs are started (not awaited) so the caller (refresh) returns fast, and the
// inflight dedupe lets later per-repo requests join the in-flight syncs. gh
// auth failure or a failing repo only logs a warning — refresh must never fail.
export function forceSyncGithubRepos(): Promise<void> {
  const repos = parseGithubRepos(process.env.BEADS_GITHUB_REPOS);
  if (repos.length === 0) return Promise.resolve();

  return ghToken()
    .then((token) => {
      for (const repo of repos) {
        syncGithubRepo(repo, token, { force: true }).catch((err) => {
          console.warn(`force sync failed for ${repo.slug}: ${err instanceof Error ? err.message : err}`);
        });
      }
    })
    .catch((err) => {
      console.warn(`force sync skipped, gh auth failed: ${err instanceof Error ? err.message : err}`);
    });
}

export function hasTrackableBeads(beadsDir: string): boolean {
  return hasDatabase(beadsDir) || existsSync(join(beadsDir, "issues.jsonl"));
}

// Remotes whose clones already exist on disk with a materialized database,
// reported without any git/gh/bd work (pure filesystem check). Used by
// read-only sweeps like the needs-you inbox so they never trigger a sync.
export function listMaterializedGithubProjects(): { path: string; name: string }[] {
  const projects: { path: string; name: string }[] = [];
  for (const repo of parseGithubRepos(process.env.BEADS_GITHUB_REPOS)) {
    const beadsDir = join(cloneDir(repo), ".beads");
    if (existsSync(beadsDir) && hasDatabase(beadsDir)) {
      projects.push({ path: cloneDir(repo), name: repo.slug });
    }
  }
  return projects;
}

export type GithubLoadResult =
  | { state: "ok"; path: string; name: string }
  | { state: "empty" } // synced, but the repo has no trackable beads data
  | { state: "error"; message: string };

// Sync one repo, materialize its database, and report whether it contains a
// trackable beads project. Never throws: failures are reported so the caller
// can surface them per repo.
export async function loadGithubProject(repo: GithubRepo): Promise<GithubLoadResult> {
  let token: string;
  try {
    token = await ghToken();
  } catch {
    return { state: "error", message: "`gh auth token` failed — run `gh auth login`" };
  }

  let sync: SyncOutcome;
  try {
    sync = await syncGithubRepo(repo, token);
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }

  const beadsDir = join(sync.dir, ".beads");
  if (!existsSync(beadsDir) || !hasTrackableBeads(beadsDir)) return { state: "empty" };

  try {
    await ensureDatabase(sync.dir, beadsDir, sync.changed);
  } catch (err) {
    return { state: "error", message: err instanceof Error ? err.message : String(err) };
  }
  return { state: "ok", path: sync.dir, name: repo.slug };
}

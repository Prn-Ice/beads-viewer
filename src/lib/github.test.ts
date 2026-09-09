import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  cloneDir,
  forceSyncGithubRepos,
  loadGithubProject,
  parseGithubRepos,
  syncGithubRepo,
} from "./github";

const FAKE_GH = fileURLToPath(new URL("../../tests/fixtures/fake-gh.mjs", import.meta.url));

const ENV_KEYS = ["GH_BIN", "BEADS_GITHUB_REPOS", "BEADS_GITHUB_CACHE", "BEADS_GITHUB_URL_BASE"];

let savedEnv: Record<string, string | undefined>;
let root: string;
let remoteBase: string;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  root = mkdtempSync(join(tmpdir(), "view-beads-gh-"));
  remoteBase = join(root, "remote");
  process.env.GH_BIN = FAKE_GH;
  process.env.BEADS_GITHUB_CACHE = join(root, "cache");
  process.env.BEADS_GITHUB_URL_BASE = `file://${remoteBase}`;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function git(cwd: string, ...args: string[]) {
  execFileSync("git", args, {
    cwd,
    stdio: "pipe",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

function writeFiles(dir: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}

// Create a bare remote at <remoteBase>/<slug>.git containing `files`.
// Returns the seed working copy so tests can push more commits.
function makeRemote(slug: string, files: Record<string, string>): string {
  const bare = join(remoteBase, `${slug}.git`);
  mkdirSync(dirname(bare), { recursive: true });
  git(root, "init", "-b", "main", "--bare", bare);
  git(bare, "config", "uploadpack.allowFilter", "true");

  const work = join(root, `work-${slug.replace("/", "-")}`);
  git(root, "init", "-b", "main", work);
  git(work, "remote", "add", "origin", bare);
  writeFiles(work, files);
  git(work, "add", ".");
  git(work, "commit", "-m", "init");
  git(work, "push", "origin", "main");
  return work;
}

function push(work: string, files: Record<string, string>, message: string) {
  writeFiles(work, files);
  git(work, "add", ".");
  git(work, "commit", "-m", message);
  git(work, "push", "origin", "main");
}

describe("parseGithubRepos", () => {
  it("returns nothing for unset or empty input", () => {
    expect(parseGithubRepos(undefined)).toEqual([]);
    expect(parseGithubRepos("")).toEqual([]);
    expect(parseGithubRepos("  , ,")).toEqual([]);
  });

  it("parses comma-separated owner/repo entries", () => {
    expect(parseGithubRepos("a/b, c/d")).toEqual([{ slug: "a/b" }, { slug: "c/d" }]);
  });

  it("strips trailing slashes and .git suffixes", () => {
    expect(parseGithubRepos("a/b.git, c/d/")).toEqual([{ slug: "a/b" }, { slug: "c/d" }]);
  });

  it("skips malformed entries and duplicates", () => {
    expect(parseGithubRepos("justname, a/b/c, a b/c, ok/fine, ok/fine")).toEqual([
      { slug: "ok/fine" },
    ]);
  });
});

describe("loadGithubProject", { timeout: 30_000 }, () => {
  it("reports an error when gh auth fails", async () => {
    process.env.GH_BIN = join(root, "no-such-gh");
    const result = await loadGithubProject({ slug: "o/whatever" });
    expect(result.state).toBe("error");
    if (result.state === "error") expect(result.message).toMatch(/gh auth token/);
  });

  it("clones a repo with beads, materializes a database, and reports it", async () => {
    makeRemote("o/r1", {
      "README.md": "hello\n",
      "src/index.ts": "export {};\n",
      ".beads/issues.jsonl": '{"_type":"issue","id":"r1-1","title":"Test issue","status":"open"}\n',
    });

    const result = await loadGithubProject({ slug: "o/r1" });
    expect(result).toEqual({ state: "ok", path: join(root, "cache", "o/r1"), name: "o/r1" });
    // Sparse checkout: .beads materialized, other directories are not.
    expect(existsSync(join(root, "cache", "o/r1", ".beads", "issues.jsonl"))).toBe(true);
    expect(existsSync(join(root, "cache", "o/r1", "src", "index.ts"))).toBe(false);
    // The JSONL-only export was imported into a local database bd can read.
    expect(existsSync(join(root, "cache", "o/r1", ".beads", "embeddeddolt"))).toBe(true);
    // The clone is a read-only mirror: no push channel back to the remote,
    // and bd init must not have written agent or hook files into it.
    const config = readFileSync(join(root, "cache", "o/r1", ".beads", "config.yaml"), "utf8");
    expect(config).not.toMatch(/^sync\.remote:/m);
    expect(existsSync(join(root, "cache", "o/r1", ".claude"))).toBe(false);
    expect(existsSync(join(root, "cache", "o/r1", ".codex"))).toBe(false);
    expect(existsSync(join(root, "cache", "o/r1", ".git", "hooks", "pre-push"))).toBe(false);
  });

  it("reports empty for repos without beads", async () => {
    makeRemote("o/r2", { "README.md": "no beads here\n" });
    await expect(loadGithubProject({ slug: "o/r2" })).resolves.toEqual({ state: "empty" });
  });

  it("reports empty for repos whose .beads has no synced data", async () => {
    makeRemote("o/r3", {
      ".beads/metadata.json": "{}\n",
      ".beads/config.yaml": "{}\n",
    });
    await expect(loadGithubProject({ slug: "o/r3" })).resolves.toEqual({ state: "empty" });
  });

  it("reports an error and removes the partial clone when the clone fails", async () => {
    const result = await loadGithubProject({ slug: "o/missing" });
    expect(result.state).toBe("error");
    // A killed/failed clone must not leave a .git dir that poisons later syncs.
    expect(existsSync(join(root, "cache", "o/missing"))).toBe(false);
  });

  it("force sync picks up new commits and flags them as changed", async () => {
    const work = makeRemote("o/r4", { ".beads/issues.jsonl": '{"title":"v1"}\n' });
    await loadGithubProject({ slug: "o/r4" });

    push(work, { ".beads/issues.jsonl": '{"title":"v2"}\n' }, "update issues");
    const sync = await syncGithubRepo({ slug: "o/r4" }, "test-token", { force: true });
    expect(sync.changed).toBe(true);
    expect(readFileSync(join(sync.dir, ".beads", "issues.jsonl"), "utf8")).toBe('{"title":"v2"}\n');
  });

  it("serves the stale clone unchanged when the remote is gone", async () => {
    makeRemote("o/r5", { ".beads/issues.jsonl": '{"title":"v1"}\n' });
    await loadGithubProject({ slug: "o/r5" });

    rmSync(join(remoteBase, "o/r5.git"), { recursive: true });
    const sync = await syncGithubRepo({ slug: "o/r5" }, "test-token", { force: true });
    expect(sync.changed).toBe(false);
    expect(readFileSync(join(sync.dir, ".beads", "issues.jsonl"), "utf8")).toBe('{"title":"v1"}\n');
  });
});

describe("forceSyncGithubRepos", { timeout: 30_000 }, () => {
  it("re-fetches a new commit before the TTL would expire", async () => {
    process.env.BEADS_GITHUB_REPOS = "o/r6";
    const work = makeRemote("o/r6", { ".beads/issues.jsonl": '{"title":"v1"}\n' });
    await loadGithubProject({ slug: "o/r6" }); // clones + materializes

    push(work, { ".beads/issues.jsonl": '{"title":"v2"}\n' }, "update issues");
    await forceSyncGithubRepos();

    // forceSyncGithubRepos is fire-and-forget, so wait for the in-flight sync
    // to land the new commit instead of trusting its resolved promise.
    const dir = cloneDir({ slug: "o/r6" });
    const deadline = Date.now() + 15_000;
    let content = "";
    while (Date.now() < deadline) {
      content = readFileSync(join(dir, ".beads", "issues.jsonl"), "utf8");
      if (content === '{"title":"v2"}\n') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(content).toBe('{"title":"v2"}\n');
  });

  it("does not call git when no repos are configured", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    await expect(forceSyncGithubRepos()).resolves.toBeUndefined();
  });

  it("succeeds (logging a warning) when gh auth fails", async () => {
    process.env.BEADS_GITHUB_REPOS = "o/r7";
    process.env.GH_BIN = join(root, "no-such-gh");
    await expect(forceSyncGithubRepos()).resolves.toBeUndefined();
  });
});

describe("git invocation hardening", { timeout: 30_000 }, () => {
  let savedPath: string | undefined;
  let fakeBin: string;

  beforeEach(() => {
    savedPath = process.env.PATH;
    fakeBin = join(root, "fakebin");
    mkdirSync(fakeBin, { recursive: true });
  });

  afterEach(() => {
    if (savedPath === undefined) delete process.env.PATH;
    else process.env.PATH = savedPath;
  });

  // Shim git to fail any network op if prompts are not disabled, and to log
  // its args so the auth header can be inspected.
  function installFakeGit(logPath: string) {
    const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(fakeBin, "git"),
      [
        "#!/bin/sh",
        'for a in "$@"; do case "$a" in clone|fetch)',
        '  [ "$GIT_TERMINAL_PROMPT" = "0" ] || { echo "git would prompt" >&2; exit 42; };;',
        "esac; done",
        `printf '%s\\n' "$@" >> "${logPath}"`,
        `exec "${realGit}" "$@"`,
        "",
      ].join("\n"),
      { mode: 0o755 },
    );
    process.env.PATH = `${fakeBin}:${savedPath}`;
  }

  it("clones with a Basic auth header and terminal prompts disabled", async () => {
    makeRemote("o/auth", { ".beads/issues.jsonl": '{"title":"t"}\n' });
    const logPath = join(root, "git-args.log");
    installFakeGit(logPath);

    const result = await loadGithubProject({ slug: "o/auth" });
    expect(result.state).toBe("ok");

    // fake-gh.mjs prints ghp_fake_test_token; GitHub's git endpoint rejects
    // Bearer, so the header must be Basic x-access-token:<token>. (The shim
    // logs one arg per line, so -c and its value are separate lines.)
    const expected = Buffer.from("x-access-token:ghp_fake_test_token").toString("base64");
    expect(readFileSync(logPath, "utf8")).toContain(
      `http.extraheader=Authorization: Basic ${expected}\n`,
    );
  });
});

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig, writeGithubRepos } from "./config";

let root: string;
let configPath: string;
const ORIGINAL = process.env.VIEW_BEADS_CONFIG;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "view-beads-config-"));
  configPath = join(root, "sub", "config.json");
  mkdirSync(dirname(configPath), { recursive: true });
  process.env.VIEW_BEADS_CONFIG = configPath;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  if (ORIGINAL === undefined) delete process.env.VIEW_BEADS_CONFIG;
  else process.env.VIEW_BEADS_CONFIG = ORIGINAL;
});

describe("readConfig", () => {
  it("returns an empty config when the file is missing", () => {
    expect(readConfig()).toEqual({ githubRepos: [] });
  });

  it("reads the persisted repos", () => {
    writeGithubRepos(["o/r1", "o/r2"]);
    expect(readConfig()).toEqual({ githubRepos: ["o/r1", "o/r2"] });
  });

  it("returns an empty config for a corrupt file", () => {
    writeFileSync(configPath, "{ not json");
    expect(readConfig()).toEqual({ githubRepos: [] });
  });

  it("drops invalid slugs and ignores a non-array githubRepos field", () => {
    writeFileSync(configPath, JSON.stringify({ githubRepos: ["o/r1", "justname", "a/b/c"] }));
    expect(readConfig()).toEqual({ githubRepos: ["o/r1"] });
    writeFileSync(configPath, JSON.stringify({ githubRepos: "nope" }));
    expect(readConfig()).toEqual({ githubRepos: [] });
  });
});

describe("writeGithubRepos", () => {
  it("creates the parent directory and writes valid slugs only", () => {
    writeGithubRepos(["o/r1", "bad", "o/r1", "o/r2"]);
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      githubRepos: ["o/r1", "o/r2"],
    });
  });

  it("is idempotent and readConfig round-trips", () => {
    writeGithubRepos(["o/a", "o/b"]);
    writeGithubRepos(["o/a", "o/b"]);
    expect(readConfig()).toEqual({ githubRepos: ["o/a", "o/b"] });
  });
});

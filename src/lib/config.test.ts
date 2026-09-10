import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  normalizeTunnelSettings,
  readConfig,
  writeGithubRepos,
  writeTunnelSettings,
} from "./config";

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

  it("keeps tunnel settings when repos are written", () => {
    writeTunnelSettings({ mode: "named", name: "view-beads", token: "", url: "https://board.example.com" });
    writeGithubRepos(["o/a"]);
    expect(readConfig()).toEqual({
      githubRepos: ["o/a"],
      tunnel: { mode: "named", name: "view-beads", token: "", url: "https://board.example.com" },
    });
  });
});

describe("normalizeTunnelSettings", () => {
  it("accepts a quick tunnel without extra fields", () => {
    expect(normalizeTunnelSettings({ mode: "quick" })).toEqual({
      mode: "quick",
      name: "",
      token: "",
      url: "",
    });
  });

  it("trims fields and requires name + url for named tunnels", () => {
    expect(
      normalizeTunnelSettings({ mode: "named", name: " view-beads ", url: " https://b.example.com " }),
    ).toEqual({ mode: "named", name: "view-beads", token: "", url: "https://b.example.com" });
    expect(normalizeTunnelSettings({ mode: "named", url: "https://b.example.com" })).toBeNull();
    expect(normalizeTunnelSettings({ mode: "named", name: "view-beads" })).toBeNull();
  });

  it("requires token + url for token tunnels", () => {
    expect(
      normalizeTunnelSettings({ mode: "token", token: "secret", url: "https://b.example.com" }),
    ).toEqual({ mode: "token", name: "", token: "secret", url: "https://b.example.com" });
    expect(normalizeTunnelSettings({ mode: "token", token: "secret" })).toBeNull();
    expect(normalizeTunnelSettings({ mode: "token", url: "https://b.example.com" })).toBeNull();
  });

  it("rejects unknown modes and non-objects", () => {
    expect(normalizeTunnelSettings({ mode: "warp" })).toBeNull();
    expect(normalizeTunnelSettings(null)).toBeNull();
    expect(normalizeTunnelSettings("named")).toBeNull();
  });
});

describe("writeTunnelSettings", () => {
  it("round-trips through readConfig and keeps repos", () => {
    writeGithubRepos(["o/a"]);
    writeTunnelSettings({ mode: "token", name: "", token: "secret", url: "https://board.example.com" });
    expect(readConfig()).toEqual({
      githubRepos: ["o/a"],
      tunnel: { mode: "token", name: "", token: "secret", url: "https://board.example.com" },
    });
  });

  it("clears the tunnel settings when passed null", () => {
    writeTunnelSettings({ mode: "named", name: "view-beads", token: "", url: "https://b.example.com" });
    writeTunnelSettings(null);
    expect(readConfig()).toEqual({ githubRepos: [] });
  });
});

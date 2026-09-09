import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "./route";

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, readConfig: vi.fn(), writeGithubRepos: vi.fn() };
});

import { readConfig, writeGithubRepos } from "@/lib/config";

const ORIGINAL = process.env.BEADS_GITHUB_REPOS;

beforeEach(() => {
  vi.mocked(readConfig).mockReturnValue({ githubRepos: [] });
  vi.mocked(writeGithubRepos).mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllMocks();
  if (ORIGINAL === undefined) delete process.env.BEADS_GITHUB_REPOS;
  else process.env.BEADS_GITHUB_REPOS = ORIGINAL;
});

describe("GET /api/github/config", () => {
  it("reports 'none' with an empty list when nothing is configured", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    expect(await (await GET()).json()).toEqual({ repos: [], source: "none" });
  });

  it("reports 'file' with the persisted slugs", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    vi.mocked(readConfig).mockReturnValue({ githubRepos: ["o/r1", "o/r2"] });
    expect(await (await GET()).json()).toEqual({
      repos: ["o/r1", "o/r2"],
      source: "file",
    });
  });

  it("reports 'env' and wins over the file when BEADS_GITHUB_REPOS is set", async () => {
    process.env.BEADS_GITHUB_REPOS = "a/b, c/d";
    vi.mocked(readConfig).mockReturnValue({ githubRepos: ["o/r1"] });
    expect(await (await GET()).json()).toEqual({
      repos: ["a/b", "c/d"],
      source: "env",
    });
  });
});

describe("PUT /api/github/config", () => {
  function put(body: unknown) {
    return PUT(new Request("http://x", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    }));
  }

  it("refuses to write when BEADS_GITHUB_REPOS is set", async () => {
    process.env.BEADS_GITHUB_REPOS = "a/b";
    const res = await put({ repos: ["o/r1"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "repos are configured via BEADS_GITHUB_REPOS" });
    expect(writeGithubRepos).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid slug", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    const res = await put({ repos: ["o/r1", "justname"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid repo slug" });
    expect(writeGithubRepos).not.toHaveBeenCalled();
  });

  it("persists valid slugs and returns them", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    const res = await put({ repos: ["o/r1", "o/r2"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ repos: ["o/r1", "o/r2"] });
    expect(writeGithubRepos).toHaveBeenCalledWith(["o/r1", "o/r2"]);
  });
});

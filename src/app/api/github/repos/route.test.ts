import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGINAL = process.env.BEADS_GITHUB_REPOS;

beforeEach(() => {
  process.env.BEADS_GITHUB_REPOS = "a/b, c/d";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BEADS_GITHUB_REPOS;
  else process.env.BEADS_GITHUB_REPOS = ORIGINAL;
});

describe("GET /api/github/repos", () => {
  it("returns the configured slugs without syncing anything", async () => {
    const data = await (await GET()).json();
    expect(data).toEqual([{ slug: "a/b" }, { slug: "c/d" }]);
  });

  it("returns an empty list when nothing is configured", async () => {
    delete process.env.BEADS_GITHUB_REPOS;
    const data = await (await GET()).json();
    expect(data).toEqual([]);
  });
});

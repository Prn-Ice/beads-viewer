import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./route";

const ORIGINAL = process.env.BEADS_GITHUB_REPOS;
const ORIGINAL_CONFIG = process.env.VIEW_BEADS_CONFIG;

beforeEach(() => {
  process.env.BEADS_GITHUB_REPOS = "a/b, c/d";
  // Point at a non-existent temp file so the file fallback stays empty.
  process.env.VIEW_BEADS_CONFIG = "/tmp/view-beads-config-none.test.json";
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.BEADS_GITHUB_REPOS;
  else process.env.BEADS_GITHUB_REPOS = ORIGINAL;
  if (ORIGINAL_CONFIG === undefined) delete process.env.VIEW_BEADS_CONFIG;
  else process.env.VIEW_BEADS_CONFIG = ORIGINAL_CONFIG;
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";

vi.mock("@/lib/github", () => ({
  configuredGithubRepos: vi.fn(),
  loadGithubProject: vi.fn(),
}));
vi.mock("@/lib/bd", () => ({ runBd: vi.fn() }));

import { runBd } from "@/lib/bd";
import { configuredGithubRepos, loadGithubProject } from "@/lib/github";

const SUMMARY = {
  total_issues: 3,
  open_issues: 2,
  in_progress_issues: 1,
  blocked_issues: 0,
  closed_issues: 0,
  deferred_issues: 0,
  ready_issues: 2,
  pinned_issues: 0,
};

function get(slug: string) {
  return GET(new Request("http://x"), { params: Promise.resolve({ slug }) });
}

beforeEach(() => {
  vi.mocked(configuredGithubRepos).mockReturnValue([{ slug: "o/r" }]);
  vi.mocked(loadGithubProject).mockResolvedValue({
    state: "ok",
    path: "/cache/o/r",
    name: "o/r",
  });
  vi.mocked(runBd).mockResolvedValue({ summary: SUMMARY });
});

afterEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("GET /api/github/repos/[slug]", () => {
  it("rejects repos that are not configured", async () => {
    const res = await get("o/other");
    expect(res.status).toBe(404);
    expect(loadGithubProject).not.toHaveBeenCalled();
  });

  it("decodes percent-encoded slugs", async () => {
    const res = await get("o%2Fr");
    expect(res.status).toBe(200);
    expect(loadGithubProject).toHaveBeenCalledWith({ slug: "o/r" });
  });

  it("returns the project with its status summary", async () => {
    const data = await (await get("o/r")).json();
    expect(data.state).toBe("ok");
    expect(data.project).toMatchObject({
      name: "o/r",
      path: "/cache/o/r",
      source: "github",
      summary: SUMMARY,
    });
    expect(decodeURIComponent(data.project.id)).toBe("/cache/o/r");
    expect(runBd).toHaveBeenCalledWith(["status"], "/cache/o/r");
  });

  it("still returns the project when bd status fails", async () => {
    vi.mocked(runBd).mockRejectedValue(new Error("boom"));
    const data = await (await get("o/r")).json();
    expect(data.state).toBe("ok");
    expect(data.project.summary).toBeNull();
  });

  it("passes through the empty state", async () => {
    vi.mocked(loadGithubProject).mockResolvedValue({ state: "empty" });
    const data = await (await get("o/r")).json();
    expect(data).toEqual({ slug: "o/r", state: "empty" });
    expect(runBd).not.toHaveBeenCalled();
  });

  it("passes through sync errors", async () => {
    vi.mocked(loadGithubProject).mockResolvedValue({ state: "error", message: "nope" });
    const data = await (await get("o/r")).json();
    expect(data).toEqual({ slug: "o/r", state: "error", message: "nope" });
  });
});

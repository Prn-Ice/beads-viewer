import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";

vi.mock("@/lib/bd", () => ({ runBd: vi.fn() }));
vi.mock("@/lib/discovery", () => ({ discoverProjects: vi.fn() }));

import { runBd } from "@/lib/bd";
import { discoverProjects } from "@/lib/discovery";
import type { NeedsYouResponse } from "@/lib/needs-you";

const PROJECTS = [
  { path: "/tmp/a", name: "alpha" },
  { path: "/tmp/b", name: "beta" },
  { path: "/tmp/c", name: "gamma" },
  { path: "/tmp/d", name: "delta" },
];

function humanIssue(id: string, overrides: Record<string, unknown> = {}) {
  return { id, title: `Task ${id}`, status: "open", priority: 2, labels: ["human"], ...overrides };
}

async function getProjects(): Promise<NeedsYouResponse["projects"]> {
  const data = (await (await GET()).json()) as NeedsYouResponse;
  return data.projects;
}

beforeEach(() => {
  vi.mocked(discoverProjects).mockReturnValue(PROJECTS);
  vi.mocked(runBd).mockResolvedValue([]);
});

afterEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("GET /api/needs-you", () => {
  it("reports malformed CLI output instead of pretending the inbox is empty", async () => {
    vi.mocked(runBd).mockResolvedValue({ unexpected: true });
    const projects = await getProjects();
    expect(projects.every((project) => project.error?.includes("Unexpected bd response"))).toBe(true);
  });
  it("runs the exact cached CLI query per project and normalizes candidates", async () => {
    vi.mocked(runBd).mockResolvedValue([
      humanIssue("a-1"),
      humanIssue("a-2", { priority: 0 }),
      humanIssue("closed", { status: "closed" }),
      humanIssue("nolabel", { labels: [] }),
      humanIssue("future-defer", { defer_until: new Date(Date.now() + 86_400_000).toISOString() }),
      humanIssue("past-defer", { defer_until: new Date(Date.now() - 86_400_000).toISOString() }),
      { id: "malformed" },
    ]);

    const projects = await getProjects();

    expect(runBd).toHaveBeenCalledTimes(PROJECTS.length);
    for (const project of PROJECTS) {
      expect(runBd).toHaveBeenCalledWith(
        ["list", "--label", "human", "--ready", "--status", "open", "--limit", "0"],
        project.path,
      );
    }
    const alpha = projects.find((p) => p.name === "alpha");
    expect(alpha?.issues.map((i) => i.id)).toEqual(["a-2", "a-1", "past-defer"]); // priority 0 first
    expect(alpha?.error).toBeUndefined();
  });

  it("bounds cross-project fetching to three concurrent bd calls", async () => {
    let inFlight = 0;
    let maxConcurrent = 0;
    vi.mocked(runBd).mockImplementation(async () => {
      inFlight++;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return [];
    });

    await getProjects();

    expect(runBd).toHaveBeenCalledTimes(PROJECTS.length);
    expect(maxConcurrent).toBe(3);
  });

  it("caches the loaded snapshot per project within the TTL", async () => {
    vi.mocked(runBd).mockResolvedValue([humanIssue("a-1")]);

    await getProjects();
    await getProjects();

    expect(runBd).toHaveBeenCalledTimes(PROJECTS.length);
  });

  it("reports per-project errors explicitly and retries them on the next request", async () => {
    vi.mocked(runBd).mockImplementation(async (_args, cwd) => {
      if (cwd === "/tmp/b") throw new Error("boom");
      return [humanIssue("a-1")];
    });

    const first = await getProjects();
    const beta = first.find((p) => p.name === "beta");
    expect(beta?.error).toContain("boom");
    expect(beta?.issues).toEqual([]);
    const alpha = first.find((p) => p.name === "alpha");
    expect(alpha?.issues.map((i) => i.id)).toEqual(["a-1"]);

    // Failed loads are not cached, so a later request retries them.
    vi.mocked(runBd).mockImplementation(async (_args, cwd) =>
      cwd === "/tmp/b" ? [humanIssue("b-1")] : [],
    );
    const second = await getProjects();
    expect(second.find((p) => p.name === "beta")?.issues.map((i) => i.id)).toEqual(["b-1"]);
    expect(second.find((p) => p.name === "beta")?.error).toBeUndefined();
  });

  it("returns an empty snapshot when no projects are discovered", async () => {
    vi.mocked(discoverProjects).mockReturnValue([]);

    const data = (await (await GET()).json()) as NeedsYouResponse;
    expect(data.projects).toEqual([]);
  });
});

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBd } from "@/lib/bd";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";

vi.mock("@/lib/bd", () => ({ runBd: vi.fn() }));

const mockedRunBd = vi.mocked(runBd);

function params(id: string, issueId: string) {
  return { params: Promise.resolve({ id, issueId }) };
}

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "view-beads-children-"));
  mkdirSync(join(projectDir, ".beads"));
  clearCache();
  mockedRunBd.mockReset();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("children endpoint", () => {
  it("rejects unknown projects without calling bd", async () => {
    const res = await GET(new Request("http://test"), params("missing", "epic-1"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown project" });
    expect(mockedRunBd).not.toHaveBeenCalled();
  });

  it("asks bd for ALL direct children including closed", async () => {
    mockedRunBd.mockResolvedValue([
      { id: "epic-1", title: "A", status: "open", priority: 0 },
      { id: "epic-2", title: "B", status: "closed", issue_type: "task" },
      { id: "epic-3", title: "C", status: "blocked" },
    ]);

    const res = await GET(new Request("http://test"), params(projectDir, "epic-root"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "epic-1", title: "A", status: "open", priority: 0, issue_type: undefined },
      { id: "epic-2", title: "B", status: "closed", issue_type: "task" },
      { id: "epic-3", title: "C", status: "blocked", issue_type: undefined },
    ]);

    expect(mockedRunBd).toHaveBeenCalledTimes(1);
    expect(mockedRunBd).toHaveBeenCalledWith(
      ["list", "--parent", "epic-root", "--status", "all", "--limit", "0"],
      projectDir,
    );
  });

  it("returns an empty list for a missing parent", async () => {
    mockedRunBd.mockResolvedValue([]);
    const res = await GET(new Request("http://test"), params(projectDir, "ghost-epic"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });
});

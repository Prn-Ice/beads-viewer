import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runBd } from "@/lib/bd";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";
import type { BeadsIssue } from "@/lib/types";

vi.mock("@/lib/bd", () => ({ runBd: vi.fn() }));

const mockedRunBd = vi.mocked(runBd);

const rootRecord: BeadsIssue = {
  id: "root-1",
  title: "Root",
  status: "in_progress",
  dependents: [{ id: "c-1", title: "Issue c-1", status: "open", dependency_type: "blocks" }],
  dependent_count: 1,
  dependency_count: 0,
  comment_count: 0,
};

const candidateRecord: BeadsIssue = {
  id: "c-1",
  title: "Issue c-1",
  status: "open",
  dependencies: [{ id: "root-1", title: "Root", status: "open", dependency_type: "blocks" }],
  dependency_count: 1,
  dependent_count: 0,
  comment_count: 0,
};

const explain = {
  schema_version: 1,
  blocked: [{ id: "c-1", blocked_by: [{ id: "root-1", title: "Root", status: "in_progress" }], blocked_by_count: 1 }],
  ready: [],
  summary: { cycle_count: 0, total_ready: 0, total_blocked: 1 },
};

let projectDir: string;

function params(issueId = "root-1") {
  return { params: Promise.resolve({ id: projectDir, issueId }) };
}

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "view-beads-unblocks-"));
  mkdirSync(join(projectDir, ".beads"));
  clearCache();
  mockedRunBd.mockReset();
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function stubBd() {
  mockedRunBd.mockImplementation(async (args: string[]) => {
    switch (args[0]) {
      case "show":
        if (args.includes("--include-dependents")) return [rootRecord];
        return args.slice(1).map((id) => ({ ...candidateRecord, id }));
      case "ready":
        return explain;
      default:
        throw new Error(`unexpected command: ${args.join(" ")}`);
    }
  });
}

describe("unblocks endpoint", () => {
  it("rejects unknown projects without calling bd", async () => {
    const res = await GET(new Request("http://test"), { params: Promise.resolve({ id: "missing", issueId: "root-1" }) });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown project" });
    expect(mockedRunBd).not.toHaveBeenCalled();
  });

  it("returns 404 when the root issue cannot be shown", async () => {
    mockedRunBd.mockRejectedValue(new Error("bd show root-1 exited 1: not found"));
    const res = await GET(new Request("http://test"), params());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "issue not found" });
  });

  it("asks bd for the hydrated root, the project explain, and one batch show", async () => {
    stubBd();
    const res = await GET(new Request("http://test"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.rootId).toBe("root-1");
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ id: "c-1", verdict: "likely" });
    expect(body.missing).toEqual([]);

    expect(mockedRunBd).toHaveBeenCalledTimes(3);
    expect(mockedRunBd).toHaveBeenNthCalledWith(1, ["show", "root-1", "--include-dependents"], projectDir);
    expect(mockedRunBd).toHaveBeenNthCalledWith(2, ["ready", "--explain", "--limit", "0"], projectDir);
    expect(mockedRunBd).toHaveBeenNthCalledWith(3, ["show", "c-1"], projectDir);
  });

  it("caches within the TTL so repeated opens do not re-run bd", async () => {
    stubBd();
    await GET(new Request("http://test"), params());
    await GET(new Request("http://test"), params());
    await GET(new Request("http://test"), params());
    expect(mockedRunBd).toHaveBeenCalledTimes(3);
  });

  it("caps dependents at 25, reports omitted, and batches only the capped ids", async () => {
    const wide: BeadsIssue = {
      ...rootRecord,
      dependents: Array.from({ length: 30 }, (_, i) => ({
        id: `c-${i}`,
        title: `Issue c-${i}`,
        status: "open",
        dependency_type: "blocks" as const,
      })),
      dependent_count: 30,
    };
    mockedRunBd.mockImplementation(async (args: string[]) => {
      if (args[0] === "show" && args.includes("--include-dependents")) return [wide];
      if (args[0] === "ready") return explain;
      if (args[0] === "show") return args.slice(1).map((id) => ({ ...candidateRecord, id }));
      throw new Error("unexpected");
    });
    const res = await GET(new Request("http://test"), params());
    const body = await res.json();
    expect(body.candidates).toHaveLength(25);
    expect(body.omitted).toBe(5);
    const batchCall = mockedRunBd.mock.calls.find(([args]) => args[0] === "show" && !args.includes("--include-dependents"))!;
    expect(batchCall[0]).toHaveLength(26); // "show" + 25 ids
  });

  it("treats an unsupported explain shape as a project-level verification note", async () => {
    mockedRunBd.mockImplementation(async (args: string[]) => {
      if (args[0] === "show" && args.includes("--include-dependents")) return [rootRecord];
      if (args[0] === "ready") return { blocked: [], ready: [], schema_version: 9, summary: { cycle_count: 0, total_ready: 0, total_blocked: 0 } };
      if (args[0] === "show") return [candidateRecord];
      throw new Error("unexpected");
    });
    const res = await GET(new Request("http://test"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projectNote).toContain("unsupported shape");
    expect(body.candidates[0].verdict).toBe("verify");
  });

  it("keeps a failed batch show per-candidate: every record is reported missing and verified", async () => {
    mockedRunBd.mockImplementation(async (args: string[]) => {
      if (args[0] === "show" && args.includes("--include-dependents")) return [rootRecord];
      if (args[0] === "ready") return explain;
      if (args[0] === "show") throw new Error("bd show c-1 exited 2");
      throw new Error("unexpected");
    });
    const res = await GET(new Request("http://test"), params());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.missing).toEqual(["c-1"]);
    expect(body.candidates[0]).toMatchObject({ id: "c-1", verdict: "verify" });
  });

  it("does not cache a failed bd call, so a retry can recover", async () => {
    let calls = 0;
    mockedRunBd.mockImplementation(async (args: string[]) => {
      if (args[0] === "ready") {
        calls += 1;
        if (calls === 1) throw new Error("transient failure");
        return explain;
      }
      if (args[0] === "show" && args.includes("--include-dependents")) return [rootRecord];
      if (args[0] === "show") return [candidateRecord];
      throw new Error("unexpected");
    });
    const first = await GET(new Request("http://test"), params());
    expect((await first.json()).projectNote).toContain("transient failure");
    const second = await GET(new Request("http://test"), params());
    const body = await second.json();
    expect(body.projectNote).toBeUndefined();
    expect(body.candidates[0].verdict).toBe("likely");
  });
});
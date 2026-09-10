import { describe, expect, it } from "vitest";
import {
  UNBLOCK_CANDIDATE_CAP,
  analyzeUnblocks,
  parseReadyExplain,
  unblockCandidates,
  type ExplainBlockedItem,
  type ReadyExplain,
  type UnblocksAnalysis,
} from "./unblocks";
import type { BeadsIssue, DependencyRef } from "./types";

const NOW = new Date("2026-09-08T12:00:00Z").getTime();

function hydratedDependent(id: string, type = "blocks", status = "open"): DependencyRef {
  return { id, title: `Issue ${id}`, dependency_type: type, status };
}

function rootIssue(dependents: DependencyRef[]): BeadsIssue {
  return {
    id: "root-1",
    title: "Root issue",
    status: "in_progress",
    dependents,
    dependent_count: dependents.length,
    dependency_count: 0,
    comment_count: 0,
  };
}

function candidate(id: string, deps: DependencyRef[], extra: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id,
    title: `Issue ${id}`,
    status: "open",
    dependencies: deps,
    dependency_count: deps.length,
    dependent_count: 0,
    comment_count: 0,
    ...extra,
  };
}

function blockedItem(id: string, blockers: { id: string; title?: string; status?: string }[], count?: number): ExplainBlockedItem {
  return { id, blocked_by: blockers, blocked_by_count: count ?? blockers.length };
}

function explain(blocked: ExplainBlockedItem[], ready: string[] = [], cycle = 0): ReadyExplain {
  return {
    schema_version: 1,
    ready: ready.map((id) => ({ id })),
    blocked,
    summary: { cycle_count: cycle, total_ready: ready.length, total_blocked: blocked.length },
  };
}

function analyze(root: BeadsIssue, exp: ReadyExplain | null, records: Record<string, BeadsIssue>): UnblocksAnalysis {
  return analyzeUnblocks(root, exp, new Map(Object.entries(records)), NOW);
}

function verdictFor(analysis: UnblocksAnalysis, id: string) {
  return analysis.candidates.find((candidate) => candidate.id === id);
}

describe("parseReadyExplain", () => {
  it("accepts the installed bd 1.2.2 explain document", () => {
    const parsed = parseReadyExplain({
      blocked: [{ id: "b-1", blocked_by: [{ id: "a-1", title: "A", status: "open" }], blocked_by_count: 1 }],
      ready: [],
      schema_version: 1,
      summary: { cycle_count: 0, total_ready: 0, total_blocked: 1 },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.summary?.cycle_count).toBe(0);
  });
  it("rejects non-objects, missing arrays, unknown schema versions, and missing cycle_count", () => {
    expect(parseReadyExplain(null)).toBeNull();
    expect(parseReadyExplain("nope")).toBeNull();
    expect(parseReadyExplain({ blocked: [], ready: [] })).toBeNull();
    expect(parseReadyExplain({ blocked: [], ready: [], schema_version: 2, summary: { cycle_count: 0 } })).toBeNull();
    // A missing cycle_count is unknown cycle state, not zero.
    expect(parseReadyExplain({ blocked: [], ready: [], summary: { total_ready: 0, total_blocked: 0 } })).toBeNull();
  });
});

describe("unblockCandidates", () => {
  it("takes blocks, parent-child, waits-for, and conditional-blocks dependents; prefers blocks; caps at 25", () => {
    const root = rootIssue([
      hydratedDependent("a", "blocks"),
      hydratedDependent("b", "parent-child"),
      hydratedDependent("c", "related"),
      hydratedDependent("d", "blocks"),
      hydratedDependent("e", "waits-for"),
      hydratedDependent("f", "conditional-blocks"),
      hydratedDependent("b", "blocks"), // same id, later blocks edge wins
    ]);
    const { list, omitted } = unblockCandidates(root);
    expect(list.map((dep) => [dep.id, dep.edgeType])).toEqual([
      ["a", "blocks"],
      ["b", "blocks"],
      ["d", "blocks"],
      ["e", "waits-for"],
      ["f", "conditional-blocks"],
    ]);
    expect(omitted).toBe(0);
  });
  it("skips self-links, unresolved refs, and counts omitted past the cap", () => {
    const wide = Array.from({ length: UNBLOCK_CANDIDATE_CAP + 3 }, (_, i) => hydratedDependent(`w-${i}`));
    const root = rootIssue([...wide, hydratedDependent("root-1"), { type: "blocks" }]);
    const { list, omitted } = unblockCandidates(root);
    expect(list).toHaveLength(UNBLOCK_CANDIDATE_CAP);
    expect(omitted).toBe(3);
    expect(list.some((dep) => dep.id === "root-1")).toBe(false);
  });
});

describe("positive path (sole active blocker)", () => {
  it("flags a clean ordinary dependent as likely ready", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const analysis = analyze(root, exp, records);
    expect(verdictFor(analysis, "c-1")).toMatchObject({ verdict: "likely", reason: "Would become ready." });
  });
  it("treats resolved blocks edges and pure associations as harmless", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = {
      "c-1": candidate("c-1", [
        { id: "root-1", dependency_type: "blocks", status: "open" },
        { id: "done-1", dependency_type: "blocks", status: "closed" },
        { id: "assoc-1", dependency_type: "related" },
        { id: "assoc-2", dependency_type: "validates" },
      ]),
    };
    expect(verdictFor(analyze(root, exp, records), "c-1")?.verdict).toBe("likely");
  });
  it("a second active blocker reports the remaining blockers and is not likely", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }, { id: "other-1", title: "Other", status: "open" }])]);
    const records = {
      "c-1": candidate("c-1", [
        { id: "root-1", dependency_type: "blocks", status: "open" },
        { id: "other-1", dependency_type: "blocks", status: "open" },
      ]),
    };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result).toMatchObject({
      verdict: "not-likely",
      remainingBlockers: [{ id: "other-1", title: "Other", status: "open" }],
    });
    expect(result?.reason).toContain("Also blocked by");
  });
  it("a candidate blocked by someone else lists its remaining blockers", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "other-1", title: "Other", status: "open" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "other-1", dependency_type: "blocks", status: "open" }]) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("not-likely");
    expect(result?.reason).toContain("Still blocked by other-1 (Other, open)");
    expect(result?.remainingBlockers).toEqual([{ id: "other-1", title: "Other", status: "open" }]);
  });
  it("a candidate that is already ready is not newly ready", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([], ["c-1"]);
    const records = { "c-1": candidate("c-1", []) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result).toMatchObject({ verdict: "not-likely", reason: "Already ready." });
  });
});

describe("root-level conditions", () => {
  it("a closed root forces verification instead of positive verdicts", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    root.status = "closed";
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const analysis = analyze(root, exp, records);
    expect(analysis.projectNote).toContain("This issue is closed");
    expect(verdictFor(analysis, "c-1")?.verdict).toBe("verify");
  });
  it("a project with dependency cycles forces verification", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])], [], 2);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const analysis = analyze(root, exp, records);
    expect(analysis.projectCycleCount).toBe(2);
    expect(analysis.projectNote).toContain("cycle");
    expect(verdictFor(analysis, "c-1")?.verdict).toBe("verify");
  });
  it("a missing explain document forces verification with the route note", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const analysis = analyzeUnblocks(root, null, new Map(Object.entries(records)), NOW, "bd ready --explain failed (boom)");
    expect(analysis.projectNote).toBe("bd ready --explain failed (boom)");
    expect(verdictFor(analysis, "c-1")?.verdict).toBe("verify");
  });
  it("a hooked root is still completable work", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    root.status = "hooked";
    const exp = explain([blockedItem("c-1", [{ id: "root-1", status: "hooked" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "hooked" }]) };
    expect(verdictFor(analyze(root, exp, records), "c-1")?.verdict).toBe("likely");
  });
});

describe("snapshot contradictions", () => {
  it("an issue reported as both ready and blocked is verified, never estimated", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = {
      schema_version: 1,
      ready: [{ id: "c-1" }],
      blocked: [blockedItem("c-1", [{ id: "root-1" }])],
      summary: { cycle_count: 0, total_ready: 1, total_blocked: 1 },
    };
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("both ready and blocked");
  });
  it("a root status that disagrees between the record and the readiness snapshot is verified", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1", status: "closed" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("doesn't match between bd's data sources");
  });
  it("waits-for and conditional-blocks dependents appear as verification results", () => {
    const root = rootIssue([hydratedDependent("gate", "waits-for"), hydratedDependent("cond", "conditional-blocks")]);
    const exp = explain([
      blockedItem("gate", [{ id: "root-1" }]),
      blockedItem("cond", [{ id: "root-1" }]),
    ]);
    const records = {
      gate: candidate("gate", [{ id: "root-1", dependency_type: "waits-for", status: "open" }]),
      cond: candidate("cond", [{ id: "root-1", dependency_type: "conditional-blocks", status: "open" }]),
    };
    const analysis = analyze(root, exp, records);
    expect(analysis.candidates).toHaveLength(2);
    expect(verdictFor(analysis, "gate")?.verdict).toBe("verify");
    expect(verdictFor(analysis, "gate")?.reason).toContain("waits-for");
    expect(verdictFor(analysis, "cond")?.verdict).toBe("verify");
    expect(verdictFor(analysis, "cond")?.reason).toContain("conditional-blocks");
  });
});

describe("candidate eligibility", () => {
  it.each(["in_progress", "blocked", "deferred", "closed"] as const)("excludes a %s candidate", (status) => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }], { status }) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("not-likely");
    expect(result?.reason).toContain(status);
  });
  it("verifies non-ordinary work types, pinned, and ephemeral candidates", () => {
    const root = rootIssue([hydratedDependent("epic"), hydratedDependent("pin"), hydratedDependent("wisp")]);
    const exp = explain([
      blockedItem("epic", [{ id: "root-1" }]),
      blockedItem("pin", [{ id: "root-1" }]),
      blockedItem("wisp", [{ id: "root-1" }]),
    ]);
    const records = {
      epic: candidate("epic", [{ id: "root-1", dependency_type: "blocks", status: "open" }], { issue_type: "epic" }),
      pin: candidate("pin", [{ id: "root-1", dependency_type: "blocks", status: "open" }], { pinned: true }),
      wisp: candidate("wisp", [{ id: "root-1", dependency_type: "blocks", status: "open" }], { ephemeral: true }),
    };
    const analysis = analyze(root, exp, records);
    expect(verdictFor(analysis, "epic")?.reason).toContain("isn't regular work");
    expect(verdictFor(analysis, "pin")?.reason).toContain("pinned");
    expect(verdictFor(analysis, "wisp")?.reason).toContain("ephemeral");
  });
});

describe("time, hierarchy, and relationship types", () => {
  it("a future defer is not likely, an invalid one is verified, a past one is fine", () => {
    const root = rootIssue([hydratedDependent("future"), hydratedDependent("bad"), hydratedDependent("past")]);
    const exp = explain([
      blockedItem("future", [{ id: "root-1" }]),
      blockedItem("bad", [{ id: "root-1" }]),
      blockedItem("past", [{ id: "root-1" }]),
    ]);
    const base = [{ id: "root-1", dependency_type: "blocks", status: "open" }];
    const records = {
      future: candidate("future", base, { defer_until: "2026-10-01T00:00:00Z" }),
      bad: candidate("bad", base, { defer_until: "not-a-date" }),
      past: candidate("past", base, { defer_until: "2026-01-01T00:00:00Z" }),
    };
    const analysis = analyze(root, exp, records);
    expect(verdictFor(analysis, "future")).toMatchObject({ verdict: "not-likely", reason: "Deferred until 2026-10-01T00:00:00Z." });
    expect(verdictFor(analysis, "bad")).toMatchObject({ verdict: "verify", reason: "It has an invalid defer date; check manually." });
    expect(verdictFor(analysis, "past")?.verdict).toBe("likely");
  });
  it("a parent-child edge on the candidate needs verification", () => {
    const root = rootIssue([hydratedDependent("child")]);
    const exp = explain([blockedItem("child", [{ id: "root-1" }])]);
    const records = {
      child: candidate("child", [
        { id: "root-1", dependency_type: "blocks", status: "open" },
        { id: "parent-1", dependency_type: "parent-child", status: "open" },
      ]),
    };
    const result = verdictFor(analyze(root, exp, records), "child");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("parent/child");
  });
  it("parent inheritance (root edge typed parent-child) needs verification", () => {
    const root = rootIssue([hydratedDependent("child", "parent-child")]);
    const exp = explain([blockedItem("child", [{ id: "root-1" }])]);
    const records = { child: candidate("child", [{ id: "root-1", dependency_type: "parent-child", status: "open" }]) };
    const result = verdictFor(analyze(root, exp, records), "child");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("not a blocking link");
  });
  it("conditional-blocks, waits-for, until, and unknown types need verification", () => {
    const root = rootIssue([hydratedDependent("cond"), hydratedDependent("wait"), hydratedDependent("until"), hydratedDependent("weird")]);
    const exp = explain([
      blockedItem("cond", [{ id: "root-1" }]),
      blockedItem("wait", [{ id: "root-1" }]),
      blockedItem("until", [{ id: "root-1" }]),
      blockedItem("weird", [{ id: "root-1" }]),
    ]);
    const records = {
      cond: candidate("cond", [{ id: "root-1", dependency_type: "blocks", status: "open" }, { id: "x", dependency_type: "conditional-blocks", status: "open" }]),
      wait: candidate("wait", [{ id: "root-1", dependency_type: "blocks", status: "open" }, { id: "y", dependency_type: "waits-for", status: "open" }]),
      until: candidate("until", [{ id: "root-1", dependency_type: "blocks", status: "open" }, { id: "z", dependency_type: "until", status: "open" }]),
      weird: candidate("weird", [{ id: "root-1", dependency_type: "blocks", status: "open" }, { id: "q", dependency_type: "custom-thing" }]),
    };
    const analysis = analyze(root, exp, records);
    expect(verdictFor(analysis, "cond")?.reason).toContain("conditional-blocks");
    expect(verdictFor(analysis, "wait")?.reason).toContain("waits-for");
    expect(verdictFor(analysis, "until")?.reason).toContain("until");
    expect(verdictFor(analysis, "weird")?.reason).toContain("custom-thing");
  });
});

describe("incomplete data", () => {
  it("missing blocker counts and empty blocker lists are verified, not positive", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const noCount = analyze(root, explain([{ id: "c-1", blocked_by: [{ id: "root-1" }] }]), records);
    const emptyBy = analyze(root, explain([blockedItem("c-1", [], 0)]), records);
    expect(verdictFor(noCount, "c-1")?.verdict).toBe("verify");
    expect(verdictFor(emptyBy, "c-1")?.verdict).toBe("verify");
  });
  it("a blocked_by count that disagrees with the list is verified", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }], 2)]);
    const records = { "c-1": candidate("c-1", [{ id: "root-1", dependency_type: "blocks", status: "open" }]) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("don't add up");
  });
  it("missing candidate records are reported and verified", () => {
    const root = rootIssue([hydratedDependent("ghost")]);
    const exp = explain([blockedItem("ghost", [{ id: "root-1" }])]);
    const analysis = analyze(root, exp, {});
    expect(analysis.missing).toEqual(["ghost"]);
    expect(verdictFor(analysis, "ghost")?.verdict).toBe("verify");
  });
  it("partially loaded or missing dependency counts are verified", () => {
    const root = rootIssue([hydratedDependent("partial"), hydratedDependent("nocount")]);
    const exp = explain([
      blockedItem("partial", [{ id: "root-1" }]),
      blockedItem("nocount", [{ id: "root-1" }]),
    ]);
    const partial = candidate("partial", [{ id: "root-1", dependency_type: "blocks", status: "open" }], { dependency_count: 4 });
    // bd omits counts entirely when the shape drifts; the analysis must not guess.
    const nocount = {
      id: "nocount",
      title: "Issue nocount",
      status: "open",
      dependencies: [{ id: "root-1", dependency_type: "blocks", status: "open" }],
    } as BeadsIssue;
    const analysis = analyze(root, exp, { partial, nocount });
    expect(verdictFor(analysis, "partial")?.reason).toContain("Only 1 of 4 dependencies");
    expect(verdictFor(analysis, "nocount")?.reason).toContain("dependency list is missing");
  });
  it("a blocks dependency with unknown status is verified", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = {
      "c-1": candidate("c-1", [
        { id: "root-1", dependency_type: "blocks", status: "open" },
        { id: "mystery", dependency_type: "blocks" },
      ]),
    };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("unknown status");
  });
  it("an open blocks dependency in the candidate record contradicts the explain and is verified", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = {
      "c-1": candidate("c-1", [
        { id: "root-1", dependency_type: "blocks", status: "open" },
        { id: "open-1", dependency_type: "blocks", status: "open" },
      ]),
    };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("open-1");
  });
  it("a candidate whose record lacks the root edge is verified", () => {
    const root = rootIssue([hydratedDependent("c-1")]);
    const exp = explain([blockedItem("c-1", [{ id: "root-1" }])]);
    const records = { "c-1": candidate("c-1", [{ id: "other", dependency_type: "blocks", status: "closed" }]) };
    const result = verdictFor(analyze(root, exp, records), "c-1");
    expect(result?.verdict).toBe("verify");
    expect(result?.reason).toContain("doesn't show this issue blocking it");
  });
});
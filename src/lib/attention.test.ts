import { describe, expect, it } from "vitest";
import { computeNeedsAttention, MS_PER_DAY } from "./attention";
import type { BeadsIssue } from "./types";

const NOW = Date.parse("2026-09-08T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW - days * MS_PER_DAY).toISOString();
}

function makeIssue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "t-1",
    title: "Test issue",
    status: "open",
    priority: 2,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    created_at: daysAgo(10),
    updated_at: daysAgo(5),
    ...overrides,
  };
}

const THRESHOLDS = { urgentDays: 3, stallDays: 14 };

function reasonsFor(issue: BeadsIssue): { rule: string; inactiveDays: number }[] {
  const items = computeNeedsAttention([issue], THRESHOLDS, NOW);
  if (items.length === 0) return [];
  return items[0].reasons.map((r) => ({ rule: r.rule, inactiveDays: r.inactiveDays }));
}

describe("computeNeedsAttention", () => {
  it("flags urgent P0/P1 issues inactive past the urgent threshold", () => {
    const p0 = reasonsFor(makeIssue({ priority: 0 }));
    expect(p0.map((r) => r.rule)).toEqual(["urgent"]);
    expect(p0[0].inactiveDays).toBeCloseTo(5, 6);

    const p1 = reasonsFor(makeIssue({ priority: 1 }));
    expect(p1.map((r) => r.rule)).toEqual(["urgent"]);
  });

  it("flags in_progress issues stalled past the stall threshold", () => {
    const reasons = reasonsFor(
      makeIssue({ status: "in_progress", updated_at: daysAgo(20) }),
    );
    expect(reasons.map((r) => r.rule)).toEqual(["stalled"]);
    expect(reasons[0].inactiveDays).toBeCloseTo(20, 6);
  });

  it("combines urgent and stalled reasons into one item", () => {
    const issue = makeIssue({ status: "in_progress", priority: 0, updated_at: daysAgo(20) });
    const items = computeNeedsAttention([issue], THRESHOLDS, NOW);
    expect(items).toHaveLength(1);
    expect(items[0].reasons.map((r) => r.rule)).toEqual(["urgent", "stalled"]);
  });

  it("does not flag non-urgent priority", () => {
    const reasons = reasonsFor(makeIssue({ priority: 2, updated_at: daysAgo(5) }));
    expect(reasons).toEqual([]);
  });

  it("does not flag fresh issues below threshold", () => {
    const reasons = reasonsFor(makeIssue({ priority: 0, updated_at: daysAgo(2) }));
    expect(reasons).toEqual([]);
  });

  it("applies threshold boundary equality (>= qualifies)", () => {
    const atBoundary = reasonsFor(makeIssue({ priority: 0, updated_at: daysAgo(3) }));
    expect(atBoundary.map((r) => r.rule)).toEqual(["urgent"]);
    expect(atBoundary[0].inactiveDays).toBeCloseTo(3, 6);

    const justUnder = reasonsFor(makeIssue({ priority: 0, updated_at: daysAgo(2.999) }));
    expect(justUnder).toEqual([]);
  });

  it("falls back to created_at only when updated_at is absent", () => {
    const issue = makeIssue({ priority: 0, updated_at: undefined, created_at: daysAgo(6) });
    const reasons = reasonsFor(issue);
    expect(reasons.map((r) => r.rule)).toEqual(["urgent"]);
    expect(reasons[0].inactiveDays).toBeCloseTo(6, 6);
  });

  it("prefers updated_at over created_at when both are present", () => {
    const issue = makeIssue({ priority: 0, updated_at: daysAgo(1), created_at: daysAgo(9) });
    expect(reasonsFor(issue)).toEqual([]);
  });

  it("does not claim staleness for missing or invalid timestamps", () => {
    const missing = reasonsFor(
      makeIssue({ priority: 0, updated_at: undefined, created_at: undefined }),
    );
    expect(missing).toEqual([]);

    const invalid = reasonsFor(makeIssue({ priority: 0, updated_at: "not-a-date" }));
    expect(invalid).toEqual([]);
  });

  it("excludes closed and deferred statuses", () => {
    for (const status of ["closed", "deferred"]) {
      expect(reasonsFor(makeIssue({ status, priority: 0, updated_at: daysAgo(20) }))).toEqual(
        [],
      );
    }
  });

  it("excludes issues with a valid future defer_until", () => {
    const issue = makeIssue({
      priority: 0,
      updated_at: daysAgo(20),
      defer_until: daysAgo(-5),
    });
    expect(reasonsFor(issue)).toEqual([]);
  });

  it("does not exclude on a past or invalid defer_until", () => {
    const past = reasonsFor(
      makeIssue({ priority: 0, updated_at: daysAgo(20), defer_until: daysAgo(1) }),
    );
    expect(past.map((r) => r.rule)).toEqual(["urgent"]);

    const invalid = reasonsFor(
      makeIssue({ priority: 0, updated_at: daysAgo(20), defer_until: null }),
    );
    expect(invalid.map((r) => r.rule)).toEqual(["urgent"]);
  });

  it("emits exactly one row per matching issue, combining its reasons", () => {
    const issues = [
      makeIssue({ id: "both", status: "in_progress", priority: 0, updated_at: daysAgo(20) }),
      makeIssue({ id: "one", priority: 1, updated_at: daysAgo(20) }),
      makeIssue({ id: "fresh", priority: 0, updated_at: daysAgo(1) }),
    ];
    const items = computeNeedsAttention(issues, THRESHOLDS, NOW);
    expect(items.map((i) => i.issue.id)).toEqual(["both", "one"]);
    expect(items[0].reasons).toHaveLength(2);
    expect(items[1].reasons).toHaveLength(1);
  });

  it("sorts deterministically by priority, then age, then id", () => {
    const issues = [
      makeIssue({ id: "p0-old", priority: 0, updated_at: daysAgo(9) }),
      makeIssue({ id: "p0-new", priority: 0, updated_at: daysAgo(4) }),
      makeIssue({ id: "p0-tie-a", priority: 0, updated_at: daysAgo(9) }),
      makeIssue({ id: "p0-tie-b", priority: 0, updated_at: daysAgo(9) }),
      makeIssue({ id: "p1", priority: 1, updated_at: daysAgo(9) }),
    ];
    const items = computeNeedsAttention(issues, THRESHOLDS, NOW);
    expect(items.map((i) => i.issue.id)).toEqual([
      "p0-old",
      "p0-tie-a",
      "p0-tie-b",
      "p0-new",
      "p1",
    ]);
  });
});

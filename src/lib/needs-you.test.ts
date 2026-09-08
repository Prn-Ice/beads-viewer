import { describe, expect, it } from "vitest";
import { HUMAN_LABEL, NEEDS_YOU_ARGS, normalizeCandidate, sortNeedsYouIssues, totalNeedsYou } from "./needs-you";

const NOW = Date.parse("2026-09-08T12:00:00Z");

function entry(overrides: Record<string, unknown> = {}) {
  return { id: "t-1", title: "Task", status: "open", priority: 2, labels: [HUMAN_LABEL], ...overrides };
}

describe("normalizeCandidate", () => {
  it("accepts an open, human-labelled candidate", () => {
    expect(normalizeCandidate(entry(), NOW)).toEqual({ id: "t-1", title: "Task", priority: 2, status: "open" });
  });

  it("rejects non-objects and entries without id or title", () => {
    expect(normalizeCandidate(null, NOW)).toBeNull();
    expect(normalizeCandidate("nope", NOW)).toBeNull();
    expect(normalizeCandidate(entry({ id: "" }), NOW)).toBeNull();
    expect(normalizeCandidate(entry({ id: 7 }), NOW)).toBeNull();
    expect(normalizeCandidate(entry({ title: "" }), NOW)).toBeNull();
  });

  it("rejects statuses other than open (closed, in_progress, deferred)", () => {
    for (const status of ["closed", "in_progress", "deferred", "blocked"]) {
      expect(normalizeCandidate(entry({ status }), NOW)).toBeNull();
    }
  });

  it("rejects missing or wrong labels", () => {
    expect(normalizeCandidate(entry({ labels: [] }), NOW)).toBeNull();
    expect(normalizeCandidate(entry({ labels: ["human-handoff"] }), NOW)).toBeNull();
    expect(normalizeCandidate(entry({ labels: undefined }), NOW)).toBeNull();
  });

  it("rejects future defer_until but keeps past and missing ones", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    const past = new Date(NOW - 86_400_000).toISOString();
    expect(normalizeCandidate(entry({ defer_until: future }), NOW)).toBeNull();
    expect(normalizeCandidate(entry({ defer_until: past }), NOW)).not.toBeNull();
    expect(normalizeCandidate(entry({ defer_until: null }), NOW)).not.toBeNull();
    expect(normalizeCandidate(entry(), NOW)).not.toBeNull();
  });

  it("drops non-numeric priority instead of inventing one", () => {
    expect(normalizeCandidate(entry({ priority: "high" }), NOW)?.priority).toBeUndefined();
    expect(normalizeCandidate(entry({ priority: NaN }), NOW)?.priority).toBeUndefined();
    expect(normalizeCandidate(entry({ priority: -1 }), NOW)?.priority).toBeUndefined();
  });
});

describe("sortNeedsYouIssues", () => {
  it("orders by priority ascending with unknown priority last, then id", () => {
    const sorted = sortNeedsYouIssues([
      { id: "b", title: "B", priority: 1, status: "open" },
      { id: "a", title: "A", priority: 2, status: "open" },
      { id: "c", title: "C", status: "open" },
      { id: "d", title: "D", priority: 1, status: "open" },
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("does not mutate the input", () => {
    const input = [{ id: "z", title: "Z", priority: 2, status: "open" }];
    sortNeedsYouIssues(input);
    expect(input[0].id).toBe("z");
  });
});

describe("totalNeedsYou", () => {
  it("sums counts across projects, ignoring errors", () => {
    expect(
      totalNeedsYou([
        { path: "/a", name: "a", issues: [{ id: "1", title: "x", status: "open" }] },
        { path: "/b", name: "b", issues: [], error: "boom" },
        { path: "/c", name: "c", issues: [{ id: "2", title: "y", status: "open" }, { id: "3", title: "z", status: "open" }] },
      ]),
    ).toBe(3);
  });
});

describe("NEEDS_YOU_ARGS", () => {
  it("keeps the authoritative CLI filter arguments", () => {
    expect(NEEDS_YOU_ARGS).toEqual(["list", "--label", "human", "--ready", "--status", "open", "--limit", "0"]);
  });
});

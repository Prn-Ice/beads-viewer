import { describe, expect, it } from "vitest";
import { observeSession, resetSession, sessionChanges } from "./session-changes";
import type { BeadsIssue } from "./types";

const start = Date.parse("2026-09-08T12:00:00Z");
function issue(id: string, extra: Partial<BeadsIssue> = {}): BeadsIssue {
  return { id, title: id, status: "open", priority: 2, created_at: "2026-01-01T00:00:00Z", dependency_count: 0, dependent_count: 0, comment_count: 0, ...extra };
}

describe("observed session changes", () => {
  it("initializes silently and compares net changes without mutating previous snapshots", () => {
    const a = issue("a");
    const baseline = observeSession(undefined, [a], start);
    expect(sessionChanges(baseline)).toEqual([]);
    const changed = observeSession(baseline, [{ ...a, title: "Updated", priority: 0 }], start + 3000);
    expect(sessionChanges(changed)[0].reasons).toEqual(["Title changed", "Priority changed"]);
    expect(sessionChanges(baseline)).toEqual([]);
    expect(sessionChanges(observeSession(changed, [a], start + 6000))).toEqual([]);
  });
  it("does not infer closures from omissions or creations from first All-scope observations", () => {
    const baseline = observeSession(undefined, [issue("a")], start);
    expect(sessionChanges(observeSession(baseline, [], start + 3000))).toEqual([]);
    const all = observeSession(baseline, [issue("a"), issue("old-closed", { status: "closed" }), issue("undated", { created_at: undefined })], start + 6000);
    expect(sessionChanges(all)).toEqual([]);
    expect(all.baseline.has("old-closed")).toBe(true);
  });
  it("reports creations only with a valid timestamp within the session", () => {
    const baseline = observeSession(undefined, [], start);
    const current = observeSession(baseline, [
      issue("new", { created_at: new Date(start + 1000).toISOString() }),
      issue("invalid", { created_at: "bad" }),
      issue("future", { created_at: new Date(start + 9000).toISOString() }),
    ], start + 3000);
    expect(sessionChanges(current).map((c) => c.issue.id)).toEqual(["new"]);
    const closed = observeSession(current, [issue("new", { status: "closed" })], start + 6000);
    expect(sessionChanges(closed)[0].reasons).toEqual(["Created during this session", "Closed"]);
  });
  it("reports observed closed and reopened statuses and preserves last observations", () => {
    const baseline = observeSession(undefined, [issue("a"), issue("b", { status: "closed" })], start);
    const changed = observeSession(baseline, [issue("a", { status: "closed" }), issue("b")], start + 3000);
    expect(sessionChanges(changed).map((c) => c.reasons)).toEqual([["Closed"], ["Reopened"]]);
    expect(sessionChanges(observeSession(changed, [], start + 6000))).toEqual(sessionChanges(changed));
    expect(sessionChanges(resetSession(changed, start + 6000))).toEqual([]);
  });
  it("ignores timestamp, counter and label ordering churn", () => {
    const a = issue("a", { labels: ["one", "two"], assignee: undefined });
    const baseline = observeSession(undefined, [a], start);
    const next = observeSession(baseline, [{ ...a, labels: ["two", "one", "one"], assignee: "", updated_at: "new", comment_count: 50 }], start + 3000);
    expect(sessionChanges(next)).toEqual([]);
  });
  it("reset uses all known observations, including issues absent in Open scope", () => {
    const baseline = observeSession(undefined, [issue("a", { status: "closed" })], start);
    const reset = resetSession(observeSession(baseline, [], start + 1000), start + 2000);
    expect(sessionChanges(observeSession(reset, [issue("a")], start + 3000))[0].reasons).toEqual(["Reopened"]);
  });
});

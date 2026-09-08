import { describe, expect, it } from "vitest";
import { nextSort, sortIssuesByKey, type SortDir, type SortKey } from "./list-sort";
import type { BeadsIssue } from "./types";

function issue(id: string, overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id,
    title: `Title ${id}`,
    status: "open",
    priority: 2,
    issue_type: "task",
    assignee: "alice",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function ids(issues: BeadsIssue[]): string[] {
  return issues.map((i) => i.id);
}

const sample = [
  issue("c", { title: "Charlie", priority: 0, status: "blocked", issue_type: "bug", assignee: "zed", created_at: "2026-03-01T00:00:00Z" }),
  issue("b", { title: "Bravo", priority: 1, status: "in_progress", issue_type: "feature", assignee: "ada", created_at: "2026-01-15T00:00:00Z" }),
  issue("a", { title: "Alpha", priority: 1, status: "in_progress", issue_type: "feature", assignee: "ada", created_at: "2026-01-01T00:00:00Z" }),
];

describe("sortIssuesByKey", () => {
  it("treats invalid dates and blank assignees as missing", () => {
    const mixed = [
      issue("invalid", { created_at: "invalid", assignee: "" }),
      issue("valid"),
    ];
    for (const dir of ["asc", "desc"] as const) {
      expect(ids(sortIssuesByKey(mixed, "age", dir))).toEqual(["valid", "invalid"]);
      expect(ids(sortIssuesByKey(mixed, "assignee", dir))).toEqual(["valid", "invalid"]);
    }
  });
  it("does not mutate the input array", () => {
    const before = [...sample];
    sortIssuesByKey(sample, "id", "asc");
    expect(sample).toEqual(before);
  });

  it("sorts text columns ascending and descending with ID tiebreak", () => {
    expect(ids(sortIssuesByKey(sample, "id", "asc"))).toEqual(["a", "b", "c"]);
    expect(ids(sortIssuesByKey(sample, "id", "desc"))).toEqual(["c", "b", "a"]);
    expect(ids(sortIssuesByKey(sample, "title", "asc"))).toEqual(["a", "b", "c"]);
    expect(ids(sortIssuesByKey(sample, "title", "desc"))).toEqual(["c", "b", "a"]);
    // Same title value: deterministic by issue ID.
    const tie = [
      issue("y", { title: "Same" }),
      issue("x", { title: "Same" }),
      issue("z", { title: "Same" }),
    ];
    expect(ids(sortIssuesByKey(tie, "title", "asc"))).toEqual(["x", "y", "z"]);
  });

  it("sorts priority ascending then by ID, respecting ties", () => {
    expect(ids(sortIssuesByKey(sample, "priority", "asc"))).toEqual(["c", "a", "b"]);
    expect(ids(sortIssuesByKey(sample, "priority", "desc"))).toEqual(["b", "a", "c"]);
  });

  it("sorts age (created_at) ascending as oldest-first and by ID on ties", () => {
    expect(ids(sortIssuesByKey(sample, "age", "asc"))).toEqual(["a", "b", "c"]);
    expect(ids(sortIssuesByKey(sample, "age", "desc"))).toEqual(["c", "b", "a"]);
    const sameAge = [
      issue("p", { created_at: "2026-05-01T00:00:00Z" }),
      issue("q", { created_at: "2026-05-01T00:00:00Z" }),
      issue("r", { created_at: "2026-05-01T00:00:00Z" }),
    ];
    expect(ids(sortIssuesByKey(sameAge, "age", "asc"))).toEqual(["p", "q", "r"]);
  });

  it("sorts status, type, and assignee text columns", () => {
    expect(ids(sortIssuesByKey(sample, "status", "asc"))).toEqual(["c", "a", "b"]);
    expect(ids(sortIssuesByKey(sample, "type", "asc"))).toEqual(["c", "a", "b"]);
    expect(ids(sortIssuesByKey(sample, "assignee", "asc"))).toEqual(["a", "b", "c"]);
  });

  it("places missing values last in both directions", () => {
    const mixed = [
      issue("with-priority", { priority: 0 }),
      issue("no-priority", { priority: undefined }),
      issue("mid-priority", { priority: 5 }),
    ];
    expect(ids(sortIssuesByKey(mixed, "priority", "asc"))).toEqual([
      "with-priority",
      "mid-priority",
      "no-priority",
    ]);
    expect(ids(sortIssuesByKey(mixed, "priority", "desc"))).toEqual([
      "mid-priority",
      "with-priority",
      "no-priority",
    ]);

    const noType = [
      issue("has-type", { issue_type: "bug" }),
      issue("no-type", { issue_type: undefined }),
    ];
    expect(ids(sortIssuesByKey(noType, "type", "asc"))).toEqual(["has-type", "no-type"]);
    expect(ids(sortIssuesByKey(noType, "type", "desc"))).toEqual(["has-type", "no-type"]);

    const noAssignee = [
      issue("has-assignee", { assignee: "bob" }),
      issue("no-assignee", { assignee: undefined }),
    ];
    expect(ids(sortIssuesByKey(noAssignee, "assignee", "asc"))).toEqual([
      "has-assignee",
      "no-assignee",
    ]);
    expect(ids(sortIssuesByKey(noAssignee, "assignee", "desc"))).toEqual([
      "has-assignee",
      "no-assignee",
    ]);

    const noAge = [
      issue("has-age", { created_at: "2026-01-01T00:00:00Z" }),
      issue("no-age", { created_at: undefined }),
    ];
    expect(ids(sortIssuesByKey(noAge, "age", "asc"))).toEqual(["has-age", "no-age"]);
    expect(ids(sortIssuesByKey(noAge, "age", "desc"))).toEqual(["has-age", "no-age"]);
  });

  it("breaks ties with issue ID even when the primary value is missing", () => {
    const bothMissing = [
      issue("b2", { priority: undefined }),
      issue("a1", { priority: undefined }),
    ];
    expect(ids(sortIssuesByKey(bothMissing, "priority", "asc"))).toEqual(["a1", "b2"]);
  });
});

describe("nextSort", () => {
  const cases: [SortKey, SortKey, SortDir, SortDir][] = [
    ["id", "id", "asc", "desc"],
    ["id", "id", "desc", "asc"],
    ["id", "title", "asc", "asc"],
    ["id", "title", "desc", "asc"],
  ];
  it.each(cases)("clicking %s with current %s %s yields %s", (key, current, dir, expected) => {
    expect(nextSort(key, current, dir)).toBe(expected);
  });
});

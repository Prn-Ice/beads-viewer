import { describe, expect, it } from "vitest";
import { bucketIssues } from "./buckets";
import type { BeadsIssue } from "./types";

function issue(id: string, overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id,
    title: id,
    status: "open",
    priority: 2,
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("bucketIssues", () => {
  it("puts issues into status columns", () => {
    const columns = bucketIssues(
      [
        issue("a", { status: "in_progress" }),
        issue("b", { status: "blocked" }),
        issue("c", { status: "closed" }),
        issue("d", { status: "open" }),
      ],
      [],
    );
    expect(columns.in_progress.map((i) => i.id)).toEqual(["a"]);
    expect(columns.blocked.map((i) => i.id)).toEqual(["b"]);
    expect(columns.closed.map((i) => i.id)).toEqual(["c"]);
    expect(columns.backlog.map((i) => i.id)).toEqual(["d"]);
  });

  it("separates ready issues from the backlog", () => {
    const columns = bucketIssues(
      [issue("a"), issue("b"), issue("c")],
      ["b"],
    );
    expect(columns.ready.map((i) => i.id)).toEqual(["b"]);
    expect(columns.backlog.map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("sorts by priority, then most recently updated", () => {
    const columns = bucketIssues(
      [
        issue("low", { priority: 4, updated_at: "2026-09-05T00:00:00Z" }),
        issue("high", { priority: 0 }),
        issue("none", { priority: undefined }),
        issue("mid-old", { priority: 2, updated_at: "2026-09-01T00:00:00Z" }),
        issue("mid-new", { priority: 2, updated_at: "2026-09-06T00:00:00Z" }),
      ],
      [],
    );
    expect(columns.backlog.map((i) => i.id)).toEqual([
      "high",
      "mid-new",
      "mid-old",
      "low",
      "none",
    ]);
  });
});

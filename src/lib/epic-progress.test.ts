import { describe, expect, it } from "vitest";
import { epicProgress, visibleChildren, type EpicChild } from "./epic-progress";

function child(id: string, status: string): EpicChild {
  return { id, title: id, status };
}

describe("epicProgress", () => {
  it("counts the full child set regardless of status mix", () => {
    const children = [
      child("a", "open"),
      child("b", "in_progress"),
      child("c", "blocked"),
      child("d", "deferred"),
      child("e", "closed"),
      child("f", "closed"),
    ];
    expect(epicProgress(children)).toEqual({ total: 6, closed: 2 });
  });

  it("only treats status closed as closed", () => {
    expect(epicProgress([child("a", "closed"), child("b", "blocked")])).toEqual({
      total: 2,
      closed: 1,
    });
  });

  it("handles an empty epic", () => {
    expect(epicProgress([])).toEqual({ total: 0, closed: 0 });
  });
});

describe("visibleChildren", () => {
  const children = [
    child("a", "open"),
    child("b", "blocked"),
    child("c", "closed"),
  ];

  it("hides closed children by default", () => {
    expect(visibleChildren(children, false).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("shows every child when showClosed is on", () => {
    expect(visibleChildren(children, true).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("returns the full array for an empty epic", () => {
    expect(visibleChildren([], false)).toEqual([]);
  });
});
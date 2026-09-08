import { describe, expect, it } from "vitest";
import { CHAIN_LIMIT, chainRows, issueLinks } from "./blocker-chains";
import type { BeadsIssue, DependencyRef } from "./types";

function issue(id: string, dependencies: DependencyRef[] = []): BeadsIssue {
  return { id, title: id, status: "open", dependencies, dependency_count: dependencies.length, dependent_count: 0, comment_count: 0 };
}
const link = (id: string): DependencyRef => ({ id, dependency_type: "blocks" });

describe("blocker chain data", () => {
  it("uses raw endpoints rather than the edge id in both directions", () => {
    const a = issue("a", [{ id: "edge-uuid", issue_id: "a", depends_on_id: "b", type: "blocks" }]);
    a.dependents = [{ id: "other-edge", issue_id: "c", depends_on_id: "a", type: "blocks" }];
    expect(issueLinks(a, "dependencies")[0].id).toBe("b");
    expect(issueLinks(a, "dependents")[0].id).toBe("c");
  });
  it("reads hydrated dependency_type, preserves types and deduplicates identical edges", () => {
    const a = issue("a", [link("b"), link("b"), { id: "parent", dependency_type: "parent-child", type: "blocks" }, { id: "unknown" }]);
    expect(issueLinks(a, "dependencies").map((l) => [l.id, l.type])).toEqual([["b", "blocks"], ["parent", "parent-child"], ["unknown", "unknown"]]);
    expect(chainRows(a, "dependencies", {}, new Set()).rows.map((r) => r.id)).toEqual(["b"]);
  });
  it("shows cycles and repeated references without recursing forever", () => {
    const a = issue("a", [link("b"), link("c")]);
    const b = issue("b", [link("c")]);
    const c = issue("c", [link("a")]);
    const { rows } = chainRows(a, "dependencies", { b, c }, new Set(["dependencies/0", "dependencies/0/0"]));
    expect(rows.map((r) => r.id)).toEqual(["b", "c", "a", "c"]);
    expect(rows[2].cycle).toBe(true);
    expect(rows[3].repeated).toBe(true);
  });
  it("bounds depth, labels unknown targets, and caps a wide graph", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [link("c")]);
    const c = issue("c", [link("d")]);
    const d = issue("d", [link("e")]);
    const expanded = new Set(["dependencies/0", "dependencies/0/0", "dependencies/0/0/0"]);
    expect(chainRows(a, "dependencies", { b, c, d }, expanded).rows.map((r) => r.id)).toEqual(["b", "c", "d"]);
    const wide = issue("wide", Array.from({ length: 50 }, (_, i) => link(String(i))));
    expect(chainRows(wide, "dependencies", {}, new Set()).rows).toHaveLength(CHAIN_LIMIT);
    expect(chainRows(wide, "dependencies", {}, new Set()).truncated).toBe(true);
    expect(chainRows(issue("x", [{ type: "blocks" }]), "dependencies", {}, new Set()).incomplete).toBe(true);
  });
  it("keeps closed links visible, marks omitted records and separates expansion directions", () => {
    const a = issue("a", [{ ...link("b"), status: "closed" }]);
    a.dependent_count = 2;
    a.dependents = [link("b")];
    const b = issue("b");
    b.dependents = [link("c")];
    const rows = chainRows(a, "dependents", { b }, new Set(["dependencies/0"]));
    expect(rows.rows).toHaveLength(1);
    expect(rows.incomplete).toBe(true);
    expect(chainRows(a, "dependencies", {}, new Set()).rows[0].status).toBe("closed");
  });
});

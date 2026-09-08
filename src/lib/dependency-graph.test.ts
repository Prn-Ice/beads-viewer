import { describe, expect, it } from "vitest";
import {
  GRAPH_MAX_DEPTH,
  GRAPH_MAX_NODES,
  GRAPH_MAX_EDGES,
  buildGraph,
  edgeKind,
  epicGraph,
  graphViewBox,
  layoutGraph,
} from "./dependency-graph";
import type { BeadsIssue, DependencyRef } from "./types";

function issue(
  id: string,
  dependencies: DependencyRef[] = [],
  dependents: DependencyRef[] = [],
  extra: Partial<BeadsIssue> = {},
): BeadsIssue {
  return {
    id,
    title: `Issue ${id}`,
    status: "open",
    priority: 2,
    dependencies,
    dependents,
    dependency_count: dependencies.length,
    dependent_count: dependents.length,
    comment_count: 0,
    ...extra,
  };
}
const link = (id: string, type = "blocks"): DependencyRef => ({ id, dependency_type: type });
const nodeIds = (result: ReturnType<typeof buildGraph>) => result.nodes.map((n) => n.id);

describe("edgeKind", () => {
  it("categorizes known types and falls back to other", () => {
    expect(edgeKind("blocks")).toBe("blocks");
    expect(edgeKind("parent-child")).toBe("parent-child");
    expect(edgeKind("related")).toBe("related");
    expect(edgeKind("conditional")).toBe("other");
    expect(edgeKind("unknown")).toBe("other");
  });
});

describe("buildGraph neighborhood", () => {
  it("deduplicates both views of the same edge without inventing a cycle", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [], [link("a")]);
    const graph = buildGraph(a, { b }, new Set(["b"]));
    expect(graph.edges).toHaveLength(1);
    expect(graph.cycle).toBe(false);
  });
  it("uses shortest hop depths and keeps hydrated priority metadata", () => {
    const a = issue("a", [link("b"), { ...link("c"), priority: 0 }]);
    const b = issue("b", [link("c")]);
    const graph = buildGraph(a, { b }, new Set(["b"]));
    expect(graph.nodes.find((node) => node.id === "c")).toMatchObject({ depth: 1, priority: 0 });
  });
  it("shows the immediate neighborhood of the root without expansion", () => {
    const a = issue("a", [link("b"), link("c")], [link("d")]);
    const result = buildGraph(a, {}, new Set());
    expect(nodeIds(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.nodes.find((n) => n.id === "a")?.isRoot).toBe(true);
    expect(result.edges.map((e) => [e.from, e.to, e.kind])).toEqual([
      ["a", "b", "blocks"],
      ["a", "c", "blocks"],
      ["d", "a", "blocks"],
    ]);
    expect(result.truncated).toBe(false);
    // Neighbors are intentionally not loaded until expanded; that is not
    // "incomplete" data.
    expect(result.incomplete).toBe(false);
  });

  it("expands an expanded node one more hop and binds depth", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [link("c")]);
    const c = issue("c", [link("d")]);
    const d = issue("d", [link("e")]);
    const expanded = new Set(["b", "c"]);
    const result = buildGraph(a, { b, c }, expanded);
    expect(nodeIds(result)).toEqual(["a", "b", "c", "d"]);
    expect(result.nodes.find((n) => n.id === "d")?.depth).toBe(GRAPH_MAX_DEPTH);
    // d sits at the depth boundary: no deeper expansion even if marked.
    const deep = buildGraph(a, { b, c, d }, new Set(["b", "c", "d"]));
    expect(nodeIds(deep)).toEqual(["a", "b", "c", "d"]);
    expect(deep.nodes.find((n) => n.id === "d")?.depth).toBe(GRAPH_MAX_DEPTH);
  });

  it("keeps unexpanded nodes as terminal dots", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [link("c")]);
    const result = buildGraph(a, { b }, new Set());
    expect(nodeIds(result)).toEqual(["a", "b"]);
    expect(result.edges).toHaveLength(1);
  });

  it("detects cycles and stops expansion, and labels repeated references", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [link("c")]);
    const c = issue("c", [link("a")]);
    const result = buildGraph(a, { b, c }, new Set(["b", "c"]));
    const back = result.edges.find((e) => e.to === "a" && e.from === "c");
    expect(back?.cycle).toBe(true);
    expect(result.cycle).toBe(true);
    // The back edge is not expanded further: a only appears once.
    expect(nodeIds(result).filter((id) => id === "a")).toHaveLength(1);
  });

  it("categorizes typed edges distinctly", () => {
    const a = issue(
      "a",
      [link("blocked-by", "blocks"), link("parent", "parent-child"), link("rel", "related"), link("cond", "conditional")],
    );
    const result = buildGraph(a, {}, new Set());
    expect(result.edges.map((e) => [e.to, e.kind])).toEqual([
      ["blocked-by", "blocks"],
      ["parent", "parent-child"],
      ["rel", "related"],
      ["cond", "other"],
    ]);
  });

  it("represents unresolved references as missing terminal nodes", () => {
    const a = issue("a", [{ type: "blocks" }]);
    const result = buildGraph(a, {}, new Set());
    expect(result.nodes.filter((n) => n.missing)).toHaveLength(1);
    expect(result.incomplete).toBe(true);
    // Missing nodes are never expanded/fetched.
    expect(result.nodes.find((n) => n.missing)?.depth).toBe(1);
  });

  it("flags incomplete records when counts exceed listed links", () => {
    const a = issue("a", [link("b")]);
    a.dependency_count = 3;
    const result = buildGraph(a, {}, new Set());
    expect(result.incomplete).toBe(true);
  });

  it("marks closed issues as terminal and never expands them", () => {
    const a = issue("a", [link("old")]);
    const old = issue("old", [link("deeper")], [], { status: "closed" });
    const result = buildGraph(a, { old }, new Set(["old"]));
    expect(result.nodes.find((n) => n.id === "old")?.closed).toBe(true);
    expect(nodeIds(result)).not.toContain("deeper");
  });

  it("uses loaded record data for nodes when available", () => {
    const a = issue("a", [link("b")]);
    const b = issue("b", [link("x")], [], { priority: 0, status: "blocked", issue_type: "bug" });
    const result = buildGraph(a, { b }, new Set());
    const nb = result.nodes.find((n) => n.id === "b")!;
    expect(nb.priority).toBe(0);
    expect(nb.status).toBe("blocked");
    expect(nb.issue_type).toBe("bug");
  });

  it("bounds the node count and reports truncation", () => {
    const wide = issue("wide", Array.from({ length: 60 }, (_, i) => link(`n${i}`)));
    const result = buildGraph(wide, {}, new Set());
    expect(result.nodes).toHaveLength(GRAPH_MAX_NODES);
    expect(result.truncated).toBe(true);
    const ids = new Set(nodeIds(result));
    expect(result.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });
  it("caps dense edges without duplicating nodes or leaving dangling endpoints", () => {
    const ids = Array.from({ length: 12 }, (_, index) => `n${index}`);
    const loaded = Object.fromEntries(ids.map((id) => [id, issue(id, ids.filter((other) => other !== id).map((other) => link(other)))]));
    const graph = buildGraph(loaded.n0, loaded, new Set(ids));
    expect(graph.edges).toHaveLength(GRAPH_MAX_EDGES);
    expect(graph.edgeTruncated).toBe(true);
    const shown = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => shown.has(edge.from) && shown.has(edge.to))).toBe(true);
  });
});

describe("layoutGraph", () => {
  it("places the root at the origin column and lays each depth in a column", () => {
    const result = buildGraph(issue("a", [link("b"), link("c")]), {}, new Set());
    const positioned = layoutGraph(result.nodes);
    const root = positioned.find((n) => n.id === "a")!;
    expect(root.x).toBe(0);
    expect(root.y).toBe(0);
    const b = positioned.find((n) => n.id === "b")!;
    const c = positioned.find((n) => n.id === "c")!;
    expect(b.x).toBe(c.x);
    expect(b.x).toBeGreaterThan(root.x);
    expect(b.y).not.toBe(c.y);
  });

  it("returns a finite viewBox that contains every node", () => {
    const result = buildGraph(issue("a", [link("b"), link("c")], [link("d")]), {}, new Set());
    const positioned = layoutGraph(result.nodes);
    const view = graphViewBox(positioned);
    for (const node of positioned) {
      expect(node.x).toBeGreaterThanOrEqual(view.x);
      expect(node.y).toBeGreaterThanOrEqual(view.y);
      expect(node.x + 190).toBeLessThanOrEqual(view.x + view.width);
      expect(node.y + 56).toBeLessThanOrEqual(view.y + view.height);
    }
  });
});

describe("epicGraph", () => {
  it("builds epic + all direct children with parent-child edges, denominator unfiltered", () => {
    const epic = issue("epic", [], [], { issue_type: "epic" });
    const children = [
      { id: "c1", title: "One", status: "open", issue_type: "task" },
      { id: "c2", title: "Two", status: "closed", issue_type: "task" },
    ];
    const result = epicGraph(epic, children);
    expect(result.nodes.map((n) => n.id)).toEqual(["epic", "c1", "c2"]);
    expect(result.nodes.find((n) => n.id === "c2")?.closed).toBe(true);
    expect(result.edges).toHaveLength(2);
    expect(result.edges.every((e) => e.kind === "parent-child" && e.to === "epic")).toBe(true);
  });

  it("caps the epic child set and reports truncation", () => {
    const epic = issue("epic", [], [], { issue_type: "epic" });
    const children = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, title: `C${i}`, status: "open" }));
    const result = epicGraph(epic, children);
    expect(result.nodes).toHaveLength(GRAPH_MAX_NODES);
    expect(result.truncated).toBe(true);
  });
  it("enriches epic scope with internal connections but omits outside neighbors", () => {
    const epic = issue("epic", [], [], { issue_type: "epic" });
    const children = [{ id: "a", title: "A", status: "open", priority: 0 }, { id: "b", title: "B", status: "closed", priority: 1 }];
    const a = issue("a", [link("b"), link("outside")], [], { priority: 0 });
    const graph = epicGraph(epic, children, { a }, new Set(["a"]));
    expect(graph.edges.some((edge) => edge.from === "a" && edge.to === "b" && edge.type === "blocks")).toBe(true);
    expect(graph.nodes.some((node) => node.id === "outside")).toBe(false);
    expect(graph.nodes.find((node) => node.id === "b")?.priority).toBe(1);
  });
});

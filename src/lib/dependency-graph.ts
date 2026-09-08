import type { BeadsIssue } from "./types";
import type { EpicChild } from "./epic-progress";
import { issueLinks } from "./blocker-chains";

export const GRAPH_MAX_DEPTH = 3;
export const GRAPH_MAX_NODES = 30;
export const GRAPH_MAX_EDGES = 60;
export type EdgeKind = "blocks" | "parent-child" | "related" | "other";

export interface GraphNode {
  id: string;
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
  depth: number;
  isRoot: boolean;
  missing: boolean;
  closed: boolean;
}
export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  type: string;
  cycle: boolean;
}
export interface GraphBuildResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  edgeTruncated: boolean;
  incomplete: boolean;
  cycle: boolean;
}

export function edgeKind(type: string): EdgeKind {
  if (type === "blocks" || type === "parent-child") return type;
  if (type === "related" || type === "relates-to") return "related";
  return "other";
}

// The graph is tiny and bounded. Mark actual directed cycles, not the reverse
// traversal of the same edge returned in a neighbor's dependents list.
function markCycles(edges: GraphEdge[]) {
  for (const edge of edges) {
    const pending = [edge.to];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (id === edge.from) { edge.cycle = true; break; }
      if (visited.has(id)) continue;
      visited.add(id);
      for (const candidate of edges) if (candidate.from === id) pending.push(candidate.to);
    }
  }
  return edges.some((edge) => edge.cycle);
}

export function buildGraph(root: BeadsIssue, loaded: Record<string, BeadsIssue>, expanded: ReadonlySet<string>): GraphBuildResult {
  root = loaded[root.id] ?? root;
  const nodes = new Map<string, GraphNode>([[root.id, { ...root, depth: 0, isRoot: true, missing: false, closed: root.status === "closed" }]]);
  const edges: GraphEdge[] = [];
  const edgeKeys = new Set<string>();
  const visited = new Set<string>();
  const queue = [{ issue: root, depth: 0 }];
  let truncated = false;
  let edgeTruncated = false;
  let incomplete = false;

  // Breadth-first traversal gives each node its shortest displayed hop depth.
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const { issue, depth } = queue[cursor];
    if (visited.has(issue.id) || depth >= GRAPH_MAX_DEPTH) continue;
    visited.add(issue.id);
    for (const direction of ["dependencies", "dependents"] as const) {
      const count = direction === "dependencies" ? issue.dependency_count : issue.dependent_count;
      if (count > (issue[direction]?.length ?? 0)) incomplete = true;
      for (const [index, link] of issueLinks(issue, direction).entries()) {
        const id = link.id ?? `__missing__:${issue.id}:${direction}:${index}`;
        const from = direction === "dependencies" ? issue.id : id;
        const to = direction === "dependencies" ? id : issue.id;
        const edgeKey = JSON.stringify([from, to, link.type]);
        if (edgeKeys.has(edgeKey)) continue;
        if (edges.length >= GRAPH_MAX_EDGES) { edgeTruncated = true; continue; }
        if (!nodes.has(id) && nodes.size >= GRAPH_MAX_NODES) { truncated = true; continue; }
        const data = link.id ? loaded[id] : undefined;
        if (!nodes.has(id)) {
          nodes.set(id, {
            id, title: data?.title ?? link.title, status: data?.status ?? link.status,
            priority: data?.priority ?? link.priority, issue_type: data?.issue_type ?? link.issue_type,
            depth: depth + 1, isRoot: false, missing: link.id === null,
            closed: (data?.status ?? link.status) === "closed",
          });
        }
        if (!link.id) incomplete = true;
        edgeKeys.add(edgeKey);
        edges.push({ id: edgeKey, from, to, kind: edgeKind(link.type), type: link.type, cycle: false });
        if (data && data.status !== "closed" && expanded.has(id)) queue.push({ issue: data, depth: depth + 1 });
      }
    }
  }
  return { nodes: [...nodes.values()], edges, truncated, edgeTruncated, incomplete, cycle: markCycles(edges) };
}

export interface PositionedNode extends GraphNode { x: number; y: number }
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 64;
export const COLUMN_GAP = 280;
export const ROW_GAP = 88;

export function layoutGraph(nodes: GraphNode[]): PositionedNode[] {
  const rows = new Map<number, number>();
  return nodes.map((node) => {
    const row = rows.get(node.depth) ?? 0;
    rows.set(node.depth, row + 1);
    return { ...node, x: node.depth * COLUMN_GAP, y: row * ROW_GAP };
  });
}

export function graphViewBox(nodes: PositionedNode[]) {
  return {
    x: -24, y: -32,
    width: Math.max(0, ...nodes.map((node) => node.x + NODE_WIDTH)) + 64,
    height: Math.max(0, ...nodes.map((node) => node.y + NODE_HEIGHT)) + 56,
  };
}

// Epic scope always includes direct-child hierarchy. Expanding a child loads
// its connections within this scope; outside neighbors are deliberately omitted.
export function epicGraph(epic: BeadsIssue, children: EpicChild[], loaded: Record<string, BeadsIssue> = {}, expanded: ReadonlySet<string> = new Set()): GraphBuildResult {
  const unique = [...new Map(children.filter((child) => child.id !== epic.id).map((child) => [child.id, child])).values()];
  const shown = unique.slice(0, GRAPH_MAX_NODES - 1);
  const nodes: GraphNode[] = [
    { ...epic, depth: 0, isRoot: true, missing: false, closed: epic.status === "closed" },
    ...shown.map((child) => ({ ...child, ...loaded[child.id], depth: 1, isRoot: false, missing: false, closed: (loaded[child.id]?.status ?? child.status) === "closed" })),
  ];
  const ids = new Set(nodes.map((node) => node.id));
  const edges: GraphEdge[] = shown.map((child) => ({ id: JSON.stringify([child.id, epic.id, "parent-child"]), from: child.id, to: epic.id, kind: "parent-child", type: "parent-child", cycle: false }));
  const keys = new Set(edges.map((edge) => edge.id));
  let incomplete = false;
  let edgeTruncated = false;
  for (const node of nodes) {
    const record = node.id === epic.id ? epic : loaded[node.id];
    if (!record || (node.id !== epic.id && !expanded.has(node.id))) continue;
    for (const direction of ["dependencies", "dependents"] as const) {
      const count = direction === "dependencies" ? record.dependency_count : record.dependent_count;
      if (count > (record[direction]?.length ?? 0)) incomplete = true;
      for (const link of issueLinks(record, direction)) {
        if (!link.id || !ids.has(link.id)) continue;
        const from = direction === "dependencies" ? node.id : link.id;
        const to = direction === "dependencies" ? link.id : node.id;
        const key = JSON.stringify([from, to, link.type]);
        if (keys.has(key)) continue;
        if (edges.length >= GRAPH_MAX_EDGES) { edgeTruncated = true; continue; }
        keys.add(key);
        edges.push({ id: key, from, to, kind: edgeKind(link.type), type: link.type, cycle: false });
      }
    }
  }
  return { nodes, edges, truncated: unique.length > shown.length, edgeTruncated, incomplete, cycle: markCycles(edges) };
}

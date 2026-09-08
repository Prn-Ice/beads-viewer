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

export interface PositionedNode extends GraphNode { x: number; y: number; side: "left" | "center" | "right" }
export const NODE_WIDTH = 190;
export const NODE_HEIGHT = 64;
export const COLUMN_GAP = 280;
export const ROW_GAP = 88;

// Breadth-first reachable distances from `start` following `adj` (Map of
// node -> next nodes). Returns Map<node, distance>.
function bfsDist(start: string, adj: Map<string, string[]>): Map<string, number> {
  const dist = new Map<string, number>([[start, 0]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const node = queue[i];
    const d = dist.get(node)!;
    for (const next of adj.get(node) ?? []) {
      if (!dist.has(next)) { dist.set(next, d + 1); queue.push(next); }
    }
  }
  return dist;
}

/**
 * Deterministic, dependency-free layout.
 *
 * The root sits at the origin (center). Upstream prerequisites (what the root
 * "depends on", reachable by following edge direction from the root) are placed
 * in negative columns to the LEFT; downstream dependents (what "depends on" the
 * root, reachable by following edges in reverse) go to positive columns on the
 * RIGHT. Within each column nodes are stacked vertically, ordered by the mean
 * vertical position of their neighbours in the neighbouring inner column, which
 * keeps edges mostly left-to-right and cuts crossings for this bounded graph.
 */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[]): PositionedNode[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = nodes.find((node) => node.isRoot);
  if (!root) return nodes.map((node) => ({ ...node, x: 0, y: 0, side: "center" as const }));

  const fwd = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  for (const edge of edges) {
    if (!byId.has(edge.from) || !byId.has(edge.to)) continue;
    const forward = fwd.get(edge.from) ?? [];
    forward.push(edge.to);
    fwd.set(edge.from, forward);
    const reverse = rev.get(edge.to) ?? [];
    reverse.push(edge.from);
    rev.set(edge.to, reverse);
  }

  const upDist = bfsDist(root.id, fwd); // root -> node  (dependencies)
  const downDist = bfsDist(root.id, rev); // node -> root (dependents)

  const xOf = new Map<string, number>();
  const sideOf = new Map<string, PositionedNode["side"]>();
  xOf.set(root.id, 0);
  sideOf.set(root.id, "center");
  for (const node of nodes) {
    if (node.id === root.id) continue;
    if (upDist.has(node.id) && !downDist.has(node.id)) {
      xOf.set(node.id, -Math.min(GRAPH_MAX_DEPTH, upDist.get(node.id)!));
      sideOf.set(node.id, "left");
    } else if (downDist.has(node.id)) {
      xOf.set(node.id, Math.min(GRAPH_MAX_DEPTH, downDist.get(node.id)!));
      sideOf.set(node.id, "right");
    } else {
      xOf.set(node.id, 0);
      sideOf.set(node.id, "center");
    }
  }

  const columns = new Map<number, string[]>();
  for (const node of nodes) {
    const c = xOf.get(node.id)!;
    const column = columns.get(c) ?? [];
    column.push(node.id);
    columns.set(c, column);
  }

  const yOf = new Map<string, number>([[root.id, 0]]);

  function neighborMeanY(id: string, innerCol: number): number {
    const seen = new Set<string>();
    let sum = 0;
    let count = 0;
    for (const nb of [...(fwd.get(id) ?? []), ...(rev.get(id) ?? [])]) {
      if (seen.has(nb)) continue;
      seen.add(nb);
      if (xOf.get(nb) === innerCol && yOf.has(nb)) { sum += yOf.get(nb)!; count++; }
    }
    return count ? sum / count : 0;
  }

  function placeColumn(col: number, ids: string[]) {
    const inner = col < 0 ? col + 1 : col - 1;
    const ordered = [...ids].sort((a, b) => neighborMeanY(a, inner) - neighborMeanY(b, inner));
    const center = ordered.reduce((sum, id) => sum + neighborMeanY(id, inner), 0) / Math.max(1, ordered.length);
    const start = center - (ordered.length - 1) * ROW_GAP / 2;
    ordered.forEach((id, idx) => yOf.set(id, start + idx * ROW_GAP));
  }

  // Left side, innermost first (-1 before -2 ...), then right side.
  const leftCols = [...columns.keys()].filter((c) => c < 0).sort((a, b) => b - a);
  for (const c of leftCols) placeColumn(c, columns.get(c)!);
  const rightCols = [...columns.keys()].filter((c) => c > 0).sort((a, b) => a - b);
  for (const c of rightCols) placeColumn(c, columns.get(c)!);
  // Any non-root center nodes (disconnected) stack below the root.
  const centerExtra = (columns.get(0) ?? []).filter((id) => id !== root.id);
  centerExtra.forEach((id, idx) => yOf.set(id, (idx + 1) * ROW_GAP));

  return nodes.map((node) => ({
    ...node,
    x: xOf.get(node.id)! * COLUMN_GAP,
    y: yOf.get(node.id)!,
    side: sideOf.get(node.id)!,
  }));
}

export function graphViewBox(nodes: PositionedNode[], routes: Iterable<EdgeRoute> = []) {
  let minX = Math.min(0, ...nodes.map((node) => node.x));
  let maxX = Math.max(0, ...nodes.map((node) => node.x + NODE_WIDTH));
  let minY = Math.min(0, ...nodes.map((node) => node.y));
  let maxY = Math.max(0, ...nodes.map((node) => node.y + NODE_HEIGHT));
  for (const { bounds } of routes) {
    minX = Math.min(minX, bounds.minX);
    maxX = Math.max(maxX, bounds.maxX);
    minY = Math.min(minY, bounds.minY);
    maxY = Math.max(maxY, bounds.maxY);
  }
  return {
    x: minX - 24,
    y: minY - 24,
    width: maxX - minX + 48,
    height: maxY - minY + 48,
  };
}

// ---- Edge routing -----------------------------------------------------------
//
// Every edge gets its own port. Parallel edges between the same pair are
// staggered vertically; reciprocal edges are pushed apart; self loops are
// drawn as loops on the node's right edge; skip-column edges arc over the top
// gutter so they never cross a node box (no false junctions).

export const PORT_GAP = 16;
const CURVE = 46;
const SIDE_PAD = 4;

export interface EdgeRoute {
  path: string;
  labelX: number;
  labelY: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

export function routeEdges(nodes: PositionedNode[], edges: GraphEdge[]): Map<string, EdgeRoute> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const routes = new Map<string, EdgeRoute>();
  type Incident = { edge: GraphEdge; end: "source" | "target"; node: PositionedNode; other: PositionedNode; side: number };
  const ports = new Map<string, Incident[]>();
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    const direction = to.x >= from.x ? 1 : -1;
    for (const incident of [
      { edge, end: "source" as const, node: from, other: to, side: direction },
      { edge, end: "target" as const, node: to, other: from, side: from.x === to.x ? 1 : -direction },
    ]) {
      const key = JSON.stringify([incident.node.id, incident.side]);
      const group = ports.get(key) ?? [];
      group.push(incident);
      ports.set(key, group);
    }
  }
  const endpoints = new Map<string, { source?: [number, number]; target?: [number, number] }>();
  for (const group of ports.values()) {
    group.sort((a, b) => a.other.y - b.other.y || a.edge.id.localeCompare(b.edge.id) || a.end.localeCompare(b.end));
    group.forEach((incident, index) => {
      const point: [number, number] = [
        incident.node.x + (incident.side > 0 ? NODE_WIDTH + SIDE_PAD : -SIDE_PAD),
        incident.node.y + 8 + (NODE_HEIGHT - 16) * (index + 1) / (group.length + 1),
      ];
      const pair = endpoints.get(incident.edge.id) ?? {};
      pair[incident.end] = point;
      endpoints.set(incident.edge.id, pair);
    });
  }
  const top = Math.min(0, ...nodes.map((node) => node.y));
  let lane = 0;
  for (const edge of edges) {
    const pair = endpoints.get(edge.id);
    if (!pair?.source || !pair.target) continue;
    const [sx, sy] = pair.source;
    const [ex, ey] = pair.target;
    const from = byId.get(edge.from)!;
    const to = byId.get(edge.to)!;
    const points = [pair.source, pair.target];
    let path: string;
    let labelX = (sx + ex) / 2;
    let labelY = (sy + ey) / 2 - 9;
    if (from.x === to.x) {
      const bow = sx + CURVE;
      const above = edge.from === edge.to ? sy - 22 : sy;
      const below = edge.from === edge.to ? ey + 22 : ey;
      path = `M ${sx} ${sy} C ${bow} ${above}, ${bow} ${below}, ${ex} ${ey}`;
      points.push([bow, above], [bow, below]);
      labelX = bow;
    } else {
      const direction = to.x > from.x ? 1 : -1;
      if (Math.abs(to.x - from.x) > COLUMN_GAP) {
        // Rounded lanes stay in column gaps and above every node, even when
        // the endpoints are far down their columns.
        const y = top - 48 - lane++ * PORT_GAP;
        const a = sx + direction * 26;
        const b = ex - direction * 26;
        const r = 16;
        path = `M ${sx} ${sy} Q ${a} ${sy} ${a} ${sy - r} V ${y + r} Q ${a} ${y} ${a + direction * r} ${y} H ${b - direction * r} Q ${b} ${y} ${b} ${y + r} V ${ey - r} Q ${b} ${ey} ${ex} ${ey}`;
        points.push([a, y], [b, y]);
        labelY = y - 9;
      } else {
        path = `M ${sx} ${sy} C ${sx + direction * CURVE} ${sy}, ${ex - direction * CURVE} ${ey}, ${ex} ${ey}`;
        points.push([sx + direction * CURVE, sy], [ex - direction * CURVE, ey]);
      }
    }
    const labelHalf = (edge.type.length + (edge.cycle ? 8 : 0)) * 3 + 8;
    routes.set(edge.id, { path, labelX, labelY, bounds: {
      minX: Math.min(...points.map(([x]) => x), labelX - labelHalf),
      maxX: Math.max(...points.map(([x]) => x), labelX + labelHalf),
      minY: Math.min(...points.map(([, y]) => y), labelY - 16),
      maxY: Math.max(...points.map(([, y]) => y), labelY + 4),
    } });
  }
  return routes;
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

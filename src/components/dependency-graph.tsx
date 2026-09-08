"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  GRAPH_MAX_DEPTH,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_NODES,
  COLUMN_GAP,
  NODE_HEIGHT,
  NODE_WIDTH,
  buildGraph,
  epicGraph,
  graphViewBox,
  layoutGraph,
  type EdgeKind,
  type GraphEdge,
  type GraphNode,
  type PositionedNode,
} from "@/lib/dependency-graph";
import type { EpicChild } from "@/lib/epic-progress";
import type { BeadsIssue } from "@/lib/types";

interface DependencyGraphProps {
  projectId: string;
  issue: BeadsIssue;
  onSelect: (id: string) => void;
}

interface EpicScope {
  epic: BeadsIssue | null;
  children: EpicChild[] | null;
  error: string | null;
  targetId: string;
}

const EDGE_STYLE: Record<EdgeKind, { stroke: string; dash: string; label: string }> = {
  blocks: { stroke: "stroke-destructive", dash: "", label: "blocks" },
  "parent-child": { stroke: "stroke-primary", dash: "", label: "parent-child" },
  related: { stroke: "stroke-muted-foreground", dash: "6 4", label: "related" },
  other: { stroke: "stroke-muted-foreground", dash: "2 4", label: "other/unknown" },
};

function edgeEndpoints(from: PositionedNode, to: PositionedNode) {
  const sy = from.y + NODE_HEIGHT / 2;
  const ey = to.y + NODE_HEIGHT / 2;
  if (from.id === to.id) {
    const x = from.x + NODE_WIDTH;
    return { path: `M ${x} ${from.y + 12} C ${x + 35} ${from.y - 15}, ${x + 35} ${from.y + NODE_HEIGHT + 15}, ${x} ${from.y + NODE_HEIGHT - 12}`, mx: x + 30, my: sy, vertical: true };
  }
  if (from.x === to.x) {
    const x = from.x + NODE_WIDTH;
    return { path: `M ${x + 3} ${sy} H ${x + 30} V ${ey} H ${x + 5}`, mx: x + 30, my: (sy + ey) / 2, vertical: true };
  }
  const direction = to.x > from.x ? 1 : -1;
  const sx = direction > 0 ? from.x + NODE_WIDTH + 3 : from.x - 3;
  const ex = direction > 0 ? to.x - 5 : to.x + NODE_WIDTH + 5;
  if (Math.abs(to.x - from.x) > COLUMN_GAP) {
    // Skip-column edges use the top gutter, never the interior of another node.
    const a = sx + direction * 25;
    const b = ex - direction * 25;
    return { path: `M ${sx} ${sy} H ${a} V -12 H ${b} V ${ey} H ${ex}`, mx: (a + b) / 2, my: -12, vertical: false };
  }
  const mid = (sx + ex) / 2;
  return { path: `M ${sx} ${sy} H ${mid} V ${ey} H ${ex}`, mx: mid, my: (sy + ey) / 2, vertical: false };
}

const KIND_DESCRIPTION: Record<EdgeKind, string> = {
  blocks: "Arrows point from the dependent to its prerequisite.",
  "parent-child": "Arrows point from the child to its parent.",
  related: "Dashed lines mark associations, not ordinary blockers.",
  other: "Dotted gray lines mark conditional or unknown relationship types.",
};

function Legend() {
  return (
    <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
      {(["blocks", "parent-child", "related", "other"] as EdgeKind[]).map((kind) => (
        <li key={kind} className="flex items-center gap-2">
          <svg width="28" height="8" className="shrink-0" aria-hidden="true">
            <line
              x1="0"
              y1="4"
              x2="28"
              y2="4"
              strokeWidth="2"
              strokeDasharray={EDGE_STYLE[kind].dash || undefined}
              className={`${EDGE_STYLE[kind].stroke} stroke-2`}
            />
          </svg>
          <span>
            <span className="font-medium text-foreground">{EDGE_STYLE[kind].label}</span> — {KIND_DESCRIPTION[kind]}
          </span>
        </li>
      ))}
      <li className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 rounded border-2 border-primary bg-background" />
        <span>
          <span className="font-medium text-foreground">Root</span> is the selected issue; its box is outlined.
        </span>
      </li>
      <li className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 shrink-0 rounded border border-dashed border-muted-foreground bg-muted/40" />
        <span>
          <span className="font-medium text-foreground">Closed</span> neighbors and unresolved targets are terminal. Open a closed issue as the root to explore its history.
        </span>
      </li>
    </ul>
  );
}

function GraphCanvas({
  nodes,
  edges,
  expanded,
  canExpandNode,
  loadingNode,
  onToggleExpand,
  onOpenNode,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  expanded: ReadonlySet<string>;
  canExpandNode: (node: GraphNode) => boolean;
  loadingNode: (id: string) => boolean;
  onToggleExpand: (node: GraphNode) => void;
  onOpenNode: (node: GraphNode) => void;
}) {
  const positioned = layoutGraph(nodes);
  const view = graphViewBox(positioned);
  const byId = new Map(positioned.map((node) => [node.id, node]));
  return (
    <div
      role="region"
      aria-label="Dependency graph"
      className="max-h-80 overflow-auto rounded-md border"
    >
      <div className="relative" style={{ width: view.width, height: view.height }}>
        <svg
          width={view.width}
          height={view.height}
          viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
          className="absolute inset-0"
          aria-hidden="true"
        >
          <defs>
            <marker id="graph-arrow-blocks" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--destructive)" />
            </marker>
            <marker id="graph-arrow-parent" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--primary)" />
            </marker>
            <marker id="graph-arrow-other" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = byId.get(edge.from);
            const to = byId.get(edge.to);
            if (!from || !to) return null;
            const { path, mx, my, vertical } = edgeEndpoints(from, to);
            const style = EDGE_STYLE[edge.kind];
            const marker = edge.kind === "blocks" ? "url(#graph-arrow-blocks)" : edge.kind === "parent-child" ? "url(#graph-arrow-parent)" : "url(#graph-arrow-other)";
            return (
              <g key={edge.id}>
                <path
                  d={path}
                  strokeWidth={edge.kind === "parent-child" ? 2.5 : 1.5}
                  strokeDasharray={style.dash || undefined}
                  markerEnd={marker}
                  className={style.stroke}
                  fill="none"
                />
                <text
                  x={mx}
                  y={vertical ? my : my - 6}
                  transform={vertical ? `rotate(-90 ${mx} ${my})` : undefined}
                  textAnchor="middle" className="fill-muted-foreground text-[9px]"
                >
                  {edge.type}
                  {edge.cycle ? " (cycle)" : ""}
                </text>
              </g>
            );
          })}
        </svg>
        {positioned.map((node) => {
          const expandable = canExpandNode(node);
          const isExpanded = expanded.has(node.id);
          return (
            <div
              key={node.id}
              className="absolute flex flex-col rounded-md border bg-card shadow-sm"
              style={{ left: node.x - view.x, top: node.y - view.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
            >
              <button
                type="button"
                disabled={node.missing}
                aria-label={node.missing ? "Unresolved reference" : `${node.id}: ${node.title ?? "Details not loaded"}, ${node.status ?? "status unknown"}, priority ${node.priority ?? "unknown"}`}
                aria-current={node.isRoot ? "true" : undefined}
                onClick={() => onOpenNode(node)}
                className={`flex h-full min-w-0 flex-col items-stretch gap-0.5 rounded-md p-1.5 text-left text-xs focus-visible:outline-2 focus-visible:outline-ring ${
                  node.isRoot ? "border border-primary" : ""
                } ${node.closed ? "opacity-70" : ""} ${node.missing ? "border-dashed border-muted-foreground bg-muted/40 opacity-80" : "hover:bg-accent/40"}`}
              >
                <span className="flex items-center justify-between gap-1 font-mono text-[10px] text-muted-foreground">
                  <span className="truncate">{node.missing ? "unresolved" : node.id}</span>
                  {node.isRoot && <span className="shrink-0 font-sans font-medium text-primary">root</span>}
                </span>
                <span className="truncate text-xs font-medium">{node.missing ? "Unresolved reference" : (node.title ?? "Details not loaded")}</span>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="capitalize">{node.status?.replaceAll("_", " ") ?? "Status unknown"}</span>
                  <span>{node.priority !== undefined ? `P${node.priority}` : "P?"}</span>
                </span>
              </button>
              {expandable && (
                <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={isExpanded}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} node ${node.id}`}
                  onClick={() => onToggleExpand(node)}
                  disabled={loadingNode(node.id)}
                  className="absolute -top-2 -right-2 size-6 rounded-full border bg-background p-0 text-xs"
                >
                  {loadingNode(node.id) ? "…" : isExpanded ? "−" : "+"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function DependencyGraph({ projectId, issue, onSelect }: DependencyGraphProps) {
  const [loaded, setLoaded] = useState<Record<string, BeadsIssue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [limited, setLimited] = useState(false);
  const [epicScope, setEpicScope] = useState<EpicScope | null>(null);
  const reserved = useRef(new Set<string>());
  const requests = useRef(new Map<string, AbortController>());
  const loads = useRef(new Map<string, Promise<BeadsIssue | null>>());
  const scopeRequest = useRef<AbortController | null>(null);
  const rootId = issue.id;

  useEffect(() => {
    const controllers = requests.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      scopeRequest.current?.abort();
    };
  }, []);

  function load(id: string): Promise<BeadsIssue | null> {
    if (loaded[id]) return Promise.resolve(loaded[id]);
    const active = loads.current.get(id);
    if (active) return active;
    if (!reserved.current.has(id) && reserved.current.size >= GRAPH_MAX_NODES) {
      setLimited(true);
      return Promise.resolve(null);
    }
    reserved.current.add(id);
    const controller = new AbortController();
    requests.current.set(id, controller);
    setPending((current) => new Set(current).add(id));
    setErrors((current) => ({ ...current, [id]: "" }));
    const promise = (async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}?relationships=all`, { signal: controller.signal });
        if (!response.ok) throw new Error("Issue unavailable or failed to load");
        const data: BeadsIssue = await response.json();
        if (data.id !== id) throw new Error("Unexpected issue response");
        setLoaded((current) => ({ ...current, [id]: data }));
        return data;
      } catch (error) {
        if (!controller.signal.aborted) setErrors((current) => ({ ...current, [id]: (error as Error).message }));
        return null;
      } finally {
        requests.current.delete(id);
        loads.current.delete(id);
        setPending((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    })();
    loads.current.set(id, promise);
    return promise;
  }

  const root = loaded[rootId] ?? issue;
  const canEpicScope = root.issue_type === "epic" || Boolean(root.parent);

  function canExpandNode(node: GraphNode): boolean {
    return (
      !node.isRoot &&
      !node.missing &&
      !node.closed &&
      (!epicScope || epicScope.children !== null) &&
      node.depth < GRAPH_MAX_DEPTH
    );
  }

  async function toggleExpand(node: GraphNode) {
    if (expanded.has(node.id)) {
      setExpanded((current) => {
        const next = new Set(current);
        next.delete(node.id);
        return next;
      });
      return;
    }
    const data = await load(node.id);
    if (!data) return;
    setExpanded((current) => new Set(current).add(node.id));
  }

  function openNode(node: GraphNode) {
    if (node.missing) return;
    if (node.id === rootId) { scopeRequest.current?.abort(); setEpicScope(null); return; }
    onSelect(node.id);
  }

  async function scopeToEpic(epicId: string) {
    scopeRequest.current?.abort();
    const controller = new AbortController();
    scopeRequest.current = controller;
    setEpicScope({ epic: null, children: null, error: null, targetId: epicId });
    const epic = epicId === rootId ? root : await load(epicId);
    if (controller.signal.aborted) return;
    if (!epic) {
      setEpicScope({ epic: null, children: null, error: "Parent epic unavailable or failed to load.", targetId: epicId });
      return;
    }
    if (epic.issue_type !== "epic") {
      setEpicScope({ epic: null, children: null, error: "The selected parent is not an epic.", targetId: epicId });
      return;
    }
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${encodeURIComponent(epicId)}/children`, { signal: controller.signal });
      if (!response.ok) throw new Error(`failed to load children (HTTP ${response.status})`);
      const children: EpicChild[] = await response.json();
      if (!controller.signal.aborted) setEpicScope({ epic, children, error: null, targetId: epicId });
    } catch (error) {
      if (!controller.signal.aborted) setEpicScope({ epic, children: null, error: (error as Error).message, targetId: epicId });
    }
  }

  const result = epicScope?.epic && epicScope.children
    ? epicGraph(epicScope.epic, epicScope.children, loaded, expanded)
    : buildGraph(root, loaded, expanded);

  const expandableCount = result.nodes.filter((node) => canExpandNode(node) && !expanded.has(node.id)).length;

  return (
    <details
      className="rounded-md border p-3"
      onToggle={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.open) void load(rootId);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">Dependency graph</summary>
      <div className="mt-3 flex min-w-0 flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          A bounded neighborhood centered on the selected issue: the root and its immediate
          neighbors load on demand, and expanding a node pulls in one more hop. Up to{" "}
          {GRAPH_MAX_DEPTH} hops, {GRAPH_MAX_NODES} issues and {GRAPH_MAX_EDGES} edges. Closed and
          unresolved neighbors are terminal. Select a node to open its drawer; the drawer
          Back button returns here.
        </p>
        {pending.has(rootId) && !loaded[rootId] && <p role="status" className="text-xs">Loading full relationships...</p>}

        {canEpicScope && !epicScope && (
          <div className="flex flex-wrap items-center gap-2">
            {root.issue_type === "epic" && (
              <Button size="sm" variant="outline" onClick={() => scopeToEpic(root.id)}>
                Scope to this epic
              </Button>
            )}
            {root.parent && (
              <Button size="sm" variant="outline" onClick={() => scopeToEpic(root.parent!)}>
                Scope to parent epic {root.parent}
              </Button>
            )}
          </div>
        )}

        {epicScope && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              Epic scope: {epicScope.epic ? `${epicScope.epic.id}: ${epicScope.epic.title}` : epicScope.targetId}
              {epicScope.children ? ` · ${epicScope.children.length} direct children (all statuses)` : ""}
            </span>
            <Button size="sm" variant="ghost" onClick={() => { scopeRequest.current?.abort(); setEpicScope(null); }}>
              Back to neighborhood
            </Button>
          </div>
        )}
        {epicScope && !epicScope.children && !epicScope.error && <p role="status" className="text-xs">Loading epic scope...</p>}
        {epicScope?.children && <p className="text-xs text-muted-foreground">Direct-child hierarchy is shown in full within the node limit. Expand a child to load its connections inside this epic. Outside neighbors are omitted.</p>}

        {epicScope?.error && (
          <p role="status" className="text-sm">
            {epicScope.error}{" "}
            <Button size="sm" variant="outline" onClick={() => scopeToEpic(epicScope.targetId)}>
              Retry epic scope
            </Button>
          </p>
        )}

        {errors[rootId] && (
          <p role="status" className="text-sm">
            {errors[rootId]}{" "}
            <Button size="sm" variant="outline" onClick={() => load(rootId)}>
              Retry relationships
            </Button>
          </p>
        )}

        {limited && (
          <p role="status" className="text-sm">Issue load limit reached. Open an issue to explore from there.</p>
        )}

        {Object.entries(errors)
          .filter(([id, message]) => id !== rootId && message && result.nodes.some((node) => node.id === id))
          .map(([id, message]) => (
            <p key={id} role="status" className="text-xs">
              {id}: {message}{" "}
              <Button
                size="xs"
                variant="outline"
                aria-label={`Retry ${id}`}
                onClick={() => {
                  void load(id).then((data) => {
                    if (data) setExpanded((current) => new Set(current).add(id));
                  });
                }}
              >
                Retry
              </Button>
            </p>
          ))}

        {result.nodes.length > 0 && (
          <GraphCanvas
            nodes={result.nodes}
            edges={result.edges}
            expanded={expanded}
            canExpandNode={canExpandNode}
            loadingNode={(id) => pending.has(id)}
            onToggleExpand={toggleExpand}
            onOpenNode={openNode}
          />
        )}

        {result.truncated && <p className="text-xs">More nodes omitted by the {GRAPH_MAX_NODES}-node limit.</p>}
        {result.edgeTruncated && <p className="text-xs">More edges omitted by the {GRAPH_MAX_EDGES}-edge limit.</p>}
        {result.incomplete && !result.truncated && (
          <p className="text-xs">Some relationship data is missing; the graph may be incomplete.</p>
        )}
        {result.cycle && <p className="text-xs">Directed cycles are marked; each issue is visited once.</p>}

        {epicScope?.epic && epicScope.children && epicScope.children.length === 0 && (
          <p className="text-sm text-muted-foreground">No children yet.</p>
        )}

        <details className="rounded-md border p-2">
          <summary className="cursor-pointer text-xs font-medium">
            List view ({result.nodes.length} nodes, {result.edges.length} edges)
          </summary>
          <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
            <ol className="flex flex-col gap-1">
              {result.nodes.map((node) => (
                <li key={node.id} className="flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={node.missing}
                    onClick={() => openNode(node)}
                    className="min-w-0 flex-1 truncate text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {node.missing ? "Unresolved reference" : `${node.id}: ${node.title ?? "Details not loaded"}`}
                  </button>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {node.status?.replaceAll("_", " ") ?? "Status unknown"}
                    {node.priority !== undefined ? ` · P${node.priority}` : " · P?"}
                  </span>
                  {canExpandNode(node) && (
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-expanded={expanded.has(node.id)}
                      aria-label={`${expanded.has(node.id) ? "Collapse" : "Expand"} node ${node.id} in list`}
                      onClick={() => toggleExpand(node)}
                      disabled={pending.has(node.id)}
                    >
                      {expanded.has(node.id) ? "Collapse" : "Expand"}
                    </Button>
                  )}
                </li>
              ))}
            </ol>
            <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
              {result.edges.map((edge) => (
                <li key={edge.id} className="truncate">
                  {edge.from} → {edge.to} ({edge.type})
                  {edge.cycle ? " — cycle, not expanded" : ""}
                </li>
              ))}
            </ul>
          </div>
        </details>

        {expandableCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {expandableCount} node{expandableCount === 1 ? "" : "s"} can be expanded one more hop.
          </p>
        )}

        <Legend />
      </div>
    </details>
  );
}

"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { Button } from "@/components/ui/button";
import { Maximize2Icon, MinusIcon, PlusIcon, ScanIcon, XIcon } from "lucide-react";
import {
  GRAPH_MAX_DEPTH,
  GRAPH_MAX_EDGES,
  GRAPH_MAX_NODES,
  NODE_HEIGHT,
  NODE_WIDTH,
  buildGraph,
  epicGraph,
  graphViewBox,
  layoutGraph,
  routeEdges,
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

interface NodeBoxProps {
  node: PositionedNode;
  view: { x: number; y: number };
  expanded: ReadonlySet<string>;
  canExpandNode: (node: GraphNode) => boolean;
  loadingNode: (id: string) => boolean;
  onToggleExpand: (node: GraphNode) => void;
  onOpenNode: (node: GraphNode) => void;
}

function NodeBox({ node, view, expanded, canExpandNode, loadingNode, onToggleExpand, onOpenNode }: NodeBoxProps) {
  const expandable = canExpandNode(node);
  const isExpanded = expanded.has(node.id);
  return (
    <div
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
}

interface CanvasBodyProps {
  positioned: PositionedNode[];
  view: { x: number; y: number; width: number; height: number };
  routes: Map<string, { path: string; labelX: number; labelY: number }>;
  edges: GraphEdge[];
  expanded: ReadonlySet<string>;
  canExpandNode: (node: GraphNode) => boolean;
  loadingNode: (id: string) => boolean;
  onToggleExpand: (node: GraphNode) => void;
  onOpenNode: (node: GraphNode) => void;
  focusedEdge: string | null;
  onEdgeFocus: (id: string | null) => void;
}

function CanvasBody({
  positioned,
  view,
  routes,
  edges,
  expanded,
  canExpandNode,
  loadingNode,
  onToggleExpand,
  onOpenNode,
  focusedEdge,
  onEdgeFocus,
}: CanvasBodyProps) {
  const uid = useId().replace(/[:]/g, "");
  return (
    <div className="relative" style={{ width: view.width, height: view.height }}>
      <svg
        width={view.width}
        height={view.height}
        viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}
        className="absolute inset-0"
        role="group"
        aria-label="Dependency connections"
      >
        <defs>
          <marker id={`${uid}-arrow-blocks`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--destructive)" />
          </marker>
          <marker id={`${uid}-arrow-parent`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--primary)" />
          </marker>
          <marker id={`${uid}-arrow-other`} markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="var(--muted-foreground)" />
          </marker>
        </defs>
        {edges.map((edge) => {
          const route = routes.get(edge.id);
          if (!route) return null;
          const style = EDGE_STYLE[edge.kind];
          const marker =
            edge.kind === "blocks"
              ? `url(#${uid}-arrow-blocks)`
              : edge.kind === "parent-child"
                ? `url(#${uid}-arrow-parent)`
                : `url(#${uid}-arrow-other)`;
          const focused = focusedEdge === edge.id;
          return (
            <g
              key={edge.id}
              tabIndex={0}
              role="img"
              data-edge={`${edge.from}>${edge.to}:${edge.type}`}
              aria-label={`${edge.type} edge from ${edge.from} to ${edge.to}${edge.cycle ? ", cycle" : ""}`}
              onFocus={() => onEdgeFocus(edge.id)}
              onBlur={() => onEdgeFocus(null)}
              onMouseEnter={() => onEdgeFocus(edge.id)}
              onMouseLeave={() => onEdgeFocus(null)}
              className="cursor-pointer outline-none"
            >
              <path
                d={route.path}
                strokeWidth={14}
                stroke="transparent"
                fill="none"
                style={{ pointerEvents: "stroke" }}
              />
              <path
                d={route.path}
                strokeWidth={edge.kind === "parent-child" ? 2.5 : 1.5}
                strokeDasharray={style.dash || undefined}
                markerEnd={marker}
                className={`${style.stroke} ${focused ? "opacity-100" : "opacity-80"} transition-opacity`}
                fill="none"
              />
              {focused && (
                <text
                  x={route.labelX}
                  y={route.labelY}
                  textAnchor="middle"
                  className="fill-foreground font-medium text-[10px]"
                  paintOrder="stroke"
                  stroke="var(--background)"
                  strokeWidth="3"
                >
                  {edge.type}
                  {edge.cycle ? " (cycle)" : ""}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {positioned.map((node) => (
        <NodeBox
          key={node.id}
          node={node}
          view={view}
          expanded={expanded}
          canExpandNode={canExpandNode}
          loadingNode={loadingNode}
          onToggleExpand={onToggleExpand}
          onOpenNode={onOpenNode}
        />
      ))}
    </div>
  );
}

interface GraphControlsProps {
  root: BeadsIssue;
  canEpicScope: boolean;
  epicScope: EpicScope | null;
  scopeToEpic: (id: string) => void;
  clearEpicScope: () => void;
  pending: ReadonlySet<string>;
  rootId: string;
  errors: Record<string, string>;
  result: ReturnType<typeof buildGraph>;
  limited: boolean;
  expandableCount: number;
  expanded: ReadonlySet<string>;
  canExpandNode: (node: GraphNode) => boolean;
  toggleExpand: (node: GraphNode) => void;
  openNode: (node: GraphNode) => void;
  retryNode: (id: string) => void;
}

function GraphControls({
  root,
  canEpicScope,
  epicScope,
  scopeToEpic,
  clearEpicScope,
  pending,
  rootId,
  errors,
  result,
  limited,
  expandableCount,
  expanded,
  canExpandNode,
  toggleExpand,
  openNode,
  retryNode,
}: GraphControlsProps) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
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
          <Button size="sm" variant="ghost" onClick={clearEpicScope}>
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
          <Button size="sm" variant="outline" onClick={() => retryNode(rootId)}>
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
            <Button size="xs" variant="outline" aria-label={`Retry ${id}`} onClick={() => retryNode(id)}>
              Retry
            </Button>
          </p>
        ))}

      {result.truncated && <p className="text-xs">More nodes omitted by the {GRAPH_MAX_NODES}-node limit.</p>}
      {result.edgeTruncated && <p className="text-xs">More edges omitted by the {GRAPH_MAX_EDGES}-edge limit.</p>}
      {result.incomplete && !result.truncated && (
        <p className="text-xs">Some relationship data is missing; the graph may be incomplete.</p>
      )}
      {result.cycle && <p className="text-xs">Directed cycles are marked; each issue is visited once.</p>}

      {epicScope?.epic && epicScope.children && epicScope.children.length === 0 && (
        <p className="text-sm text-muted-foreground">No children yet.</p>
      )}

      {expandableCount > 0 && (
        <p className="text-xs text-muted-foreground">
          {expandableCount} node{expandableCount === 1 ? "" : "s"} can be expanded one more hop.
        </p>
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

      <Legend />
    </div>
  );
}

function GraphDialog({
  open,
  onOpenChange,
  returnFocusRef,
  canvasProps,
  controls,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: React.RefObject<HTMLElement | null>;
  canvasProps: CanvasBodyProps;
  controls: React.ReactNode;
}) {
  const [scale, setScale] = useState(1);
  const stageRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const { view } = canvasProps;
  const previous = useRef({ view, scale });

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { view, scale };
    const stage = stageRef.current;
    if (!stage || !initialized.current || before.scale !== scale) return;
    // Keep the same world position when expansion changes the scene bounds.
    stage.scrollLeft += (before.view.x - view.x) * scale
      + Math.max(0, (stage.clientWidth - view.width * scale) / 2)
      - Math.max(0, (stage.clientWidth - before.view.width * scale) / 2);
    stage.scrollTop += (before.view.y - view.y) * scale
      + Math.max(0, (stage.clientHeight - view.height * scale) / 2)
      - Math.max(0, (stage.clientHeight - before.view.height * scale) / 2);
  }, [view, scale]);

  function centerAt(x: number, y: number, zoom: number) {
    requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      const padX = Math.max(0, (stage.clientWidth - view.width * zoom) / 2);
      const padY = Math.max(0, (stage.clientHeight - view.height * zoom) / 2);
      stage.scrollLeft = (x - view.x) * zoom + padX - stage.clientWidth / 2;
      stage.scrollTop = (y - view.y) * zoom + padY - stage.clientHeight / 2;
    });
  }

  useEffect(() => {
    if (!open) { initialized.current = false; return; }
    if (initialized.current) return;
    const frame = requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      initialized.current = true;
      const root = canvasProps.positioned.find((node) => node.isRoot);
      if (!root) return;
      const padX = Math.max(0, (stage.clientWidth - view.width * scale) / 2);
      const padY = Math.max(0, (stage.clientHeight - view.height * scale) / 2);
      stage.scrollLeft = (root.x + NODE_WIDTH / 2 - view.x) * scale + padX - stage.clientWidth / 2;
      stage.scrollTop = (root.y + NODE_HEIGHT / 2 - view.y) * scale + padY - stage.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, scale, view, canvasProps.positioned]);

  function zoom(factor: number) {
    const stage = stageRef.current;
    if (!stage) return;
    const x = view.x + (stage.scrollLeft + stage.clientWidth / 2 - Math.max(0, (stage.clientWidth - view.width * scale) / 2)) / scale;
    const y = view.y + (stage.scrollTop + stage.clientHeight / 2 - Math.max(0, (stage.clientHeight - view.height * scale) / 2)) / scale;
    const next = Math.min(4, Math.max(0.1, scale * factor));
    setScale(next);
    centerAt(x, y, next);
  }

  function fit() {
    const stage = stageRef.current;
    if (!stage) return;
    const pad = 40;
    const fitScale = Math.min(
      (stage.clientWidth - pad) / view.width,
      (stage.clientHeight - pad) / view.height,
    );
    const next = Math.max(0.05, Math.min(fitScale, 1));
    setScale(next);
    centerAt(view.x + view.width / 2, view.y + view.height / 2, next);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/40" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex flex-col bg-background text-popover-foreground"
          finalFocus={returnFocusRef}
        >
          <header className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
            <DialogPrimitive.Title className="text-sm font-semibold">Dependency graph</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Enlarged, zoomable dependency graph with accessible controls.
            </DialogPrimitive.Description>
            <div className="ml-auto flex items-center gap-1">
              <Button size="icon-sm" variant="outline" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>
                <MinusIcon className="size-4" />
              </Button>
              <Button size="icon-sm" variant="outline" aria-label="Zoom in" onClick={() => zoom(1.25)}>
                <PlusIcon className="size-4" />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Reset zoom, currently ${Math.round(scale * 100)} percent`} onClick={() => {
                setScale(1);
                const root = canvasProps.positioned.find((node) => node.isRoot);
                if (root) centerAt(root.x + NODE_WIDTH / 2, root.y + NODE_HEIGHT / 2, 1);
              }}>{Math.round(scale * 100)}%</Button>
              <Button size="icon-sm" variant="outline" aria-label="Fit graph to view" onClick={fit}>
                <ScanIcon className="size-4" />
              </Button>
              <DialogPrimitive.Close
                render={
                  <Button size="icon-sm" variant="ghost" aria-label="Close graph">
                    <XIcon className="size-4" />
                  </Button>
                }
              />
            </div>
          </header>
          <div ref={stageRef} role="region" aria-label="Graph workspace" tabIndex={0} className="relative min-h-0 flex-1 overflow-auto focus-visible:outline-2 focus-visible:outline-ring">
            <div className="grid place-items-center" style={{ width: view.width * scale, height: view.height * scale, minWidth: "100%", minHeight: "100%" }}>
              <div className="relative overflow-hidden" style={{ width: view.width * scale, height: view.height * scale }}>
                <div className="absolute" style={{ transform: `scale(${scale})`, transformOrigin: "0 0", width: view.width, height: view.height }}>
                  <CanvasBody {...canvasProps} />
                </div>
              </div>
            </div>
          </div>
          <details className="shrink-0 border-t">
            <summary className="cursor-pointer p-3 text-xs font-medium">Graph details and list <span className="float-right font-normal text-muted-foreground">Scroll to pan</span></summary>
            <div className="max-h-[30dvh] overflow-y-auto px-4 pb-4">{controls}</div>
          </details>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function DependencyGraph({ projectId, issue, onSelect }: DependencyGraphProps) {
  const [loaded, setLoaded] = useState<Record<string, BeadsIssue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [limited, setLimited] = useState(false);
  const [epicScope, setEpicScope] = useState<EpicScope | null>(null);
  const [focusedEdge, setFocusedEdge] = useState<string | null>(null);
  const [largeOpen, setLargeOpen] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
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

  function retryNode(id: string) {
    void load(id).then((data) => {
      if (data) setExpanded((current) => new Set(current).add(id));
    });
  }

  function openNode(node: GraphNode) {
    if (node.missing) return;
    if (node.id === rootId) { scopeRequest.current?.abort(); setEpicScope(null); return; }
    onSelect(node.id);
  }

  function clearEpicScope() {
    scopeRequest.current?.abort();
    setEpicScope(null);
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

  const positioned = layoutGraph(result.nodes, result.edges);
  const routes = routeEdges(positioned, result.edges);
  const view = graphViewBox(positioned, routes.values());

  const expandableCount = result.nodes.filter((node) => canExpandNode(node) && !expanded.has(node.id)).length;

  const canvasProps: CanvasBodyProps = {
    positioned,
    view,
    routes,
    edges: result.edges,
    expanded,
    canExpandNode,
    loadingNode: (id: string) => pending.has(id),
    onToggleExpand: toggleExpand,
    onOpenNode: openNode,
    focusedEdge,
    onEdgeFocus: setFocusedEdge,
  };

  const controls = (
    <GraphControls
      root={root}
      canEpicScope={canEpicScope}
      epicScope={epicScope}
      scopeToEpic={scopeToEpic}
      clearEpicScope={clearEpicScope}
      pending={pending}
      rootId={rootId}
      errors={errors}
      result={result}
      limited={limited}
      expandableCount={expandableCount}
      expanded={expanded}
      canExpandNode={canExpandNode}
      toggleExpand={toggleExpand}
      openNode={openNode}
      retryNode={retryNode}
    />
  );

  return (
    <>
      <details
        className="rounded-md border p-3"
        onToggle={(event) => {
          if (event.target === event.currentTarget && event.currentTarget.open) {
            void load(rootId).then(() => requestAnimationFrame(() => {
              const preview = previewRef.current;
              const root = preview?.querySelector('[aria-current="true"]');
              if (!preview || !root) return;
              const box = root.getBoundingClientRect();
              const viewport = preview.getBoundingClientRect();
              preview.scrollLeft += box.left + box.width / 2 - viewport.left - preview.clientWidth / 2;
              preview.scrollTop += box.top + box.height / 2 - viewport.top - preview.clientHeight / 2;
            }));
          }
        }}
      >
        <summary className="cursor-pointer text-sm font-medium">Dependency graph</summary>
        <div className="mt-3 flex min-w-0 flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Explore relationships around this issue: up to {GRAPH_MAX_DEPTH} hops,
            {" "}{GRAPH_MAX_NODES} issues and {GRAPH_MAX_EDGES} edges. Expand nodes to load more,
            or select one to open its details.
          </p>
          {pending.has(rootId) && !loaded[rootId] && <p role="status" className="text-xs">Loading full relationships...</p>}

          {result.nodes.length > 0 && (
            <>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">Hover or focus an edge to read its type label.</span>
                <Button
                  ref={expandRef}
                  size="sm"
                  variant="outline"
                  onClick={() => setLargeOpen(true)}
                  className="shrink-0"
                >
                  <Maximize2Icon className="size-4" />
                  Expand graph
                </Button>
              </div>
              <div ref={previewRef} role="region" aria-label="Dependency graph" className="max-h-80 overflow-auto rounded-md border">
                <CanvasBody {...canvasProps} />
              </div>
            </>
          )}

          {controls}
        </div>
      </details>

      <GraphDialog
        open={largeOpen}
        onOpenChange={setLargeOpen}
        returnFocusRef={expandRef}
        canvasProps={canvasProps}
        controls={controls}
      />
    </>
  );
}

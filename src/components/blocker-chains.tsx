"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/badges";
import { CHAIN_DEPTH, CHAIN_LIMIT, chainRows, issueLinks, type ChainDirection } from "@/lib/blocker-chains";
import type { BeadsIssue } from "@/lib/types";

export function BlockerChains({ projectId, issueId, onSelect }: {
  projectId: string;
  issueId: string;
  onSelect: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState<Record<string, BeadsIssue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState(new Set<string>());
  const [limited, setLimited] = useState(false);
  const reserved = useRef(new Set<string>());
  const pending = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const requests = pending.current;
    return () => { for (const controller of requests.values()) controller.abort(); };
  }, []);

  async function load(id: string) {
    if (loaded[id] || pending.current.has(id)) return;
    if (!reserved.current.has(id) && reserved.current.size >= CHAIN_LIMIT) {
      setLimited(true);
      return;
    }
    reserved.current.add(id);
    const controller = new AbortController();
    pending.current.set(id, controller);
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const response = await fetch(`/api/projects/${projectId}/issues/${encodeURIComponent(id)}?relationships=all`, { signal: controller.signal });
      if (!response.ok) throw new Error("Issue unavailable or failed to load");
      const data: BeadsIssue = await response.json();
      if (data.id !== id) throw new Error("Unexpected issue response");
      setLoaded((current) => ({ ...current, [id]: data }));
    } catch (error) {
      if (!controller.signal.aborted) setErrors((current) => ({ ...current, [id]: (error as Error).message }));
    } finally {
      pending.current.delete(id);
    }
  }

  function toggle(key: string, id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    if (!expanded.has(key)) void load(id);
  }

  const root = loaded[issueId];
  return (
    <details className="rounded-md border p-3" onToggle={(event) => {
      if (event.target === event.currentTarget && event.currentTarget.open) void load(issueId);
    }}>
      <summary className="cursor-pointer text-sm font-medium">Explore blocker chains</summary>
      <div className="mt-3 flex min-w-0 flex-col gap-4">
        <p className="text-xs text-muted-foreground">Only explicit blocks links are followed; other types are listed separately. This is not a readiness calculation. Up to {CHAIN_DEPTH} hops, {CHAIN_LIMIT} distinct issues and {CHAIN_LIMIT} rows per direction.</p>
        {!root && !errors[issueId] && <p role="status" className="text-sm">Loading relationships...</p>}
        {errors[issueId] && <div role="status" className="text-sm">{errors[issueId]} <Button size="sm" variant="outline" onClick={() => load(issueId)}>Retry relationships</Button></div>}
        {limited && <p role="status" className="text-sm">Issue load limit reached. Open an issue to explore from there.</p>}
        {root && (["dependencies", "dependents"] as ChainDirection[]).map((direction) => {
          const { rows, truncated, incomplete } = chainRows(root, direction, loaded, expanded);
          const other = issueLinks(root, direction).filter((link) => link.type !== "blocks");
          const title = direction === "dependencies" ? "Blocked by" : "Blocks";
          return (
            <section key={direction} aria-label={title} className="min-w-0">
              <h4 className="mb-2 text-sm font-medium">{title}</h4>
              {rows.length === 0 && <p className="text-xs text-muted-foreground">No explicit blocks links returned.</p>}
              <ol className="space-y-2">
                {rows.map((row) => (
                  <li key={row.key} className="min-w-0 border-l pl-2" style={{ marginLeft: (row.depth - 1) * 8 }}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {row.id ? <button type="button" onClick={() => onSelect(row.id!)} className="min-w-0 flex-1 text-left text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">{row.id}{row.title ? `: ${row.title}` : ""}</button> : <span className="text-sm">Unresolved reference</span>}
                      {row.status && <StatusBadge status={row.status} />}
                    </div>
                    <span className="text-xs text-muted-foreground">blocks{row.status === "closed" ? " / closed issue, historical link" : ""}{row.cycle ? " / cycle" : row.repeated ? " / reference shown above" : ""}</span>
                    {row.id && !row.cycle && !row.repeated && (row.depth >= CHAIN_DEPTH ? <p className="text-xs text-muted-foreground">Depth limit reached.</p> : (
                      <div className="mt-1">
                        <Button size="sm" variant="ghost" aria-expanded={expanded.has(row.key)} aria-label={`${expanded.has(row.key) ? "Collapse" : "Expand"} ${row.id} ${title}`} onClick={() => toggle(row.key, row.id!)}>{expanded.has(row.key) ? "Collapse" : "Expand"}</Button>
                        {expanded.has(row.key) && !loaded[row.id] && !errors[row.id] && !limited && <span role="status" className="text-xs">Loading...</span>}
                        {expanded.has(row.key) && errors[row.id] && <p role="status" className="text-xs">{errors[row.id]} <Button size="sm" variant="outline" aria-label={`Retry ${row.id}`} onClick={() => load(row.id!)}>Retry</Button></p>}
                        {expanded.has(row.key) && loaded[row.id] && !issueLinks(loaded[row.id], direction).some((link) => link.type === "blocks") && <p className="text-xs text-muted-foreground">No further blocks links returned.</p>}
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
              {truncated && <p className="text-xs">More links omitted by the row limit.</p>}
              {incomplete && <p className="text-xs">Some relationship data is missing; this chain may be incomplete.</p>}
              {other.length > 0 && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <p>Other relationships (not followed):</p>
                  <ul className="mt-1 flex flex-wrap gap-2">
                    {other.slice(0, CHAIN_LIMIT).map((link, index) => (
                      <li key={`${link.id ?? index}:${link.type}`}>
                        <button type="button" disabled={!link.id} onClick={() => link.id && onSelect(link.id)} className="text-left underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">{link.id ?? "Unresolved reference"} ({link.type})</button>
                      </li>
                    ))}
                  </ul>
                  {other.length > CHAIN_LIMIT && <p>More relationships omitted.</p>}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </details>
  );
}

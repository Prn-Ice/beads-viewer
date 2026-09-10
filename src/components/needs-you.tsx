"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { ChevronRightIcon, InboxIcon, RotateCwIcon } from "lucide-react";
import { PriorityBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { totalNeedsYou, type NeedsYouResponse } from "@/lib/needs-you";

interface NeedsYouProps {
  onSelect: (projectPath: string, issueId: string) => void;
}

// Read-only cross-project inbox: open issues that explicitly ask for human
// input (human label + open + bd --ready). Loaded once on first open, then
// only on manual refresh — no background polling while hidden or open.
export function NeedsYou({ onSelect }: NeedsYouProps) {
  const [data, setData] = useState<NeedsYouResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const hasLoaded = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  async function load(fresh = false) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(null);
    try {
      if (fresh) {
        const refresh = await fetch("/api/refresh", { method: "POST", signal: controller.signal });
        if (!refresh.ok) throw new Error("Couldn't refresh the data");
      }
      const res = await fetch("/api/needs-you", { signal: controller.signal });
      if (!res.ok) throw new Error(`Couldn't load the needs-you list (HTTP ${res.status})`);
      setData((await res.json()) as NeedsYouResponse);
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      request.current = null;
      setLoading(false);
    }
  }

  function onToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (event.target === event.currentTarget && event.currentTarget.open && !hasLoaded.current) {
      hasLoaded.current = true;
      load();
    }
  }

  const count = data ? totalNeedsYou(data.projects) : null;
  const failedProjects = data?.projects.filter((project) => project.error) ?? [];
  const visibleProjects = data?.projects.filter((project) => project.issues.length > 0) ?? [];
  const countLabel = error ? "!" : failedProjects.length ? (count ? `${count}+` : "?") : String(count);

  return (
    <details aria-label="Needs you" onToggle={onToggle} className="group min-w-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 text-xs text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-ring">
        <InboxIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">Needs you</span>
        {(count !== null || error) && (
          <span aria-label={error ? "Refresh failed" : failedProjects.length ? "Count may be incomplete" : undefined} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
            {countLabel}
          </span>
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <div role="region" aria-label="Needs you" className="mt-2 flex max-h-[45vh] min-w-0 flex-col gap-2 overflow-y-auto pr-1">
        <p className="text-xs text-muted-foreground">
          Issues labelled <code className="font-mono">human</code> and ready to
          start, from all your projects. Loaded when you open this; use Refresh
          to update.
        </p>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs text-muted-foreground">
              As of {new Date(data.fetchedAt).toLocaleTimeString()}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => load(true)}
            disabled={loading}
            aria-label="Refresh needs you"
          >
            <RotateCwIcon className="size-3" aria-hidden="true" />
            Refresh
          </Button>
        </div>

        {loading && (
          <p role="status" className="text-xs text-muted-foreground">
            {data ? "Refreshing..." : "Checking projects..."}
          </p>
        )}
        {error && (
          <p role="status" className="text-xs text-destructive [overflow-wrap:anywhere]">
            {error}{data ? " Showing the last result." : ""}
          </p>
        )}
        {data && failedProjects.length > 0 && (
          <p role="status" className="text-xs text-destructive">
            Could not check {failedProjects.length} project{failedProjects.length === 1 ? "" : "s"}.
          </p>
        )}
        {data && !loading && !error && visibleProjects.length === 0 && failedProjects.length === 0 && (
          <p role="status" className="text-xs text-muted-foreground">
            No issues need you right now.
          </p>
        )}
        {data &&
          visibleProjects.map((project) => (
            <section key={project.path} aria-label={`${project.name} needs you`} className="min-w-0">
              <p className="flex items-center gap-2 text-xs font-medium text-foreground">
                <span className="min-w-0 flex-1 truncate" title={project.path}>{project.name}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {project.issues.length}
                </span>
              </p>
              <ul className="mt-1 flex min-w-0 flex-col gap-1">
                {project.issues.map((issue) => (
                  <li key={issue.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onSelect(project.path, issue.id)}
                      className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-md border p-2 text-left text-xs hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
                    >
                      <span className="max-w-full font-mono text-muted-foreground">{issue.id}</span>
                      <PriorityBadge priority={issue.priority} />
                      <span className="min-w-0 flex-1 font-medium">{issue.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        {data &&
          failedProjects.map((project) => (
            <p key={project.path} className="text-xs text-destructive [overflow-wrap:anywhere]">
              {project.name}: {project.error}
            </p>
          ))}
      </div>
    </details>
  );
}

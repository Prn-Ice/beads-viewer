"use client";

import { useEffect, useState } from "react";
import { ChevronRightIcon, RotateCwIcon } from "lucide-react";
import { StatusBadge } from "@/components/badges";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { epicProgress, visibleChildren, type EpicChild } from "@/lib/epic-progress";

interface EpicProgressProps {
  projectId: string;
  issueId: string;
  issueType: string | undefined;
  onSelectIssue: (id: string) => void;
}

/**
 * Epic progress shown in the issue drawer's Overview. Fetches all direct
 * children (every status) once when the epic opens; the drawer never polls it.
 * "Show closed" only filters the list, never the closed/total counts.
 */
export function EpicProgress({ projectId, issueId, issueType, onSelectIssue }: EpicProgressProps) {
  const [children, setChildren] = useState<EpicChild[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (issueType !== "epic") return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/issues/${encodeURIComponent(issueId)}/children`)
      .then((res) => {
        if (!res.ok) throw new Error(`Couldn't load children (HTTP ${res.status})`);
        return res.json();
      })
      .then((data: EpicChild[]) => {
        if (!cancelled) setChildren(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, issueId, issueType, reloadKey]);

  function retry() {
    setChildren(null);
    setError(null);
    setReloadKey((k) => k + 1);
  }

  if (issueType !== "epic") return null;

  if (error) {
    return (
      <section className="flex flex-col gap-3">
        <h4 className="text-sm font-medium">Epic progress</h4>
        <p role="status" className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="w-fit" onClick={retry}>
          <RotateCwIcon className="size-3.5" />
          Retry
        </Button>
      </section>
    );
  }

  if (children === null) {
    return (
      <section aria-label="Epic progress" aria-busy="true" className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-4 w-32" />
      </section>
    );
  }

  const { total, closed } = epicProgress(children);
  const visible = visibleChildren(children, showClosed);
  const percent = total === 0 ? 0 : Math.round((closed / total) * 100);

  return (
    <section aria-label="Epic progress" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-sm font-medium">Epic progress</h4>
        <span className="text-sm tabular-nums text-muted-foreground">
          {closed} of {total} closed
        </span>
      </div>
      {total > 0 && (
        <div
          role="progressbar"
          aria-label="Epic progress"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={closed}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
        </div>
      )}
      <details className="group">
        <summary className="flex cursor-pointer items-center gap-2 rounded-md py-1 text-sm font-medium select-none hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronRightIcon className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
          Children
          <span className="text-xs font-normal text-muted-foreground tabular-nums">
            {visible.length} of {total}
          </span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {total === 0 ? (
            <p className="text-sm text-muted-foreground">No children yet.</p>
          ) : (
            <>
              <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={showClosed}
                  className="accent-primary"
                  onChange={(event) => setShowClosed(event.target.checked)}
                />
                Show closed
              </label>
              <ul className="flex flex-col gap-1">
                {visible.map((child) => (
                  <li key={child.id}>
                    <button
                      type="button"
                      title={`${child.id}: ${child.title}`}
                      onClick={() => onSelectIssue(child.id)}
                      className="flex w-full min-w-0 items-center gap-2 rounded-md border p-2 text-left text-sm hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="max-w-[35%] shrink-0 truncate font-mono text-xs text-muted-foreground">{child.id}</span>
                      <span className="min-w-0 flex-1 truncate">{child.title}</span>
                      <StatusBadge status={child.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </details>
    </section>
  );
}

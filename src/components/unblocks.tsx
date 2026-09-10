"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/badges";
import { UNBLOCK_CANDIDATE_CAP, type UnblockCandidate, type UnblocksAnalysis } from "@/lib/unblocks";

interface UnblocksProps {
  projectId: string;
  issueId: string;
  onSelect: (id: string) => void;
}

function CandidateList({ candidates, onSelect }: {
  candidates: UnblockCandidate[];
  onSelect: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1">
      {candidates.map((candidate) => (
        <li key={candidate.id} className="rounded-md border p-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onSelect(candidate.id)}
              className="min-w-0 flex-1 text-left text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]"
            >
              {candidate.id}
              {candidate.title ? `: ${candidate.title}` : ""}
            </button>
            {candidate.status && <StatusBadge status={candidate.status} />}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{candidate.reason}</p>
          {candidate.remainingBlockers && candidate.remainingBlockers.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              {candidate.remainingBlockers.map((blocker) => (
                <li key={blocker.id ?? blocker.title ?? "unknown"}>
                  <button
                    type="button"
                    disabled={!blocker.id}
                    onClick={() => blocker.id && onSelect(blocker.id)}
                    className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring disabled:no-underline"
                  >
                    {blocker.id ?? blocker.title ?? "unknown blocker"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Group({ title, candidates, onSelect }: {
  title: string;
  candidates: UnblockCandidate[];
  onSelect: (id: string) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <section aria-label={title} className="min-w-0">
      <h4 className="mb-2 text-sm font-medium">{title}</h4>
      <CandidateList candidates={candidates} onSelect={onSelect} />
    </section>
  );
}

// Read-only snapshot: fetched when the disclosure is first opened and kept for
// the session; never polled. A failed load shows an explicit error with a
// Retry action that fetches again.
export function Unblocks({ projectId, issueId, onSelect }: UnblocksProps) {
  const [open, setOpen] = useState(false);
  const [analysis, setAnalysis] = useState<UnblocksAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!open || analysis !== null) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/issues/${encodeURIComponent(issueId)}/unblocks`)
      .then((response) => {
        if (!response.ok) throw new Error(`Couldn't load the unblock estimate (HTTP ${response.status}).`);
        return response.json();
      })
      .then((data: UnblocksAnalysis) => {
        if (!cancelled) {
          setError(null);
          setAnalysis(data);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, analysis, projectId, issueId, reloadKey]);

  const likely = analysis?.candidates.filter((candidate) => candidate.verdict === "likely") ?? [];
  const verify = analysis?.candidates.filter((candidate) => candidate.verdict === "verify") ?? [];
  const notLikely = analysis?.candidates.filter((candidate) => candidate.verdict === "not-likely") ?? [];

  return (
    <details
      className="rounded-md border p-3"
      onToggle={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.open) setOpen(true);
      }}
    >
      <summary className="cursor-pointer text-sm font-medium">What would this unblock?</summary>
      <div className="mt-3 flex min-w-0 flex-col gap-4">
        <p className="text-xs text-muted-foreground">
          An estimate of what finishing this issue would unblock, based on the current issue links. Checks up to {UNBLOCK_CANDIDATE_CAP} issues that directly depend on this one.
        </p>
        {!analysis && !error && <p role="status" className="text-sm">Checking what this would unblock...</p>}
        {error && (
          <div role="status" className="text-sm">
            {error}{" "}
            <Button size="sm" variant="outline" onClick={() => setReloadKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        )}
        {analysis && (
          <>
            {analysis.projectNote && <p role="status" className="text-sm">{analysis.projectNote}</p>}
            <p role="status" className="text-sm">
              {likely.length} would become ready · {verify.length} need a manual check · {notLikely.length} would not change
            </p>
            {analysis.candidates.length === 0 && analysis.omitted === 0 && (
              <p className="text-sm text-muted-foreground">No issues directly depend on this one.</p>
            )}
            <Group title="Would become ready" candidates={likely} onSelect={onSelect} />
            <Group title="Needs a manual check" candidates={verify} onSelect={onSelect} />
            <Group title="Would not change" candidates={notLikely} onSelect={onSelect} />
            {analysis.omitted > 0 && (
              <p role="status" className="text-xs text-muted-foreground">
                Only the first {UNBLOCK_CANDIDATE_CAP} dependents are shown; {analysis.omitted} more {analysis.omitted === 1 ? "is" : "are"} not listed.
              </p>
            )}
            {analysis.missing.length > 0 && (
              <p role="status" className="text-xs text-muted-foreground">
                Could not load details for: {analysis.missing.join(", ")}.
              </p>
            )}
          </>
        )}
      </div>
    </details>
  );
}
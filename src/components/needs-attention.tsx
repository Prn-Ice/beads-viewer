"use client";

import { useState } from "react";
import { AlertTriangleIcon } from "lucide-react";
import { PriorityBadge } from "@/components/badges";
import { computeNeedsAttention, type AttentionReason } from "@/lib/attention";
import { formatDate } from "@/lib/format";
import type { BeadsIssue } from "@/lib/types";

const DEFAULT_URGENT_DAYS = 3;
const DEFAULT_STALL_DAYS = 14;

interface NeedsAttentionProps {
  issues: BeadsIssue[];
  onSelect: (id: string) => void;
}

function clampDays(raw: string, fallback: number): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) return fallback;
  return value;
}

function reasonText(reason: AttentionReason): string {
  const rule =
    reason.rule === "urgent" ? "urgent (P0/P1)" : "possibly stalled (in progress)";
  return `Inactive ${Math.floor(reason.inactiveDays)} days since ${formatDate(
    reason.timestamp,
  )} — ${rule}, threshold ${reason.thresholdDays} days`;
}

export function NeedsAttention({ issues, onSelect }: NeedsAttentionProps) {
  const [urgentInput, setUrgentInput] = useState(String(DEFAULT_URGENT_DAYS));
  const [stallInput, setStallInput] = useState(String(DEFAULT_STALL_DAYS));
  const urgentDays = clampDays(urgentInput, DEFAULT_URGENT_DAYS);
  const stallDays = clampDays(stallInput, DEFAULT_STALL_DAYS);

  const items = computeNeedsAttention(issues, { urgentDays, stallDays });

  return (
    <details className="shrink-0 border-b bg-card/40">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-medium select-none [&::-webkit-details-marker]:hidden focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
        <AlertTriangleIcon className="size-4 text-amber-500" aria-hidden="true" />
        <span>Needs attention</span>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {items.length}
        </span>
      </summary>
      <div className="max-h-[40vh] overflow-y-auto px-4 pb-3">
        <p className="mb-2 text-xs text-muted-foreground">Suggestions for the current project and search, not explicit requests for human input.</p>
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">
            Urgent (P0/P1) stale after
            <input
              type="number"
              min={1}
              step={1}
              value={urgentInput}
              onChange={(event) => setUrgentInput(event.target.value)}
              onBlur={() => setUrgentInput(String(urgentDays))}
              aria-label="Urgent inactivity days"
              className="w-16 rounded border border-input bg-transparent px-1 py-0.5 text-sm text-foreground"
            />
            days
          </label>
          <label className="flex items-center gap-1">
            In progress stalled after
            <input
              type="number"
              min={1}
              step={1}
              value={stallInput}
              onChange={(event) => setStallInput(event.target.value)}
              onBlur={() => setStallInput(String(stallDays))}
              aria-label="Stalled inactivity days"
              className="w-16 rounded border border-input bg-transparent px-1 py-0.5 text-sm text-foreground"
            />
            days
          </label>
          <span>Thresholds apply to this session only.</span>
        </div>
        {items.length === 0 && (
          <p className="py-1 text-xs text-muted-foreground">No issues need attention.</p>
        )}
        <ul className="flex flex-col gap-1">
          {items.map(({ issue, reasons }) => (
            <li key={issue.id}>
              <button
                type="button"
                onClick={() => onSelect(issue.id)}
                className="flex w-full flex-col gap-1 rounded-md border p-2 text-left transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{issue.id}</span>
                  <PriorityBadge priority={issue.priority} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{issue.title}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {reasons.map((reason) => (
                    <span
                      key={reason.rule}
                      className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                    >
                      {reasonText(reason)}
                    </span>
                  ))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}

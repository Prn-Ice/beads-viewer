"use client";

import { Button } from "@/components/ui/button";
import { sessionChanges, type ObservedSession } from "@/lib/session-changes";

export function SessionChanges({ session, onReset, onSelect }: {
  session: ObservedSession | undefined;
  onReset: () => void;
  onSelect: (id: string) => void;
}) {
  const changes = sessionChanges(session);
  return (
    <details className="min-w-0">
      <summary className="cursor-pointer rounded py-1 text-xs text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
        Session changes ({changes.length})
      </summary>
      <div role="region" aria-label="Session changes" className="mt-2 flex min-w-0 flex-col gap-2">
        <p className="text-xs text-muted-foreground">Current project, last observed changes. Not a complete activity history.</p>
        {session && <p className="text-xs text-muted-foreground">Baseline: {new Date(session.startedAt).toLocaleTimeString()}</p>}
        <ul className="max-h-[35vh] space-y-2 overflow-y-auto">
          {changes.map(({ issue, reasons }) => (
            <li key={issue.id}>
              <button type="button" onClick={() => onSelect(issue.id)} className="w-full rounded-md border p-2 text-left text-xs hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring [overflow-wrap:anywhere]">
                <span className="block font-medium">{issue.id}: {issue.title}</span>
                <span className="mt-1 block text-muted-foreground">{reasons.join("; ")}</span>
              </button>
            </li>
          ))}
        </ul>
        {changes.length === 0 && <p className="text-xs text-muted-foreground">No observed changes.</p>}
        <Button size="sm" variant="outline" onClick={onReset} disabled={!session}>Reset baseline</Button>
      </div>
    </details>
  );
}

import { IssueCard } from "@/components/issue-card";
import { bucketIssues, type BoardColumns } from "@/lib/buckets";
import type { BeadsIssue } from "@/lib/types";

interface BoardProps {
  issues: BeadsIssue[];
  readyIds: string[];
  includeClosed: boolean;
  onSelect: (id: string) => void;
}

export function Board({ issues, readyIds, includeClosed, onSelect }: BoardProps) {
  const columns = bucketIssues(issues, readyIds);
  const visible: { key: keyof BoardColumns; label: string }[] = [
    { key: "ready", label: "Ready" },
    { key: "in_progress", label: "In Progress" },
    { key: "blocked", label: "Blocked" },
    { key: "backlog", label: "Backlog" },
  ];
  if (includeClosed) {
    visible.push({ key: "closed", label: "Closed" });
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-x-auto">
      <div className="flex h-full min-w-max gap-4 p-4">
        {visible.map(({ key, label }) => (
          <section key={key} className="flex w-72 flex-col gap-2">
            <header className="flex items-center gap-2 px-1">
              <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {columns[key].length}
              </span>
            </header>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto pb-2">
              {columns[key].length === 0 && (
                <div className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Nothing here
                </div>
              )}
              {columns[key].map((issue) => (
                <IssueCard key={issue.id} issue={issue} onSelect={onSelect} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

import type { BeadsIssue } from "./types";

export interface BoardColumns {
  ready: BeadsIssue[];
  in_progress: BeadsIssue[];
  blocked: BeadsIssue[];
  backlog: BeadsIssue[];
  closed: BeadsIssue[];
}

export function sortIssues(issues: BeadsIssue[]): BeadsIssue[] {
  return [...issues].sort((a, b) => {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return (b.updated_at ?? "").localeCompare(a.updated_at ?? "");
  });
}

// Closed issues have no priority to act on; what matters is what happened
// most recently, so they sort by close time (falling back to update time).
export function sortClosedIssues(issues: BeadsIssue[]): BeadsIssue[] {
  return [...issues].sort((a, b) =>
    (b.closed_at ?? b.updated_at ?? "").localeCompare(a.closed_at ?? a.updated_at ?? ""),
  );
}

export function bucketIssues(issues: BeadsIssue[], readyIds: string[]): BoardColumns {
  const ready = new Set(readyIds);
  const columns: BoardColumns = {
    ready: [],
    in_progress: [],
    blocked: [],
    backlog: [],
    closed: [],
  };
  for (const issue of issues) {
    if (issue.status === "in_progress") {
      columns.in_progress.push(issue);
    } else if (issue.status === "blocked") {
      columns.blocked.push(issue);
    } else if (issue.status === "closed") {
      columns.closed.push(issue);
    } else if (ready.has(issue.id)) {
      columns.ready.push(issue);
    } else {
      columns.backlog.push(issue);
    }
  }
  for (const column of Object.keys(columns) as (keyof BoardColumns)[]) {
    columns[column] = column === "closed" ? sortClosedIssues(columns[column]) : sortIssues(columns[column]);
  }
  return columns;
}

import type { BeadsIssue } from "./types";

export type SortKey =
  | "id"
  | "title"
  | "priority"
  | "status"
  | "type"
  | "parent"
  | "assignee"
  | "age";
export type SortDir = "asc" | "desc";

export const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "priority", label: "Priority" },
  { key: "status", label: "Status" },
  { key: "type", label: "Type" },
  { key: "parent", label: "Parent" },
  { key: "assignee", label: "Assignee" },
  { key: "age", label: "Age" },
];

// Returns a comparable primitive for a column, or null when the value is
// absent. Missing values are handled explicitly: they always sort to the end,
// regardless of direction.
function sortValue(issue: BeadsIssue, key: SortKey): number | string | null {
  switch (key) {
    case "id":
      return issue.id;
    case "title":
      return issue.title;
    case "priority":
      return issue.priority ?? null;
    case "status":
      return issue.status;
    case "type":
      return issue.issue_type || null;
    case "parent":
      return issue.parent || null;
    case "assignee":
      return issue.assignee || null;
    case "age": {
      const time = issue.created_at ? Date.parse(issue.created_at) : NaN;
      return Number.isFinite(time) ? time : null;
    }
  }
}

function compare(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

// Deterministic sort: primary by the chosen column, then by issue ID to break
// ties. Missing values stay last in both directions.
export function sortIssuesByKey(
  issues: BeadsIssue[],
  key: SortKey,
  dir: SortDir,
): BeadsIssue[] {
  return [...issues].sort((a, b) => {
    const av = sortValue(a, key);
    const bv = sortValue(b, key);
    if (av === null && bv === null) return a.id.localeCompare(b.id);
    if (av === null) return 1;
    if (bv === null) return -1;
    let cmp = compare(av, bv);
    if (cmp === 0) cmp = a.id.localeCompare(b.id);
    return dir === "asc" ? cmp : -cmp;
  });
}

// Clicking the same column toggles its direction; a new column starts ascending.
export function nextSort(
  key: SortKey,
  current: SortKey,
  dir: SortDir,
): SortDir {
  return key === current ? (dir === "asc" ? "desc" : "asc") : "asc";
}

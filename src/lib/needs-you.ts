// Shared contract for the Needs You inbox: the GET route returns this shape and
// the sidebar panel renders it. Kept here (not in lib/types.ts) because the
// inbox is an isolated feature with its own data path.

export interface NeedsYouIssue {
  id: string;
  title: string;
  priority?: number;
  status: string;
}

export interface NeedsYouProject {
  path: string;
  name: string;
  issues: NeedsYouIssue[];
  /** Set when this project could not be checked; issues stay empty. */
  error?: string;
}

export interface NeedsYouResponse {
  fetchedAt: number;
  projects: NeedsYouProject[];
}

export const HUMAN_LABEL = "human";
export const NEEDS_YOU_ARGS = [
  "list",
  "--label",
  HUMAN_LABEL,
  "--ready",
  "--status",
  "open",
  "--limit",
  "0",
];

/**
 * Normalize one raw `bd list` entry into a Needs You candidate. The CLI filter
 * (`--label human --ready --status open`) is the authority for eligibility;
 * this only defends against malformed or drift data, so future-deferred
 * requests stay out even if a future bd version stops excluding them.
 */
export function normalizeCandidate(raw: unknown, now: number = Date.now()): NeedsYouIssue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const entry = raw as Record<string, unknown>;
  if (typeof entry.id !== "string" || entry.id === "") return null;
  if (typeof entry.title !== "string" || entry.title === "") return null;
  if (entry.status !== "open") return null;
  const labels = entry.labels;
  if (!Array.isArray(labels) || !labels.includes(HUMAN_LABEL)) return null;
  const deferUntil = entry.defer_until;
  if (typeof deferUntil === "string" && deferUntil !== "") {
    const when = new Date(deferUntil).getTime();
    if (Number.isFinite(when) && when > now) return null;
  }
  const priority = typeof entry.priority === "number" && Number.isInteger(entry.priority) && entry.priority >= 0 && entry.priority <= 4 ? entry.priority : undefined;
  return { id: entry.id, title: entry.title, priority, status: "open" };
}

/** Deterministic order: priority ascending (unknown last), then issue id. */
export function sortNeedsYouIssues(issues: NeedsYouIssue[]): NeedsYouIssue[] {
  return [...issues].sort((a, b) => {
    const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.id.localeCompare(b.id);
  });
}

/** Total count across every loaded project in the snapshot. */
export function totalNeedsYou(projects: NeedsYouProject[]): number {
  return projects.reduce((sum, project) => sum + project.issues.length, 0);
}

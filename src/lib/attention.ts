import type { BeadsIssue } from "./types";

export const MS_PER_DAY = 86_400_000;

export interface AttentionReason {
  rule: "urgent" | "stalled";
  thresholdDays: number;
  timestamp: string;
  inactiveDays: number;
}

export interface AttentionItem {
  issue: BeadsIssue;
  reasons: AttentionReason[];
}

export interface AttentionThresholds {
  urgentDays: number;
  stallDays: number;
}

function parseMs(iso: string | undefined | null): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}

function validTimestamp(iso: string | undefined | null): boolean {
  return Number.isFinite(parseMs(iso));
}

// Inactivity is measured from updated_at, falling back to created_at only when
// updated_at is entirely absent. A present-but-invalid updated_at yields no
// claim rather than silently using created_at.
function activityTimestamp(issue: BeadsIssue): string | undefined {
  if (validTimestamp(issue.updated_at)) return issue.updated_at;
  if (
    issue.updated_at === undefined ||
    issue.updated_at === null ||
    issue.updated_at === ""
  ) {
    if (validTimestamp(issue.created_at)) return issue.created_at;
  }
  return undefined;
}

export function inactivityDays(issue: BeadsIssue, now: number): number | null {
  const ts = activityTimestamp(issue);
  if (!ts) return null;
  return (now - parseMs(ts)) / MS_PER_DAY;
}

// Closed and deferred issues never need attention, nor do issues whose
// defer_until is a valid future date. Missing or unparseable defer_until does
// not exclude an issue.
function isExcluded(issue: BeadsIssue, now: number): boolean {
  if (issue.status === "closed" || issue.status === "deferred") return true;
  const deferMs = parseMs(issue.defer_until);
  return Number.isFinite(deferMs) && deferMs > now;
}

function attentionReasons(
  issue: BeadsIssue,
  thresholds: AttentionThresholds,
  now: number,
): AttentionReason[] {
  if (isExcluded(issue, now)) return [];
  const ts = activityTimestamp(issue);
  if (!ts) return [];
  const inactiveDays = (now - parseMs(ts)) / MS_PER_DAY;

  const reasons: AttentionReason[] = [];
  const priority = issue.priority;
  if ((priority === 0 || priority === 1) && inactiveDays >= thresholds.urgentDays) {
    reasons.push({
      rule: "urgent",
      thresholdDays: thresholds.urgentDays,
      timestamp: ts,
      inactiveDays,
    });
  }
  if (issue.status === "in_progress" && inactiveDays >= thresholds.stallDays) {
    reasons.push({
      rule: "stalled",
      thresholdDays: thresholds.stallDays,
      timestamp: ts,
      inactiveDays,
    });
  }
  return reasons;
}

export function computeNeedsAttention(
  issues: BeadsIssue[],
  thresholds: AttentionThresholds,
  now: number = Date.now(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const issue of issues) {
    const reasons = attentionReasons(issue, thresholds, now);
    if (reasons.length > 0) items.push({ issue, reasons });
  }

  // Deterministic: priority ascending, then oldest inactivity first, then id.
  items.sort((a, b) => {
    const pa = a.issue.priority ?? Number.MAX_SAFE_INTEGER;
    const pb = b.issue.priority ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    const da = inactivityDays(a.issue, now) ?? -1;
    const db = inactivityDays(b.issue, now) ?? -1;
    if (da !== db) return db - da;
    return a.issue.id.localeCompare(b.issue.id);
  });
  return items;
}

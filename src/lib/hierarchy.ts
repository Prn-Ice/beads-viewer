import type { BeadsIssue } from "./types";

/**
 * Counts direct children per parent id. The input list must span every status
 * (bd list --all) so counts stay complete regardless of board scope.
 */
export function countChildren(
  issues: Pick<BeadsIssue, "parent">[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) {
    if (!issue.parent) continue;
    counts[issue.parent] = (counts[issue.parent] ?? 0) + 1;
  }
  return counts;
}

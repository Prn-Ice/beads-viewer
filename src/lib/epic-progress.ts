/**
 * Epic progress helpers. The `/children` API returns every DIRECT child of an
 * epic in every status (bd list --parent <id> --status all --limit 0), so the
 * denominator is the full child set and never depends on board scope, search,
 * or the drawer's "Show closed" toggle. Only parent-child edges count; blocking
 * or plain dependency links are not children and never reach this code.
 */

export interface EpicChild {
  id: string;
  title: string;
  status: string;
  issue_type?: string;
}

export function epicProgress(children: EpicChild[]): { total: number; closed: number } {
  const total = children.length;
  const closed = children.filter((child) => child.status === "closed").length;
  return { total, closed };
}

/**
 * Children shown in the drawer list. Hiding closed children filters only the
 * list; callers compute progress from the full `children` array, so the
 * denominator is unchanged.
 */
export function visibleChildren(children: EpicChild[], showClosed: boolean): EpicChild[] {
  if (showClosed) return children;
  return children.filter((child) => child.status !== "closed");
}
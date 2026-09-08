import type { BeadsIssue } from "./types";

export type ChainDirection = "dependencies" | "dependents";
export const CHAIN_DEPTH = 3;
export const CHAIN_LIMIT = 30;

export interface IssueLink {
  id: string | null;
  type: string;
  title?: string;
  status?: string;
  priority?: number;
  issue_type?: string;
}

export function issueLinks(issue: BeadsIssue, direction: ChainDirection): IssueLink[] {
  const seen = new Set<string>();
  const links: IssueLink[] = [];
  for (const ref of issue[direction] ?? []) {
    // Hydrated bd show records use id/dependency_type. Raw edges use endpoint
    // fields; their id can identify the edge itself, not an issue.
    const raw = ref.dependency_type === undefined && (ref.issue_id !== undefined || ref.depends_on_id !== undefined);
    const id = raw ? (direction === "dependencies" ? ref.depends_on_id : ref.issue_id) : ref.id;
    const type = ref.dependency_type ?? ref.type ?? "unknown";
    const key = JSON.stringify([id, type]);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ id: id || null, type, title: ref.title, status: ref.status, priority: ref.priority, issue_type: ref.issue_type });
  }
  return links;
}

export interface ChainRow extends IssueLink {
  key: string;
  depth: number;
  cycle: boolean;
  repeated: boolean;
}

export function chainRows(
  root: BeadsIssue,
  direction: ChainDirection,
  loaded: Record<string, BeadsIssue>,
  expanded: ReadonlySet<string>,
) {
  const rows: ChainRow[] = [];
  const seen = new Set([root.id]);
  let truncated = false;
  let incomplete = false;
  function visit(issue: BeadsIssue, path: string, ancestors: string[], depth: number) {
    const count = direction === "dependencies" ? issue.dependency_count : issue.dependent_count;
    if (count > (issue[direction]?.length ?? 0)) incomplete = true;
    for (const [index, link] of issueLinks(issue, direction).entries()) {
      if (link.type !== "blocks") continue;
      if (rows.length >= CHAIN_LIMIT) { truncated = true; return; }
      const key = `${path}/${index}`;
      const cycle = link.id !== null && ancestors.includes(link.id);
      const repeated = !cycle && link.id !== null && seen.has(link.id);
      const data = link.id ? loaded[link.id] : undefined;
      rows.push({ ...link, title: data?.title ?? link.title, status: data?.status ?? link.status, key, depth, cycle, repeated });
      if (!link.id) { incomplete = true; continue; }
      seen.add(link.id);
      if (data && expanded.has(key) && !cycle && !repeated && depth < CHAIN_DEPTH) {
        visit(data, key, [...ancestors, link.id], depth + 1);
      }
    }
  }
  visit(root, direction, [root.id], 1);
  return { rows, truncated, incomplete };
}

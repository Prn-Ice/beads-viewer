import type { BeadsIssue } from "./types";

// URL contract for the dashboard's search/scope/filters state. Every view
// parameter lives in the query string so bookmarks and Back/Forward restore
// the exact board. See docs/filters.md.
export const SEARCH_PARAM = "q";
export const SCOPE_PARAM = "scope";
export const PRIORITY_PARAM = "priority";
export const TYPE_PARAM = "type";
export const LABEL_PARAM = "label";
export const ASSIGNEE_PARAM = "assignee";
// Unassigned is a separate boolean param so it can never collide with a real
// assignee name. Only the literal value "1" enables it; anything else is
// ignored like other invalid values.
export const UNASSIGNED_PARAM = "unassigned";

export const PRIORITY_OPTIONS = [0, 1, 2, 3, 4] as const;

export type Scope = "open" | "all";

export interface FilterState {
  priorities: number[];
  types: string[];
  labels: string[];
  assignees: string[];
  unassigned: boolean;
}

export interface ViewState {
  search: string;
  scope: Scope;
  filters: FilterState;
}

export interface FacetChoices {
  types: string[];
  labels: string[];
  assignees: string[];
}

export const EMPTY_FILTERS: FilterState = {
  priorities: [],
  types: [],
  labels: [],
  assignees: [],
  unassigned: false,
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Read the view state from URL params. Invalid priority numbers and unknown
 * scope values are ignored (the default wins); empty tokens are dropped.
 */
export function parseViewState(params: URLSearchParams): ViewState {
  const priorities: number[] = [];
  for (const raw of params.getAll(PRIORITY_PARAM)) {
    if (!/^[0-4]$/.test(raw)) continue;
    const value = Number(raw);
    if (!priorities.includes(value)) priorities.push(value);
  }
  return {
    search: params.get(SEARCH_PARAM) ?? "",
    scope: params.get(SCOPE_PARAM) === "all" ? "all" : "open",
    filters: {
      priorities,
      types: dedupe(params.getAll(TYPE_PARAM)).filter((value) => value !== ""),
      labels: dedupe(params.getAll(LABEL_PARAM)).filter((value) => value !== ""),
      assignees: dedupe(params.getAll(ASSIGNEE_PARAM)).filter((value) => value !== ""),
      unassigned: params.get(UNASSIGNED_PARAM) === "1",
    },
  };
}

function setAll(params: URLSearchParams, key: string, values: string[]) {
  params.delete(key);
  for (const value of values) params.append(key, value);
}

/**
 * Return a copy of `params` with the view state applied. Defaults are omitted
 * (no `q` for an empty search, no `scope` for the default open scope) and every
 * unrelated parameter is preserved.
 */
export function applyViewToParams(params: URLSearchParams, view: ViewState): URLSearchParams {
  const next = new URLSearchParams(params.toString());
  if (view.search) next.set(SEARCH_PARAM, view.search);
  else next.delete(SEARCH_PARAM);
  if (view.scope === "all") next.set(SCOPE_PARAM, "all");
  else next.delete(SCOPE_PARAM);
  setAll(next, PRIORITY_PARAM, view.filters.priorities.map(String));
  setAll(next, TYPE_PARAM, view.filters.types);
  setAll(next, LABEL_PARAM, view.filters.labels);
  setAll(next, ASSIGNEE_PARAM, view.filters.assignees);
  if (view.filters.unassigned) next.set(UNASSIGNED_PARAM, "1");
  else next.delete(UNASSIGNED_PARAM);
  return next;
}

function matchesSearch(issue: BeadsIssue, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    issue.id.toLowerCase().includes(q) ||
    issue.title.toLowerCase().includes(q) ||
    (issue.labels ?? []).some((label) => label.toLowerCase().includes(q))
  );
}

/**
 * Facet matching: OR within each facet (any selected priority, type, label, or
 * assignee matches), AND across facets. "Unassigned" matches issues with no
 * assignee and ORs with selected assignee names.
 */
export function matchesFilters(issue: BeadsIssue, filters: FilterState): boolean {
  if (
    filters.priorities.length > 0 &&
    (issue.priority === undefined || !filters.priorities.includes(issue.priority))
  ) {
    return false;
  }
  if (filters.types.length > 0 && !filters.types.includes(issue.issue_type ?? "")) {
    return false;
  }
  if (
    filters.labels.length > 0 &&
    !(issue.labels ?? []).some((label) => filters.labels.includes(label))
  ) {
    return false;
  }
  if (filters.assignees.length > 0 || filters.unassigned) {
    const assigned = filters.assignees.includes(issue.assignee ?? "");
    const unassigned = filters.unassigned && !issue.assignee;
    if (!assigned && !unassigned) return false;
  }
  return true;
}

export function applyFilters(issues: BeadsIssue[], view: ViewState): BeadsIssue[] {
  return issues.filter(
    (issue) => matchesSearch(issue, view.search) && matchesFilters(issue, view.filters),
  );
}

/**
 * Facet choices come from the unfiltered issue set (the current scope, before
 * search or filters apply) plus any currently selected tokens, so a selected
 * label or assignee can never disappear from its facet even when no current
 * result carries it.
 */
export function facetChoices(issues: BeadsIssue[], filters: FilterState): FacetChoices {
  const types = new Set(filters.types);
  const labels = new Set(filters.labels);
  const assignees = new Set(filters.assignees);
  for (const issue of issues) {
    if (issue.issue_type) types.add(issue.issue_type);
    for (const label of issue.labels ?? []) labels.add(label);
    if (issue.assignee) assignees.add(issue.assignee);
  }
  return {
    types: [...types].sort(),
    labels: [...labels].sort(),
    assignees: [...assignees].sort(),
  };
}

export function countActiveFilters(filters: FilterState): number {
  return (
    filters.priorities.length +
    filters.types.length +
    filters.labels.length +
    filters.assignees.length +
    (filters.unassigned ? 1 : 0)
  );
}

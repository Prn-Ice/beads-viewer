export const PROJECT_PARAM = "project";
export const ISSUE_PARAM = "issue";

export interface DeepLinkState {
  project: string | null;
  issue: string | null;
}

export function readDeepLink(params: URLSearchParams): DeepLinkState {
  return { project: params.get(PROJECT_PARAM), issue: params.get(ISSUE_PARAM) };
}

/**
 * Return a path+query string with the given deep-link params applied, preserving
 * every unrelated query parameter. Passing null deletes the parameter.
 */
export function withDeepLink(
  pathname: string,
  params: URLSearchParams,
  changes: { project?: string | null; issue?: string | null },
): string {
  const next = new URLSearchParams(params.toString());
  if (changes.project !== undefined) {
    if (changes.project === null) next.delete(PROJECT_PARAM);
    else next.set(PROJECT_PARAM, changes.project);
  }
  if (changes.issue !== undefined) {
    if (changes.issue === null) next.delete(ISSUE_PARAM);
    else next.set(ISSUE_PARAM, changes.issue);
  }
  const query = next.toString();
  return query ? `${pathname}?${query}` : pathname;
}

/**
 * Build an absolute shareable URL for an issue, preserving unrelated query
 * params and the existing hash. `search` is the raw query string (with or
 * without a leading `?`) and `hash` includes its leading `#` (or empty).
 */
export function buildIssueUrl(
  origin: string,
  pathname: string,
  search: string,
  hash: string,
  project: string,
  issue: string,
): string {
  const params = new URLSearchParams(search);
  params.set(PROJECT_PARAM, project);
  params.set(ISSUE_PARAM, issue);
  const query = params.toString();
  return `${origin}${pathname}${query ? `?${query}` : ""}${hash}`;
}

// On-demand "what would this unblock?" estimation. The API route feeds this
// pure module with the root issue record (hydrated dependents), the project's
// `bd ready --explain` snapshot, and full candidate records; it returns a
// verdict per direct dependent. It deliberately does NOT reimplement bd's
// readiness engine: anything it cannot confirm from the observed snapshot is
// reported as "needs verification" instead of guessed.

import { issueLinks } from "./blocker-chains";
import type { BeadsIssue } from "./types";

export const UNBLOCK_CANDIDATE_CAP = 25;

export type UnblockVerdict = "likely" | "verify" | "not-likely";

export interface ExplainBlocker {
  id?: string;
  title?: string;
  status?: string;
  priority?: number;
}

export interface ExplainBlockedItem {
  id?: string;
  title?: string;
  status?: string;
  blocked_by?: ExplainBlocker[];
  blocked_by_count?: number;
}

export interface ReadyExplain {
  schema_version?: number;
  ready?: { id?: string; status?: string }[];
  blocked?: ExplainBlockedItem[];
  summary?: { cycle_count?: number; total_ready?: number; total_blocked?: number };
}

export interface UnblockCandidate {
  id: string;
  title?: string;
  status?: string;
  verdict: UnblockVerdict;
  /** Human-readable reason shown next to the candidate. */
  reason: string;
  /** Other active blockers reported by bd ready --explain, when known. */
  remainingBlockers?: ExplainBlocker[];
}

export interface UnblocksAnalysis {
  rootId: string;
  rootStatus?: string;
  projectCycleCount: number;
  candidates: UnblockCandidate[];
  /** Root dependents skipped because the candidate cap was reached. */
  omitted: number;
  /** Candidate ids whose full record could not be loaded. */
  missing: string[];
  /** Project-level reason why nothing could be positively estimated. */
  projectNote?: string;
}

// bd treats these as associations, graph links, entity links, or plain
// cross-references: they never make an issue blocked. `until`,
// `delegated-from`, and anything unknown are NOT on the list: they are
// reported for verification instead of being assumed harmless.
const PURE_ASSOCIATION_TYPES = new Set([
  "related",
  "discovered-from",
  "replies-to",
  "relates-to",
  "duplicates",
  "supersedes",
  "authored-by",
  "assigned-to",
  "approved-by",
  "attests",
  "tracks",
  "caused-by",
  "validates",
]);

// Types that represent claimable work. Epics, molecules, gates, messages,
// milestones, and custom types are structural or internal and are never
// positively estimated.
const ORDINARY_WORK_TYPES = new Set([
  "task",
  "bug",
  "feature",
  "chore",
  "decision",
  "spike",
  "story",
]);

// bd treats hooked (actively claimed) work as completable, like open/in_progress/blocked.
const ACTIVE_ROOT_STATUSES = new Set(["open", "in_progress", "blocked", "hooked"]);

/**
 * Validate the `bd ready --explain --json` response shape. Returns null when
 * the document is not the expected object (schema drift or a bd version whose
 * readiness semantics we cannot trust); callers then fall back to
 * verification instead of guessing.
 */
export function parseReadyExplain(raw: unknown): ReadyExplain | null {
  if (typeof raw !== "object" || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data.schema_version !== undefined && data.schema_version !== 1) return null;
  if (!Array.isArray(data.blocked) || !Array.isArray(data.ready)) return null;
  const summary = data.summary;
  if (typeof summary !== "object" || summary === null) return null;
  const s = summary as Record<string, unknown>;
  // A missing or non-number cycle_count means schema drift: the project's
  // cycle state is unknown, which must force verification, never read as 0.
  if (typeof s.cycle_count !== "number") return null;
  return {
    schema_version: data.schema_version as number | undefined,
    ready: data.ready as { id?: string; status?: string }[],
    blocked: data.blocked as ExplainBlockedItem[],
    summary: {
      cycle_count: s.cycle_count,
      total_ready: typeof s.total_ready === "number" ? s.total_ready : 0,
      total_blocked: typeof s.total_blocked === "number" ? s.total_blocked : 0,
    },
  };
}

export interface RootDependent {
  id: string;
  edgeType: string;
  title?: string;
  status?: string;
}

/**
 * Direct dependents that completing the root could plausibly affect. `blocks`
 * is the positive path; `parent-child` (parent inheritance), `waits-for`
 * (gates), and `conditional-blocks` (fires only on a FAILURE close) always
 * report for verification because their bd semantics are not simple
 * completion. Other edge types (related, etc.) are never readiness-relevant.
 * Deduplicates by issue id, preferring the blocks edge when both exist, and
 * caps the list so one hub bead cannot flood the disclosure.
 */
export function unblockCandidates(root: BeadsIssue): { list: RootDependent[]; omitted: number } {
  const byId = new Map<string, RootDependent>();
  for (const link of issueLinks(root, "dependents")) {
    if (!link.id || link.id === root.id) continue;
    if (link.type !== "blocks" && link.type !== "parent-child" && link.type !== "waits-for" && link.type !== "conditional-blocks") continue;
    const existing = byId.get(link.id);
    if (!existing || (existing.edgeType !== "blocks" && link.type === "blocks")) {
      byId.set(link.id, { id: link.id, edgeType: link.type, title: link.title, status: link.status });
    }
  }
  const list = [...byId.values()];
  return { list: list.slice(0, UNBLOCK_CANDIDATE_CAP), omitted: Math.max(0, list.length - UNBLOCK_CANDIDATE_CAP) };
}

/**
 * Verdict for every direct dependent, based only on the observed snapshot.
 * `records` maps candidate ids to their full `bd show` records. A positive
 * verdict is only issued when the CLI explain, the root's hydrated edges, and
 * the candidate's own record all agree that the root is the candidate's sole
 * active blocker and nothing else stands in the way.
 */
export function analyzeUnblocks(
  root: BeadsIssue,
  explain: ReadyExplain | null,
  records: ReadonlyMap<string, BeadsIssue>,
  now: number = Date.now(),
  explainNote?: string,
): UnblocksAnalysis {
  const { list, omitted } = unblockCandidates(root);
  const missing = list.filter((dep) => !records.has(dep.id)).map((dep) => dep.id);

  const cycleCount = explain?.summary?.cycle_count ?? 0;
  let projectNote: string | undefined;
  if (explain === null) {
    projectNote = explainNote ?? "bd ready --explain is unavailable; estimates need manual verification.";
  } else if (cycleCount > 0) {
    projectNote = `The project has ${cycleCount} dependency cycle(s); estimates need manual verification.`;
  } else if (!ACTIVE_ROOT_STATUSES.has(root.status ?? "")) {
    projectNote = `Root issue status is ${root.status ?? "unknown"}; completing it is not actionable right now.`;
  }

  const candidates: UnblockCandidate[] = list.map((dep) =>
    judgeCandidate(dep, root, explain, records.get(dep.id), projectNote, now),
  );
  return {
    rootId: root.id,
    rootStatus: root.status,
    projectCycleCount: cycleCount,
    candidates,
    omitted,
    missing,
    ...(projectNote ? { projectNote } : {}),
  };
}

function judgeCandidate(
  dep: RootDependent,
  root: BeadsIssue,
  explain: ReadyExplain | null,
  record: BeadsIssue | undefined,
  projectNote: string | undefined,
  now: number,
): UnblockCandidate {
  const base = { id: dep.id, title: dep.title ?? record?.title, status: dep.status ?? record?.status };
  if (projectNote) return { ...base, verdict: "verify", reason: projectNote };
  if (!record) {
    return { ...base, verdict: "verify", reason: "Full issue record could not be loaded." };
  }
  if (explain === null) {
    return { ...base, verdict: "verify", reason: "bd ready --explain is unavailable; verify manually." };
  }

  const blockedItem = explain.blocked?.find((item) => item.id === dep.id);
  const isReady = explain.ready?.some((item) => item.id === dep.id);
  if (blockedItem && isReady) {
    // A candidate in both lists means the snapshots disagree; never estimate.
    return { ...base, verdict: "verify", reason: "bd ready --explain reports this issue as both ready and blocked." };
  }
  if (!blockedItem) {
    if (isReady) {
      return { ...base, verdict: "not-likely", reason: "Already ready — completing this issue adds nothing." };
    }
    if (record.status !== "open") {
      return { ...base, verdict: "not-likely", reason: `Already ${record.status} — not open work.` };
    }
    return { ...base, verdict: "verify", reason: "Not reported as blocked by bd ready --explain." };
  }

  const blockers = blockedItem.blocked_by ?? [];
  const count = blockedItem.blocked_by_count;
  if (count === undefined || blockers.length === 0) {
    return { ...base, verdict: "verify", reason: "Blocker details are missing from bd ready --explain." };
  }
  const others = blockers.filter((blocker) => blocker.id !== root.id);
  const rootBlocker = blockers.find((blocker) => blocker.id === root.id);
  if (!rootBlocker) {
    if (others.length === 0) {
      return { ...base, verdict: "verify", reason: "Blocked per bd ready --explain, but no blocker is listed." };
    }
    return {
      ...base,
      verdict: "not-likely",
      reason: `Still blocked by ${listBlockers(others)}${count > others.length ? ` and ${count - others.length} more` : ""}.`,
      remainingBlockers: others,
    };
  }
  if (count !== blockers.length) {
    return { ...base, verdict: "verify", reason: "bd ready --explain blocker details are inconsistent." };
  }
  // The explain snapshot must agree with the loaded root record about the
  // root's own status; a flip between the two cached calls means stale data.
  if (rootBlocker.status !== undefined && rootBlocker.status !== root.status) {
    return { ...base, verdict: "verify", reason: `Root status is ${root.status ?? "unknown"} in its record but ${rootBlocker.status} in the readiness snapshot.` };
  }
  if (count > 1) {
    return { ...base, verdict: "not-likely", reason: `Also blocked by ${listBlockers(others)}.`, remainingBlockers: others };
  }
  return { ...base, ...positiveChecks(record, root, now) };
}

/** The positive path: every safe criterion must hold or the verdict is not positive. */
function positiveChecks(record: BeadsIssue, root: BeadsIssue, now: number): Pick<UnblockCandidate, "verdict" | "reason"> {
  if (record.status !== "open") {
    return { verdict: "not-likely", reason: `Already ${record.status} — not open work.` };
  }
  if (record.pinned || record.is_template || record.ephemeral || record.no_history) {
    return { verdict: "verify", reason: "Issue is pinned, a template, or ephemeral — not ordinary work." };
  }
  if (record.issue_type && !ORDINARY_WORK_TYPES.has(record.issue_type)) {
    return { verdict: "verify", reason: `Issue type ${record.issue_type} is not ordinary work.` };
  }
  const deferUntil = record.defer_until;
  if (typeof deferUntil === "string" && deferUntil !== "") {
    const when = new Date(deferUntil).getTime();
    if (!Number.isFinite(when)) {
      return { verdict: "verify", reason: "defer_until is not a valid timestamp." };
    }
    if (when > now) {
      return { verdict: "not-likely", reason: `Deferred until ${deferUntil}.` };
    }
  }

  const depLinks = issueLinks(record, "dependencies");
  const count = record.dependency_count;
  if (count === undefined) {
    return { verdict: "verify", reason: "Dependency counts are missing from the candidate record." };
  }
  if (depLinks.length < count) {
    return { verdict: "verify", reason: `Only ${depLinks.length} of ${count} dependencies were loaded.` };
  }
  if (depLinks.length > count) {
    return { verdict: "verify", reason: "Dependency count disagrees with the loaded dependencies." };
  }

  const rootEdge = depLinks.find((link) => link.id === root.id);
  if (!rootEdge) {
    return { verdict: "verify", reason: "The root's blocking edge is not visible from the candidate record." };
  }
  if (rootEdge.type !== "blocks") {
    return { verdict: "verify", reason: `Root relationship type is ${rootEdge.type}, not blocks.` };
  }

  for (const link of depLinks) {
    if (link.id === root.id) continue;
    if (link.type === "blocks") {
      if (link.status !== "closed" && link.status !== "pinned") {
        return { verdict: "verify", reason: `Another blocks dependency (${link.id}) is ${link.status ?? "unknown status"}.` };
      }
      continue;
    }
    if (PURE_ASSOCIATION_TYPES.has(link.type)) continue;
    if (link.type === "parent-child") {
      return { verdict: "verify", reason: `Parent/child relationship to ${link.id} needs verification.` };
    }
    return { verdict: "verify", reason: `Relationship type ${link.type} needs verification.` };
  }
  return { verdict: "likely", reason: "Likely ready after completion." };
}

function listBlockers(blockers: ExplainBlocker[]): string {
  return blockers
    .map((blocker) => {
      const id = blocker.id ?? "unknown id";
      if (blocker.title && blocker.status) return `${id} (${blocker.title}, ${blocker.status})`;
      if (blocker.title) return `${id} (${blocker.title})`;
      if (blocker.status) return `${id} (${blocker.status})`;
      return id;
    })
    .join(", ");
}
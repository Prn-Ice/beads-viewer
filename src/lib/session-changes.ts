import type { BeadsIssue } from "./types";

export interface ObservedSession {
  startedAt: number;
  baseline: Map<string, BeadsIssue>;
  latest: Map<string, BeadsIssue>;
  created: Set<string>;
}

export function observeSession(session: ObservedSession | undefined, issues: BeadsIssue[], now: number): ObservedSession {
  if (!session) {
    const baseline = new Map(issues.map((issue) => [issue.id, issue]));
    return { startedAt: now, baseline, latest: new Map(baseline), created: new Set() };
  }
  const baseline = new Map(session.baseline);
  const latest = new Map(session.latest);
  const created = new Set(session.created);
  for (const issue of issues) {
    if (!baseline.has(issue.id) && !created.has(issue.id)) {
      const createdAt = Date.parse(issue.created_at ?? "");
      // First seeing an old issue in All scope is not a creation event.
      if (createdAt >= session.startedAt && createdAt <= now) created.add(issue.id);
      else baseline.set(issue.id, issue);
    }
    latest.set(issue.id, issue);
  }
  // Keep last observations of absent issues. Open scope omissions and failed
  // requests are not evidence of closure or deletion.
  return { ...session, baseline, latest, created };
}

export function sessionChanges(session: ObservedSession | undefined) {
  if (!session) return [];
  const changes: { issue: BeadsIssue; reasons: string[] }[] = [];
  for (const issue of session.latest.values()) {
    const reasons: string[] = [];
    const before = session.baseline.get(issue.id);
    if (session.created.has(issue.id)) {
      reasons.push("Created during this session");
      if (issue.status === "closed") reasons.push("Closed");
    } else if (before) {
      if (before.status !== issue.status) {
        reasons.push(issue.status === "closed" ? "Closed" : before.status === "closed" ? "Reopened" : `Status: ${before.status} -> ${issue.status}`);
      }
      for (const [key, label] of [["title", "Title"], ["priority", "Priority"], ["assignee", "Assignee"], ["issue_type", "Type"]] as const) {
        if ((before[key] ?? "") !== (issue[key] ?? "")) reasons.push(`${label} changed`);
      }
      const beforeLabels = [...new Set(before.labels ?? [])].sort();
      const afterLabels = [...new Set(issue.labels ?? [])].sort();
      if (JSON.stringify(beforeLabels) !== JSON.stringify(afterLabels)) reasons.push("Labels changed");
    }
    if (reasons.length) changes.push({ issue, reasons });
  }
  return changes.sort((a, b) => a.issue.id.localeCompare(b.issue.id));
}

export function resetSession(session: ObservedSession, now: number): ObservedSession {
  return { startedAt: now, baseline: new Map(session.latest), latest: new Map(session.latest), created: new Set() };
}

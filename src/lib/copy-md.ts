import type { BeadsIssue, DependencyRef } from "./types";

function depId(dep: DependencyRef, index: number): string {
  return dep.id ?? dep.issue_id ?? dep.depends_on_id ?? `dep-${index}`;
}

function formatDependency(dep: DependencyRef, index: number): string {
  const id = depId(dep, index);
  const title = dep.title ? ` — ${dep.title}` : "";
  const detail = [dep.status, dep.dependency_type ?? dep.type].filter(Boolean).join(", ");
  const suffix = detail ? ` (${detail})` : "";
  return `- \`${id}\`${title}${suffix}`;
}

function depLines(items: DependencyRef[], startIndex: number): string[] {
  return items.map((dep, i) => formatDependency(dep, startIndex + i));
}

/**
 * Render an issue as self-contained Markdown for agent handoffs and PR
 * discussions. Copies only the already-loaded snapshot; absent sections are
 * omitted and comments are intentionally excluded.
 */
export function issueToMarkdown(issue: BeadsIssue, projectPath: string): string {
  const blocks: string[] = [];

  blocks.push(`# ${issue.id} · ${issue.title}`);

  const meta: string[] = [];
  meta.push(`**Project**: \`${projectPath}\``);
  meta.push(`**Status**: ${issue.status}`);
  if (issue.priority !== undefined) meta.push(`**Priority**: P${issue.priority}`);
  if (issue.issue_type) meta.push(`**Type**: ${issue.issue_type}`);
  if (issue.assignee) meta.push(`**Assignee**: ${issue.assignee}`);
  if (issue.labels && issue.labels.length > 0) meta.push(`**Labels**: ${issue.labels.join(", ")}`);
  blocks.push(meta.join("\n\n"));

  if (issue.description) {
    blocks.push(`## Description\n\n${issue.description}`);
  }
  if (issue.acceptance_criteria) {
    blocks.push(`## Acceptance Criteria\n\n${issue.acceptance_criteria}`);
  }
  if (issue.notes) {
    blocks.push(`## Notes\n\n${issue.notes}`);
  }

  const dependencies = issue.dependencies ?? [];
  const dependents = issue.dependents ?? [];
  if (dependencies.length > 0 || dependents.length > 0) {
    const depBlocks: string[] = ["## Dependencies"];
    if (dependencies.length > 0) {
      depBlocks.push(`### Depends on\n\n${depLines(dependencies, 0).join("\n")}`);
    }
    if (dependents.length > 0) {
      depBlocks.push(`### Required by\n\n${depLines(dependents, dependencies.length).join("\n")}`);
    }
    blocks.push(depBlocks.join("\n\n"));
  }

  blocks.push(`> Comments are not included in this copy.`);

  return blocks.join("\n\n") + "\n";
}

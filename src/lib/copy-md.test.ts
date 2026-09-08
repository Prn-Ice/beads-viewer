import { describe, expect, it } from "vitest";
import { issueToMarkdown } from "./copy-md";
import type { BeadsIssue } from "./types";

function issue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "alpha-1",
    title: "Fix crash on startup",
    status: "in_progress",
    priority: 0,
    issue_type: "bug",
    assignee: "dev-a",
    labels: ["critical"],
    dependency_count: 1,
    dependent_count: 0,
    comment_count: 2,
    ...overrides,
  };
}

describe("issueToMarkdown", () => {
  it("copies hydrated bd show relationship types", () => {
    const md = issueToMarkdown(issue({ dependencies: [{ id: "alpha-0", dependency_type: "blocks" }] }), "/proj");
    expect(md).toContain("`alpha-0` (blocks)");
  });
  it("includes unambiguous project and issue identity", () => {
    const md = issueToMarkdown(issue(), "/home/u/proj");
    expect(md).toContain("# alpha-1 · Fix crash on startup");
    expect(md).toContain("**Project**: `/home/u/proj`");
  });

  it("preserves Markdown in body sections", () => {
    const md = issueToMarkdown(
      issue({
        description: "The app **crashes** when launched.\n\n- Step 1\n- Step 2",
        acceptance_criteria: "App starts without a config file",
        notes: "Related to the refactor",
      }),
      "/proj",
    );
    expect(md).toContain("## Description\n\nThe app **crashes** when launched.\n\n- Step 1\n- Step 2");
    expect(md).toContain("## Acceptance Criteria\n\nApp starts without a config file");
    expect(md).toContain("## Notes\n\nRelated to the refactor");
  });

  it("omits absent sections cleanly", () => {
    const md = issueToMarkdown(issue({ description: undefined, acceptance_criteria: undefined, notes: undefined }), "/proj");
    expect(md).not.toContain("## Description");
    expect(md).not.toContain("## Acceptance Criteria");
    expect(md).not.toContain("## Notes");
  });

  it("does not include priority/type/assignee/labels when absent", () => {
    const md = issueToMarkdown(
      issue({ priority: undefined, issue_type: undefined, assignee: undefined, labels: undefined }),
      "/proj",
    );
    expect(md).not.toContain("**Priority**");
    expect(md).not.toContain("**Type**");
    expect(md).not.toContain("**Assignee**");
    expect(md).not.toContain("**Labels**");
  });

  it("includes typed dependency references when available", () => {
    const md = issueToMarkdown(
      issue({
        dependencies: [
          { id: "alpha-0", title: "Stabilize the 1.0 release", status: "open", type: "parent-child" },
        ],
      }),
      "/proj",
    );
    expect(md).toContain("## Dependencies");
    expect(md).toContain("### Depends on");
    expect(md).toContain("`alpha-0` — Stabilize the 1.0 release (open, parent-child)");
  });

  it("lists dependents under Required by", () => {
    const md = issueToMarkdown(
      issue({
        dependencies: [],
        dependents: [{ id: "alpha-2", title: "Add export feature", status: "blocked", type: "child-parent" }],
      }),
      "/proj",
    );
    expect(md).toContain("### Required by");
    expect(md).toContain("`alpha-2` — Add export feature (blocked, child-parent)");
  });

  it("omits the dependencies section entirely when none exist", () => {
    const md = issueToMarkdown(issue({ dependencies: [], dependents: [] }), "/proj");
    expect(md).not.toContain("## Dependencies");
  });

  it("makes comment exclusion explicit", () => {
    const md = issueToMarkdown(issue(), "/proj");
    expect(md).toContain("> Comments are not included in this copy.");
    expect(md).not.toMatch(/c1|c2|Reproduced|Fix merged/);
  });
});

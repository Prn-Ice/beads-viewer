import { describe, expect, it } from "vitest";
import {
  applyFilters,
  applyViewToParams,
  countActiveFilters,
  facetChoices,
  matchesFilters,
  parseViewState,
  type FilterState,
  type ViewState,
} from "./filters";
import type { BeadsIssue } from "./types";

function issue(overrides: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id: "a-1",
    title: "Issue",
    status: "open",
    priority: 2,
    issue_type: "task",
    assignee: "dev-a",
    labels: ["docs"],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

function view(overrides: Partial<ViewState> = {}): ViewState {
  return {
    search: "",
    scope: "open",
    filters: { priorities: [], types: [], labels: [], assignees: [], unassigned: false },
    ...overrides,
  };
}

const ISSUES = [
  issue({ id: "a-1", title: "Fix crash on startup", priority: 0, issue_type: "bug", assignee: "dev-a", labels: ["critical"] }),
  issue({ id: "a-2", priority: 1, issue_type: "feature", assignee: "dev-b", labels: [] }),
  issue({ id: "a-3", priority: 2, issue_type: "chore", assignee: undefined, labels: ["docs"] }),
  issue({ id: "a-4", priority: 3, issue_type: "task", assignee: undefined, labels: [] }),
];

describe("parseViewState", () => {
  it("returns defaults for an empty URL", () => {
    expect(parseViewState(new URLSearchParams(""))).toEqual({
      search: "",
      scope: "open",
      filters: { priorities: [], types: [], labels: [], assignees: [], unassigned: false },
    });
  });

  it("reads search and scope, omitting the default scope", () => {
    expect(parseViewState(new URLSearchParams("q=crash&scope=all")).scope).toBe("all");
    expect(parseViewState(new URLSearchParams("q=crash")).scope).toBe("open");
  });

  it("ignores an unknown scope value", () => {
    expect(parseViewState(new URLSearchParams("scope=closed")).scope).toBe("open");
  });

  it("reads repeated facets", () => {
    const state = parseViewState(
      new URLSearchParams("priority=0&priority=1&type=bug&label=a&label=b&assignee=x&unassigned=1"),
    );
    expect(state.filters).toEqual({
      priorities: [0, 1],
      types: ["bug"],
      labels: ["a", "b"],
      assignees: ["x"],
      unassigned: true,
    });
  });

  it("ignores invalid priorities and empty tokens", () => {
    const state = parseViewState(
      new URLSearchParams("priority=9&priority=abc&priority=&priority=+&priority=0x0&priority=1.5&priority=2&label=&assignee=&type="),
    );
    expect(state.filters.priorities).toEqual([2]);
    expect(state.filters.labels).toEqual([]);
    expect(state.filters.assignees).toEqual([]);
    expect(state.filters.types).toEqual([]);
  });

  it("treats only unassigned=1 as enabled", () => {
    expect(parseViewState(new URLSearchParams("unassigned=true")).filters.unassigned).toBe(false);
    expect(parseViewState(new URLSearchParams("unassigned=1")).filters.unassigned).toBe(true);
  });

  it("dedupes repeated identical values", () => {
    expect(parseViewState(new URLSearchParams("label=a&label=a")).filters.labels).toEqual(["a"]);
  });
});

describe("applyViewToParams", () => {
  it("preserves unrelated params and omits defaults", () => {
    const next = applyViewToParams(
      new URLSearchParams("project=%2Fp&theme=forest"),
      view({ search: "", scope: "open" }),
    );
    expect(next.toString()).toBe("project=%2Fp&theme=forest");
  });

  it("writes search, scope, and facets as repeated params", () => {
    const next = applyViewToParams(
      new URLSearchParams(""),
      view({
        search: "export",
        scope: "all",
        filters: { priorities: [0, 3], types: ["bug"], labels: ["a", "b"], assignees: ["dev-a"], unassigned: true },
      }),
    );
    const params = new URLSearchParams(next.toString());
    expect(params.get("q")).toBe("export");
    expect(params.get("scope")).toBe("all");
    expect(params.getAll("priority")).toEqual(["0", "3"]);
    expect(params.getAll("label")).toEqual(["a", "b"]);
    expect(params.get("assignee")).toBe("dev-a");
    expect(params.get("unassigned")).toBe("1");
  });

  it("removes stale facet params when a facet empties", () => {
    const next = applyViewToParams(
      new URLSearchParams("q=x&scope=all&priority=1&label=a"),
      view({ search: "x", scope: "all" }),
    );
    expect(next.toString()).toBe("q=x&scope=all");
  });

  it("round-trips through parseViewState", () => {
    const original = view({
      search: "some query",
      scope: "all",
      filters: { priorities: [0, 4], types: ["bug"], labels: ["a b", "c&d"], assignees: ["dev-a"], unassigned: true },
    });
    const params = applyViewToParams(new URLSearchParams(""), original);
    expect(parseViewState(params)).toEqual(original);
  });
});

describe("matchesFilters", () => {
  it("passes everything with no filters", () => {
    expect(ISSUES.every((i) => matchesFilters(i, { priorities: [], types: [], labels: [], assignees: [], unassigned: false }))).toBe(true);
  });

  it("ORs within a facet", () => {
    const filters: FilterState = { priorities: [0, 1], types: [], labels: [], assignees: [], unassigned: false };
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual(["a-1", "a-2"]);
  });

  it("ANDs across facets", () => {
    const filters: FilterState = { priorities: [0], types: ["bug"], labels: [], assignees: [], unassigned: false };
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual(["a-1"]);
  });

  it("matches any selected label", () => {
    const filters: FilterState = { priorities: [], types: [], labels: ["docs", "critical"], assignees: [], unassigned: false };
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual(["a-1", "a-3"]);
  });

  it("treats unassigned as OR within the assignee facet", () => {
    const filters: FilterState = { priorities: [], types: [], labels: [], assignees: ["dev-a"], unassigned: true };
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual(["a-1", "a-3", "a-4"]);
  });

  it("matches only unassigned when no names are selected", () => {
    const filters: FilterState = { priorities: [], types: [], labels: [], assignees: [], unassigned: true };
    expect(ISSUES.filter((i) => matchesFilters(i, filters)).map((i) => i.id)).toEqual(["a-3", "a-4"]);
  });

  it("does not match issues without a priority when priorities are selected", () => {
    const filters: FilterState = { priorities: [1], types: [], labels: [], assignees: [], unassigned: false };
    expect(matchesFilters(issue({ priority: undefined }), filters)).toBe(false);
  });
});

describe("applyFilters", () => {
  it("composes search with facets", () => {
    const state = view({
      search: "crash",
      filters: { priorities: [0], types: [], labels: [], assignees: [], unassigned: false },
    });
    expect(applyFilters(ISSUES, state).map((i) => i.id)).toEqual(["a-1"]);
  });

  it("matches search against id, title, and labels", () => {
    expect(applyFilters(ISSUES, view({ search: "a-3" })).map((i) => i.id)).toEqual(["a-3"]);
    expect(applyFilters(ISSUES, view({ search: "docs" })).map((i) => i.id)).toEqual(["a-3"]);
  });

  it("returns everything unchanged with an empty view", () => {
    expect(applyFilters(ISSUES, view())).toEqual(ISSUES);
  });
});

describe("facetChoices", () => {
  it("derives choices from the unfiltered issue set, sorted", () => {
    const choices = facetChoices(ISSUES, { priorities: [], types: [], labels: [], assignees: [], unassigned: false });
    expect(choices).toEqual({
      types: ["bug", "chore", "feature", "task"],
      labels: ["critical", "docs"],
      assignees: ["dev-a", "dev-b"],
    });
  });

  it("keeps selected tokens that no current issue carries", () => {
    const filters: FilterState = { priorities: [], types: ["epic"], labels: ["ghost"], assignees: ["retired"], unassigned: true };
    const choices = facetChoices(ISSUES, filters);
    expect(choices.types).toContain("epic");
    expect(choices.labels).toContain("ghost");
    expect(choices.assignees).toContain("retired");
  });
});

describe("countActiveFilters", () => {
  it("counts each selected token and unassigned", () => {
    expect(countActiveFilters({ priorities: [0, 1], types: [], labels: ["docs"], assignees: [], unassigned: true })).toBe(4);
    expect(countActiveFilters({ priorities: [], types: [], labels: [], assignees: [], unassigned: false })).toBe(0);
  });
});

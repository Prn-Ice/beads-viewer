import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";

const alphaPath = path.resolve(__dirname, "../fixtures/projects/alpha");

function makeIssue(overrides: Partial<BeadsIssue>): BeadsIssue {
  return {
    id: "weird-1",
    title: "Weird issue",
    status: "open",
    priority: 4,
    issue_type: "epic",
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

async function stubIssues(page: import("@playwright/test").Page, issues: BeadsIssue[], scope = "open") {
  await page.route(`**/api/projects/*/issues?scope=${scope}`, async (route) => {
    const body: IssueListResponse = { issues, readyIds: issues.map((i) => i.id), childCounts: {} };
    await route.fulfill({ json: body });
  });
}

async function openFilters(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: /^Filters/ }).click();
  const dialog = page.getByRole("dialog", { name: "Filters" });
  await expect(dialog).toBeVisible();
  return dialog;
}

function card(page: import("@playwright/test").Page, name: string | RegExp) {
  // Inspect the filtered board behind the modal; it is intentionally inert.
  return page.getByRole("region", { name: "Issue board", exact: true, includeHidden: true })
    .getByRole("button", { name, includeHidden: true });
}

test.describe("issue filters", () => {
  test("Back and Forward restore checkbox selections while filters stay open", async ({ page }) => {
    await page.goto("/");
    const dialog = await openFilters(page);
    await dialog.getByRole("checkbox", { name: "P0", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "P1", exact: true }).check();
    await page.goBack();
    await expect(dialog.getByRole("checkbox", { name: "P0", exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "P1", exact: true })).not.toBeChecked();
    await page.goForward();
    await expect(dialog.getByRole("checkbox", { name: "P1", exact: true })).toBeChecked();
    await page.keyboard.press("Escape");
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toBeVisible();
  });
  test("priority filter ORs within the facet and updates the URL", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const dialog = await openFilters(page);

    await dialog.getByRole("checkbox", { name: "P1", exact: true }).check();
    await expect(card(page, /Add export feature/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);

    await dialog.getByRole("checkbox", { name: "P3", exact: true }).check();
    await expect(card(page, /Migrate database/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toBeVisible();
    await expect(card(page, /Write release notes/)).toHaveCount(0);

    expect(new URL(page.url()).searchParams.getAll("priority")).toEqual(["1", "3"]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    // The board stays filtered after closing the dialog.
    await expect(card(page, /Add export feature/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
  });

  test("filters AND across facets, compose with search, and never call the detail API", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    let detailCalls = 0;
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (/\/issues\/[^/]+$/.test(pathname)) detailCalls++;
    });
    await page.goto("/");
    const dialog = await openFilters(page);

    await dialog.getByRole("checkbox", { name: "bug", exact: true }).check();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toHaveCount(0);

    // AND across facets: bug AND P0 is still the same single issue.
    await dialog.getByRole("checkbox", { name: "P0", exact: true }).check();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Migrate database/)).toHaveCount(0);

    // Composes with search: narrowing further.
    await page.keyboard.press("Escape");
    await page.getByRole("searchbox", { name: "Search issues" }).fill("crash");
    await expect(card(page, /Fix crash on startup/)).toBeVisible();

    await page.getByRole("searchbox", { name: "Search issues" }).fill("export");
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
    await expect(card(page, /Add export feature/)).toHaveCount(0);

    expect(detailCalls).toBe(0);
  });

  test("filters compose with Open/All scope and both board views", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const dialog = await openFilters(page);

    await dialog.getByRole("checkbox", { name: "task", exact: true }).check();
    await expect(card(page, /Migrate database/)).toBeVisible();
    await expect(card(page, /Retire legacy endpoint/)).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(card(page, /Retire legacy endpoint/)).toBeVisible();
    await expect(card(page, /Migrate database/)).toBeVisible();

    // List view shows the same filtered rows.
    await page.getByRole("button", { name: "List", exact: true }).click();
    const list = page.getByRole("region", { name: "Issue list" });
    await expect(list.getByRole("button", { name: "Migrate database", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Retire legacy endpoint", exact: true })).toBeVisible();
    await expect(list.getByRole("button", { name: "Fix crash on startup", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(card(page, /Migrate database/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
  });

  test("unassigned matches issues without an assignee and ORs with names", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const dialog = await openFilters(page);

    await dialog.getByRole("checkbox", { name: "Unassigned", exact: true }).check();
    await expect(card(page, /Migrate database/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
    await expect(card(page, /Add export feature/)).toHaveCount(0);

    await dialog.getByRole("checkbox", { name: "dev-a", exact: true }).check();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Migrate database/)).toBeVisible();

    const params = new URL(page.url()).searchParams;
    expect(params.get("assignee")).toBe("dev-a");
    expect(params.get("unassigned")).toBe("1");

    // Reload restores the same filters and checked options.
    await page.reload();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Migrate database/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toHaveCount(0);
    const reopened = await openFilters(page);
    await expect(reopened.getByRole("checkbox", { name: "dev-a", exact: true })).toBeChecked();
    await expect(reopened.getByRole("checkbox", { name: "Unassigned", exact: true })).toBeChecked();
  });

  test("selected options with no current results stay in the facet list", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // Tokens that exist nowhere in the unfiltered issue set.
    await page.goto("/?label=ghost&assignee=retired");
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);

    const dialog = await openFilters(page);
    await expect(dialog.getByRole("checkbox", { name: "ghost", exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "retired", exact: true })).toBeChecked();
    // Unfiltered choices are still present alongside the selected tokens.
    await expect(dialog.getByRole("checkbox", { name: "critical", exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "dev-a", exact: true })).toBeVisible();

    // An unavailable token may disappear once it is no longer selected.
    await dialog.getByRole("checkbox", { name: "ghost", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "ghost", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("checkbox", { name: "retired", exact: true })).toBeChecked();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);

    // A combination with no current results keeps both selected options checked.
    await dialog.getByRole("checkbox", { name: "docs", exact: true }).check();
    await expect(dialog.getByRole("checkbox", { name: "docs", exact: true })).toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "retired", exact: true })).toBeChecked();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);

    // Removing the last constraint surfaces the docs issue again.
    await dialog.getByRole("checkbox", { name: "retired", exact: true }).click();
    await expect(dialog.getByRole("checkbox", { name: "retired", exact: true })).toHaveCount(0);
    await expect(card(page, /Write release notes/)).toBeVisible();
  });

  test("URL escaping round-trips weird labels and assignees through reload", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const weird = makeIssue({
      id: "weird-1",
      title: "Weird issue",
      labels: ["a b/c&d"],
      assignee: "dev@x y",
      issue_type: "epic",
    });
    await stubIssues(page, [weird, makeIssue({ id: "plain-1", title: "Plain issue", labels: ["docs"] })]);
    await page.goto("/");

    const dialog = await openFilters(page);
    await dialog.getByRole("checkbox", { name: "a b/c&d", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "dev@x y", exact: true }).check();

    const url = new URL(page.url());
    expect(url.searchParams.getAll("label")).toEqual(["a b/c&d"]);
    expect(url.searchParams.get("assignee")).toBe("dev@x y");

    await page.reload();
    await expect(card(page, /Weird issue/)).toBeVisible();
    await expect(card(page, /Plain issue/)).toHaveCount(0);
    const reopened = await openFilters(page);
    await expect(reopened.getByRole("checkbox", { name: "a b/c&d", exact: true })).toBeChecked();
    await expect(reopened.getByRole("checkbox", { name: "dev@x y", exact: true })).toBeChecked();
  });

  test("preserves unrelated params and the hash; reload restores the view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?filter=keep#notes");
    const dialog = await openFilters(page);
    await dialog.getByRole("checkbox", { name: "critical", exact: true }).check();

    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toHaveCount(0);

    const url = new URL(page.url());
    expect(url.searchParams.get("filter")).toBe("keep");
    expect(url.searchParams.getAll("label")).toEqual(["critical"]);
    expect(url.hash).toBe("#notes");

    await page.reload();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toHaveCount(0);
    expect(new URL(page.url()).hash).toBe("#notes");
    const reopened = await openFilters(page);
    await expect(reopened.getByRole("checkbox", { name: "critical", exact: true })).toBeChecked();
  });

  test("search typing pushes one history entry per edit; Back/Forward restore it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search issues" });
    await search.focus();
    await search.pressSequentially("exp");
    await expect(card(page, /Add export feature/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("q")).toBe("exp");

    // One Back undoes the whole edit session, not a single keystroke.
    await page.goBack();
    await expect(search).toHaveValue("");
    await expect(card(page, /Fix crash on startup/)).toBeVisible();

    await page.goForward();
    await expect(search).toHaveValue("exp");
    await expect(card(page, /Add export feature/)).toBeVisible();
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);
  });

  test("opening and closing an issue preserves filters, params, and hash", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?filter=keep#notes");
    await page.getByRole("searchbox", { name: "Search issues" }).fill("crash");
    await expect(card(page, /Fix crash on startup/)).toBeVisible();

    await card(page, /Fix crash on startup/).click();
    const drawer = page.getByRole("dialog", { name: "Fix crash on startup" });
    await expect(drawer).toBeVisible();
    let url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe("crash");
    expect(url.searchParams.get("issue")).toBe("alpha-1");
    expect(url.searchParams.get("project")).toBe(alphaPath);
    expect(url.searchParams.get("filter")).toBe("keep");
    expect(url.hash).toBe("#notes");

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Fix crash on startup" })).toHaveCount(0);
    url = new URL(page.url());
    expect(url.searchParams.get("q")).toBe("crash");
    expect(url.searchParams.get("issue")).toBeNull();
    expect(url.searchParams.get("project")).toBe(alphaPath);
    expect(url.searchParams.get("filter")).toBe("keep");
    expect(url.hash).toBe("#notes");
  });

  test("invalid priority and scope values are ignored", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?priority=9&scope=closed");
    // Scope falls back to open: closed issues are hidden.
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Retire legacy endpoint/)).toHaveCount(0);

    const dialog = await openFilters(page);
    for (const label of ["P0", "P1", "P2", "P3", "P4"]) {
      await expect(dialog.getByRole("checkbox", { name: label, exact: true })).not.toBeChecked();
    }
  });

  test("keyboard opens the dialog, toggles a checkbox, and Escape returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /^Filters/, includeHidden: true });
    await trigger.focus();
    await trigger.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await expect(dialog).toBeVisible();

    const p1 = dialog.getByRole("checkbox", { name: "P1", exact: true });
    await p1.focus();
    await p1.press("Space");
    await expect(p1).toBeChecked();
    await expect(card(page, /Add export feature/)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    // The board stays filtered after keyboard-only interaction.
    await expect(card(page, /Add export feature/)).toBeVisible();
  });

  test("active count badge and Clear filters reset the facets", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /^Filters/, includeHidden: true });
    await expect(trigger).toHaveAttribute("aria-label", "Filters");

    const dialog = await openFilters(page);
    await dialog.getByRole("checkbox", { name: "P1", exact: true }).check();
    await expect(trigger).toHaveAttribute("aria-label", "Filters (1 active)");
    await dialog.getByRole("checkbox", { name: "docs", exact: true }).check();
    await expect(trigger).toHaveAttribute("aria-label", "Filters (2 active)");
    await expect(card(page, /Add export feature/)).toHaveCount(0);
    await expect(card(page, /Write release notes/)).toHaveCount(0);
    await expect(card(page, /Fix crash on startup/)).toHaveCount(0);

    await dialog.getByRole("button", { name: "Clear filters" }).click();
    await expect(trigger).toHaveAttribute("aria-label", "Filters");
    await expect(dialog.getByRole("checkbox", { name: "P1", exact: true })).not.toBeChecked();
    await expect(dialog.getByRole("checkbox", { name: "docs", exact: true })).not.toBeChecked();
    const params = new URL(page.url()).searchParams;
    expect(params.getAll("priority")).toEqual([]);
    expect(params.getAll("label")).toEqual([]);
    // Search and scope are untouched by Clear filters.
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
  });

  test("mobile opens a full-width scrolling dialog and works with the keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 667 });
    await page.goto("/");
    const trigger = page.getByRole("button", { name: /^Filters/, includeHidden: true });
    await expect(trigger).toBeInViewport({ ratio: 1 });
    // The sheet body only overflows once facet choices arrive with the board.
    await expect(card(page, /Fix crash on startup/)).toBeVisible();

    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Filters" });
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(389);

    // The dialog body scrolls internally; the page itself never scrolls.
    const scroller = dialog.locator(".overflow-y-auto");
    expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(667);

    await dialog.getByRole("checkbox", { name: "P0", exact: true }).check();
    expect(new URL(page.url()).searchParams.getAll("priority")).toEqual(["0"]);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Filters" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(card(page, /Fix crash on startup/)).toBeVisible();
    await expect(card(page, /Add export feature/)).toHaveCount(0);
  });
});

for (const width of [1280, 390]) {
  test(`filters sheet renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const dialog = await openFilters(page);
    await dialog.getByRole("checkbox", { name: "P0", exact: true }).check();
    await dialog.getByRole("checkbox", { name: "critical", exact: true }).check();
    await expect(dialog.getByRole("checkbox", { name: "critical", exact: true })).toBeChecked();
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: `docs/screenshots/filters-${width}.png`, animations: "disabled" });
    }
  });
}

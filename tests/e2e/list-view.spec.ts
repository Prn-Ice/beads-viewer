import { expect, test } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";
import fixture from "../fixtures/beads-data.json";

function makeIssue(overrides: Partial<BeadsIssue>): BeadsIssue {
  return {
    id: "a1",
    title: "Alpha issue",
    status: "open",
    priority: 2,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

// Distinct values across every column so each sort has a known, unambiguous order.
function sortableIssues(): BeadsIssue[] {
  return [
    makeIssue({ id: "a1", title: "Alpha", priority: 0, status: "blocked", issue_type: "bug", assignee: "zed", created_at: "2026-01-01T00:00:00Z" }),
    makeIssue({ id: "b2", title: "Bravo", priority: 2, status: "open", issue_type: "feature", assignee: "ada", created_at: "2026-03-01T00:00:00Z" }),
    makeIssue({ id: "c3", title: "Charlie", priority: 1, status: "in_progress", issue_type: "chore", assignee: "bob", created_at: "2026-02-01T00:00:00Z" }),
  ];
}

async function stubIssues(page: import("@playwright/test").Page, issues: BeadsIssue[], scope = "open") {
  await page.route(`**/api/projects/*/issues?scope=${scope}`, async (route) => {
    const body: IssueListResponse = { issues, readyIds: issues.map((i) => i.id) };
    await route.fulfill({ json: body });
  });
}

function listRegion(page: import("@playwright/test").Page) {
  return page.getByRole("region", { name: "Issue list", exact: true });
}

function mobileListRegion(page: import("@playwright/test").Page) {
  return listRegion(page);
}

function columnHeader(page: import("@playwright/test").Page, name: string) {
  return listRegion(page).getByRole("columnheader", { name, exact: true });
}

async function rowIds(page: import("@playwright/test").Page): Promise<string[]> {
  const rows = listRegion(page).locator("tbody tr");
  return rows.evaluateAll((trs) =>
    trs.map((tr) => (tr.querySelector("td") as HTMLElement).textContent ?? ""),
  );
}

// Mobile renders title-first rows; the first span of each row button is the title.
async function mobileTitles(page: import("@playwright/test").Page): Promise<string[]> {
  return mobileListRegion(page)
    .locator("li button")
    .evaluateAll((btns) =>
      btns.map((b) => (b.querySelector("span") as HTMLElement).textContent ?? ""),
    );
}

async function openListView(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(listRegion(page)).toBeVisible();
}

test.describe("list view", () => {
  for (const width of [1280, 390]) {
    test(`long lists scroll inside the viewport at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await stubIssues(page, Array.from({ length: 100 }, (_, i) =>
        makeIssue({ id: `issue-${String(i).padStart(3, "0")}`, title: `Issue ${i}` }),
      ));
      await page.goto("/");
      await openListView(page);
      const scroller = width >= 768 ? listRegion(page) : mobileListRegion(page);
      expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await expect(scroller.getByRole("button", { name: /Issue 99/ })).toBeInViewport();
      await expect(page.getByRole("searchbox")).toBeInViewport();
      if (width >= 768) {
        await expect(columnHeader(page, "ID")).toBeInViewport();
      } else {
        await expect(page.getByRole("combobox", { name: "Sort issues by" })).toBeInViewport();
        // Mobile rows wrap, so the page itself never scrolls horizontally.
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      }
    });
  }
  test("toggles between board and list, keeping Needs attention in both", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // Board is the default view with Needs attention present.
    await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
    await expect(page.locator("summary", { hasText: "Needs attention" })).toBeVisible();

    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/board-desktop.png", animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "docs/screenshots/board-mobile.png", animations: "disabled" });
      await page.setViewportSize({ width: 1280, height: 800 });
    }

    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(listRegion(page)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ready", exact: true })).toHaveCount(0);
    // Needs attention stays available in list view.
    await expect(page.locator("summary", { hasText: "Needs attention" })).toBeVisible();
    // All columns render.
    for (const col of ["ID", "Title", "Priority", "Status", "Type", "Assignee", "Age"]) {
      await expect(columnHeader(page, col)).toBeVisible();
    }

    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/list-view-desktop.png", animations: "disabled" });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.screenshot({ path: "docs/screenshots/list-view-mobile.png", animations: "disabled" });
    }

    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
    await expect(listRegion(page)).toHaveCount(0);
  });

  test("sorts each column ascending/descending with aria-sort and ID tiebreak", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, sortableIssues());
    await page.goto("/");
    await openListView(page);

    // Default sort is Age ascending (oldest first): a1, c3, b2.
    expect(await rowIds(page)).toEqual(["a1", "c3", "b2"]);

    const cases: [string, string[], string[]][] = [
      ["ID", ["a1", "b2", "c3"], ["c3", "b2", "a1"]],
      ["Title", ["a1", "b2", "c3"], ["c3", "b2", "a1"]],
      ["Priority", ["a1", "c3", "b2"], ["b2", "c3", "a1"]],
      ["Status", ["a1", "c3", "b2"], ["b2", "c3", "a1"]],
      ["Type", ["a1", "c3", "b2"], ["b2", "c3", "a1"]],
      ["Assignee", ["b2", "c3", "a1"], ["a1", "c3", "b2"]],
      ["Age", ["a1", "c3", "b2"], ["b2", "c3", "a1"]],
    ];

    for (const [label, asc, desc] of cases) {
      const header = columnHeader(page, label);
      const button = header.getByRole("button");
      // First click sets ascending on a fresh column (or toggles from previous).
      await button.click();
      await expect(header).toHaveAttribute("aria-sort", "ascending");
      expect(await rowIds(page)).toEqual(asc);
      await button.click();
      await expect(header).toHaveAttribute("aria-sort", "descending");
      expect(await rowIds(page)).toEqual(desc);
      // Third click returns to ascending.
      await button.click();
      await expect(header).toHaveAttribute("aria-sort", "ascending");
      expect(await rowIds(page)).toEqual(asc);
    }
  });

  test("shows ties broken deterministically by issue ID", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, [
      makeIssue({ id: "b2", title: "Same", priority: 1 }),
      makeIssue({ id: "a1", title: "Same", priority: 1 }),
      makeIssue({ id: "c3", title: "Same", priority: 1 }),
    ]);
    await page.goto("/");
    await openListView(page);
    await columnHeader(page, "Title").getByRole("button").click();
    expect(await rowIds(page)).toEqual(["a1", "b2", "c3"]);
  });

  test("places issues missing data last in both directions", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, [
      makeIssue({ id: "has-type", title: "Has type", priority: 0, issue_type: "bug" }),
      makeIssue({ id: "no-type", title: "No type", priority: 0, issue_type: undefined }),
    ]);
    await page.goto("/");
    await openListView(page);
    await columnHeader(page, "Type").getByRole("button").click();
    expect(await rowIds(page)).toEqual(["has-type", "no-type"]);
    await columnHeader(page, "Type").getByRole("button").click();
    expect(await rowIds(page)).toEqual(["has-type", "no-type"]);
  });

  test("mobile shows a sort select, direction button, and wrapping rows without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubIssues(page, sortableIssues());
    await page.goto("/");
    await openListView(page);

    // The sort select and direction button live in the compact board toolbar.
    const select = page.getByRole("combobox", { name: "Sort issues by" });
    await expect(select).toBeVisible();
    const dirButton = page.getByRole("button", { name: "Sort descending" });
    await expect(dirButton).toBeVisible();

    // Rows render with wrapping metadata; no horizontal scroll anywhere.
    const scroller = mobileListRegion(page);
    await expect(scroller).toBeVisible();
    await expect(scroller.getByRole("table")).toHaveCount(0);
    await expect(scroller.getByRole("list")).toBeVisible();
    expect(await scroller.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    // Choose Priority from the select (default Age asc: a1, c3, b2).
    await select.click();
    await page.getByRole("option", { name: "Priority" }).click();
    // Priority ascending is a1(0), c3(1), b2(2) => Alpha, Charlie, Bravo.
    expect(await mobileTitles(page)).toEqual(["Alpha", "Charlie", "Bravo"]);

    await page.getByRole("button", { name: "Sort descending" }).click();
    expect(await mobileTitles(page)).toEqual(["Bravo", "Charlie", "Alpha"]);
    await page.getByRole("button", { name: "Sort ascending" }).click();
    expect(await mobileTitles(page)).toEqual(["Alpha", "Charlie", "Bravo"]);
  });

  for (const width of [360, 390]) {
    test(`mobile list rows are compact and show status, priority, and ID at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await stubIssues(page, sortableIssues());
      await page.goto("/");
      await openListView(page);

      const scroller = mobileListRegion(page);
      const firstRow = scroller.getByRole("button", { name: /Alpha/ });
      await expect(firstRow).toBeVisible();

      // Title-first: the title text sits above the muted metadata line.
      await expect(firstRow.locator("span").first()).toHaveText("Alpha");

      // ID, priority, and status are all visible in the row without horizontal scroll.
      await expect(firstRow).toContainText("a1");
      await expect(firstRow).toContainText("P0");
      await expect(firstRow).toContainText("blocked");

      // The first visible issue button sits high on the viewport (<= 240px).
      const box = await firstRow.boundingBox();
      expect(box!.y + box!.height).toBeLessThanOrEqual(240);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    });
  }

  test("mobile rows handle long titles and long IDs without overflowing", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const longTitle = "This is an exceptionally long issue title that absolutely should wrap or clamp to a second line instead of forcing horizontal scrolling on a small phone";
    const longId = "alpha-1234567890-abcdefghijklmnopqrstuvwxyz";
    await stubIssues(page, [makeIssue({ id: longId, title: longTitle, priority: 0, status: "in_progress" })]);
    await page.goto("/");
    await openListView(page);

    const row = mobileListRegion(page).getByRole("button", { name: /exceptionally long issue title/ });
    await expect(row).toBeVisible();
    // No horizontal overflow for the page or the list region.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await mobileListRegion(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test("mobile list preserves scope, opens the drawer, and works by keyboard", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await openListView(page);

    // Search narrows the rows.
    await page.getByRole("searchbox", { name: "Search issues" }).fill("export");
    await expect(mobileListRegion(page).getByRole("button", { name: /Add export feature/ })).toBeVisible();
    await expect(mobileListRegion(page).getByRole("button", { name: /Fix crash on startup/ })).toHaveCount(0);

    // Clear search, switch to All scope to reveal the closed issue.
    await page.getByRole("searchbox", { name: "Search issues" }).fill("");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(mobileListRegion(page).getByRole("button", { name: /Retire legacy endpoint/ })).toBeVisible();

    // Open the drawer from a mobile row by keyboard.
    const row = mobileListRegion(page).getByRole("button", { name: /Fix crash on startup/ });
    await row.focus();
    await row.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(row).toBeFocused();
  });

  test("switching views preserves search and scope", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page.getByRole("searchbox", { name: "Search issues" }).fill("export");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(listRegion(page).getByRole("button", { name: "Add export feature", exact: true })).toBeVisible();
    await expect(listRegion(page).getByRole("button", { name: "Fix crash on startup", exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("button", { name: /Add export feature/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Fix crash on startup/ })).toHaveCount(0);

    // Clear search before checking scope so All reveals the closed issue.
    await page.getByRole("searchbox", { name: "Search issues" }).fill("");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(listRegion(page).getByRole("button", { name: "Retire legacy endpoint", exact: true })).toBeVisible();
    // Board back and forth keeps the All scope's Closed column.
    await page.getByRole("button", { name: "Board", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Closed", exact: true })).toBeVisible();
  });

  test("opens the existing drawer from a list row", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await openListView(page);
    await listRegion(page).getByRole("button", { name: "Fix crash on startup", exact: true }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    await expect(drawer.getByText("The app", { exact: false })).toBeVisible();
  });

  test("opens an issue with the keyboard from the list", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await openListView(page);
    const title = listRegion(page).getByRole("button", { name: "Fix crash on startup", exact: true });
    await title.focus();
    await title.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("polling preserves list sort and focused control", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.clock.install();
    await page.clock.pauseAt(new Date());
    let version = 0;
    // Serve modified copies of the fixture directly instead of re-reading a
    // live response, which can be disposed mid-handler when polling supersedes
    // an in-flight request.
    await page.route("**/api/projects/*/issues?scope=open", async (route) => {
      version++;
      const issues = (fixture.list as BeadsIssue[]).map((i) =>
        i.id === "alpha-1" ? { ...i, title: `Fix crash on startup ${version}` } : i,
      );
      await route.fulfill({
        json: { issues, readyIds: fixture.ready.map((r) => r.id) } satisfies IssueListResponse,
      });
    });
    await page.goto("/");
    await openListView(page);

    // Sort by ID descending: alpha-4, alpha-3, alpha-2, alpha-1.
    const idHeader = columnHeader(page, "ID");
    await idHeader.getByRole("button").click();
    await idHeader.getByRole("button").click();
    await expect(columnHeader(page, "ID")).toHaveAttribute("aria-sort", "descending");
    expect(await rowIds(page)).toEqual(["alpha-4", "alpha-3", "alpha-2", "alpha-1"]);

    await idHeader.getByRole("button").focus();
    await expect(idHeader.getByRole("button")).toBeFocused();

    // A poll cycle re-fetches (title bumps) but keeps sort and focus.
    const before = version;
    await page.clock.runFor(3000);
    await expect(listRegion(page).getByRole("button", { name: `Fix crash on startup ${before + 1}`, exact: true })).toBeVisible();
    await expect(idHeader.getByRole("button")).toBeFocused();
    await expect(columnHeader(page, "ID")).toHaveAttribute("aria-sort", "descending");
    expect(await rowIds(page)).toEqual(["alpha-4", "alpha-3", "alpha-2", "alpha-1"]);
    // The re-fetch replaced the plain title with a versioned one.
    await expect(listRegion(page).getByRole("button", { name: /Fix crash on startup \d+/ })).toBeVisible();
    await expect(listRegion(page).getByRole("button", { name: "Fix crash on startup", exact: true })).toHaveCount(0);
  });
});

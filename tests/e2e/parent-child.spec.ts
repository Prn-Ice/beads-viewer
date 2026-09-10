import { expect, test } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";

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

async function stubIssues(page: import("@playwright/test").Page, issues: BeadsIssue[], childCounts: Record<string, number> = {}) {
  await page.route("**/api/projects/*/issues?scope=open", async (route) => {
    const body: IssueListResponse = { issues, readyIds: issues.map((i) => i.id), childCounts };
    await route.fulfill({ json: body });
  });
}

function listRegion(page: import("@playwright/test").Page) {
  return page.getByRole("region", { name: "Issue list", exact: true });
}

async function rowIds(page: import("@playwright/test").Page): Promise<string[]> {
  const rows = listRegion(page).locator("tbody tr");
  return rows.evaluateAll((trs) =>
    trs.map((tr) => (tr.querySelector("td") as HTMLElement).textContent ?? ""),
  );
}

test.describe("parent-child markers", () => {
  test("board cards show a clickable child-of chip that opens the parent", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    const card = page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ });
    await expect(card).toBeVisible();

    // The chip is its own button, separate from the card so it can navigate.
    const chip = page.getByRole("button", { name: "Open parent issue alpha-0" });
    await expect(chip).toContainText("Child of");
    await expect(chip).toContainText("alpha-0");

    await chip.click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Stabilize the 1.0 release" })).toBeVisible();
    // The parent epic shows its children progress in the drawer.
    await expect(drawer.getByRole("progressbar", { name: "Epic progress" })).toBeVisible();
  });

  test("board cards show how many children an issue has", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    // alpha-3 points at alpha-4, so alpha-4's card shows the child count.
    const parentCard = page.getByRole("button", { name: /alpha-4.*Migrate database/ });
    await expect(parentCard).toContainText("1 child");
    // Issues without children show no count.
    const otherCard = page.getByRole("button", { name: /alpha-2.*Add export feature/ });
    await expect(otherCard).not.toContainText("child");
  });

  test("list view shows a Parent column with clickable chips and dash for top-level rows", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");
    await page.getByRole("button", { name: "List", exact: true }).click();

    await expect(listRegion(page).getByRole("columnheader", { name: "Parent", exact: true })).toBeVisible();
    // Every row has all 8 columns, including Parent.
    const cells = listRegion(page).locator("tbody tr").first().locator("td");
    await expect(cells).toHaveCount(8);

    const chip = listRegion(page).getByRole("button", { name: "Open parent issue alpha-0" });
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Child of alpha-0");
    await chip.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Stabilize the 1.0 release" })).toBeVisible();
  });

  test("mobile list rows show the parent in the metadata line", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.getByRole("button", { name: "List", exact: true }).click();

    const row = listRegion(page).getByRole("button", { name: /Fix crash on startup/ });
    await expect(row).toContainText("Child of alpha-0");
    // The parent is plain text inside the row button; the row still opens the issue.
    await row.click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  });

  test("the Parent column sorts by parent id with missing parents last", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, [
      makeIssue({ id: "a1", title: "Alpha", parent: "zzz" }),
      makeIssue({ id: "b2", title: "Bravo", parent: "mmm" }),
      makeIssue({ id: "c3", title: "Charlie", parent: undefined }),
    ]);
    await page.goto("/");
    await page.getByRole("button", { name: "List", exact: true }).click();

    const header = listRegion(page).getByRole("columnheader", { name: "Parent", exact: true });
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "ascending");
    expect(await rowIds(page)).toEqual(["b2", "a1", "c3"]);
    await header.getByRole("button").click();
    await expect(header).toHaveAttribute("aria-sort", "descending");
    expect(await rowIds(page)).toEqual(["a1", "b2", "c3"]);
  });
});

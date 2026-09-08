import { expect, test } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";

const MS_PER_DAY = 86_400_000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function makeIssue(overrides: Partial<BeadsIssue>): BeadsIssue {
  return {
    id: "t",
    title: "Test issue",
    status: "open",
    priority: 2,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    created_at: daysAgo(30),
    updated_at: daysAgo(30),
    ...overrides,
  };
}

function attentionIssues(): BeadsIssue[] {
  return [
    makeIssue({ id: "p0-stalled", title: "P0 stalled long", status: "in_progress", priority: 0, updated_at: daysAgo(30) }),
    makeIssue({ id: "alpha-1", title: "Fix crash on startup", status: "in_progress", priority: 0, updated_at: daysAgo(6) }),
    makeIssue({ id: "p1-stale", title: "P1 stale", priority: 1, updated_at: daysAgo(20) }),
    makeIssue({ id: "stalled", title: "Stalled task", status: "in_progress", priority: 2, updated_at: daysAgo(20) }),
    makeIssue({ id: "fresh-p0", title: "Fresh P0", priority: 0, updated_at: daysAgo(1) }),
    makeIssue({ id: "closed-p0", title: "Closed P0", status: "closed", priority: 0, updated_at: daysAgo(30) }),
    makeIssue({ id: "future-defer", title: "Deferred future", priority: 0, updated_at: daysAgo(30), defer_until: daysAgo(-5) }),
    makeIssue({ id: "no-ts", title: "No timestamp", priority: 0, updated_at: undefined, created_at: undefined }),
  ];
}

async function stubIssues(page: import("@playwright/test").Page, issues: BeadsIssue[]) {
  await page.route("**/api/projects/*/issues?scope=open", async (route) => {
    const body: IssueListResponse = { issues, readyIds: issues.map((i) => i.id) };
    await route.fulfill({ json: body });
  });
}

async function expandAttention(page: import("@playwright/test").Page) {
  const summary = page.locator("summary", { hasText: "Needs attention" });
  await summary.click();
  await expect(page.locator("details")).toHaveAttribute("open", "");
}

function panelRow(page: import("@playwright/test").Page, name: string | RegExp) {
  return page.locator("details").getByRole("button", { name });
}

test.describe("needs attention panel", () => {
  test("shows explainable reasons and respects threshold controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, attentionIssues());
    await page.goto("/");
    await expect(page.locator("summary", { hasText: "Needs attention" })).toContainText("4");
    await expandAttention(page);

    // Default thresholds flag urgent stale and stalled issues with reasons.
    await expect(panelRow(page, /P0 stalled long/)).toContainText(/urgent/);
    await expect(panelRow(page, /P0 stalled long/)).toContainText(/possibly stalled/);
    await expect(panelRow(page, /P1 stale/)).toContainText(/urgent/);
    await expect(panelRow(page, /Stalled task/)).toContainText(/possibly stalled/);

    // Fresh, closed, future-deferred, and missing-timestamp issues stay out.
    await expect(panelRow(page, /fresh-p0/)).toHaveCount(0);
    await expect(panelRow(page, /closed-p0/)).toHaveCount(0);
    await expect(panelRow(page, /future-defer/)).toHaveCount(0);
    await expect(panelRow(page, /no-ts/)).toHaveCount(0);

    // Raising the urgent threshold drops the 6-day and 20-day issues but keeps
    // the 30-day P0 stalled issue (which still stalls at the stall threshold).
    await page.getByLabel("Urgent inactivity days").fill("40");
    await expect(panelRow(page, /P1 stale/)).toHaveCount(0);
    await expect(panelRow(page, /Fix crash on startup/)).toHaveCount(0);
    await expect(panelRow(page, /P0 stalled long/)).toContainText(/possibly stalled/);
    await expect(page.locator("summary", { hasText: "Needs attention" })).toContainText("2");

    // Lowering the stall threshold brings the stalled task back in too.
    await page.getByLabel("Stalled inactivity days").fill("5");
    await expect(panelRow(page, /Stalled task/)).toContainText(/possibly stalled/);
    await expect(page.locator("summary", { hasText: "Needs attention" })).toContainText("3");

    const urgentInput = page.getByLabel("Urgent inactivity days");
    await urgentInput.fill("");
    await expect(urgentInput).toHaveValue("");
    await urgentInput.pressSequentially("12");
    await expect(urgentInput).toHaveValue("12");
    await urgentInput.fill("0");
    await urgentInput.press("Tab");
    await expect(urgentInput).toHaveValue("3");

    if (process.env.UPDATE_SCREENSHOTS) {
      await page.getByLabel("Urgent inactivity days").fill("3");
      await page.getByLabel("Stalled inactivity days").fill("14");
      await page.screenshot({ path: "docs/screenshots/attention-desktop.png", animations: "disabled" });
    }
  });

  test("opens the existing drawer for the selected issue", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubIssues(page, attentionIssues());
    await page.goto("/");
    await expandAttention(page);

    await page
      .locator("details")
      .getByRole("button", { name: /alpha-1.*Fix crash on startup/ })
      .click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    await expect(drawer.getByText("The app", { exact: false })).toBeVisible();
  });

  test("keeps the board usable and the panel bounded on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const extra = Array.from({ length: 20 }, (_, i) =>
      makeIssue({ id: `stale-${i}`, title: `Stale issue ${i}`, priority: 0, updated_at: daysAgo(30 + i) }),
    );
    await stubIssues(page, [...attentionIssues(), ...extra]);
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Fix crash on startup/ })).toBeVisible();
    await expandAttention(page);

    // The expanded panel scrolls internally instead of pushing the board away.
    const panel = page.locator("details > div");
    await expect(panel).toBeVisible();
    expect(await panel.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    // The board columns remain present and scrollable below the panel.
    await expect(page.getByRole("heading", { name: "Ready", exact: true })).toBeVisible();
    const boardScroller = page.getByRole("region", { name: "Issue board" });
    await expect(boardScroller).toBeVisible();
    await boardScroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(page.getByLabel("Urgent inactivity days")).toBeInViewport({ ratio: 1 });
    await expect(page.locator("summary", { hasText: "Needs attention" })).toBeInViewport({ ratio: 1 });
    await boardScroller.evaluate((element) => { element.scrollLeft = 0; });
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/attention-mobile.png", animations: "disabled" });
    }
    await page
      .locator("details")
      .getByRole("button", { name: /alpha-1.*Fix crash on startup/ })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});

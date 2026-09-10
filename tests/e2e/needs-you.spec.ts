import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { NeedsYouResponse } from "../../src/lib/needs-you";

const ALPHA = path.resolve(__dirname, "../fixtures/projects/alpha");
const BETA = path.resolve(__dirname, "../fixtures/projects/beta");

function issue(id: string, title: string, priority = 2) {
  return { id, title, priority, status: "open" };
}

interface Control {
  projects: { path: string; name: string; issues: ReturnType<typeof issue>[]; error?: string }[];
  requests: number;
  fail: boolean;
}

function responseFor(control: Control): NeedsYouResponse {
  return { fetchedAt: Date.now(), projects: control.projects };
}

async function stubNeedsYou(page: Page, control: Control) {
  await page.route("**/api/needs-you", async (route) => {
    control.requests++;
    if (control.fail) {
      await route.fulfill({ status: 500, json: { error: "offline" } });
      return;
    }
    await route.fulfill({ json: responseFor(control) });
  });
}

function panel(page: Page) {
  return page.locator('details[aria-label="Needs you"]');
}

function summary(page: Page) {
  return panel(page).locator("summary");
}

async function expand(page: Page) {
  await summary(page).click();
  await expect(panel(page)).toHaveAttribute("open", "");
}

function inbox(page: Page) {
  return page.getByRole("region", { name: "Needs you", exact: true });
}

test.describe("needs you inbox", () => {
  test("loads once on first open and groups issues by project with counts", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = {
      projects: [
        { path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup", 0), issue("alpha-9", "Review API design")] },
        { path: BETA, name: "beta", issues: [issue("beta-2", "Approve license change", 1)] },
      ],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.goto("/");

    // Before the panel is opened, nothing has been fetched and the summary
    // shows no count (an unloaded snapshot must not read as zero).
    await expect(page.locator("summary", { hasText: "Needs you" })).toContainText("Needs you");
    await expect(summary(page).locator(".rounded-full")).toHaveCount(0);
    expect(control.requests).toBe(0);

    await expand(page);
    await expect(summary(page)).toContainText("3");
    await expect(inbox(page)).toContainText("As of");
    expect(control.requests).toBe(1);

    const region = inbox(page);
    await expect(region.getByRole("region", { name: "alpha needs you" })).toContainText("2");
    await expect(region.getByRole("region", { name: "beta needs you" })).toContainText("1");
    await expect(region.getByRole("button", { name: /alpha-1/ })).toContainText("Fix crash on startup");
    await expect(region.getByRole("button", { name: /beta-2/ })).toContainText("Approve license change");
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/needs-you-1280.png", animations: "disabled" });
    }
  });

  test("does not poll while open and only refreshes manually", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = {
      projects: [{ path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup")] }],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await expand(page);
    await expect(summary(page)).toContainText("1");

    // The board keeps polling, but the inbox stays on its loaded snapshot.
    await page.waitForTimeout(3500);
    expect(control.requests).toBe(1);

    // Closing and reopening reuses the same snapshot.
    await summary(page).click();
    await expect(panel(page)).not.toHaveAttribute("open", "");
    await summary(page).click();
    await expect(panel(page)).toHaveAttribute("open", "");
    expect(control.requests).toBe(1);

    // Manual refresh pulls a new snapshot.
    control.projects[0].issues.push(issue("alpha-9", "Review API design"));
    await page.getByRole("button", { name: "Refresh needs you" }).click();
    await expect(summary(page)).toContainText("2");
    await expect(inbox(page).getByRole("button", { name: /alpha-9/ })).toBeVisible();
    expect(control.requests).toBe(2);
  });

  test("shows accessible empty and partial-error states", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = {
      projects: [
        { path: BETA, name: "beta", issues: [], error: "bd list exited 2: boom" },
      ],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await expand(page);
    const region = inbox(page);
    await expect(region.getByRole("status")).toContainText("Could not check 1 project");
    await expect(region).toContainText("beta: bd list exited 2: boom");
    await expect(region.getByText("No issues need you right now.")).toHaveCount(0);
    await expect(summary(page)).toContainText("?");

    control.projects = [];
    await page.getByRole("button", { name: "Refresh needs you" }).click();
    await expect(region.getByRole("status").filter({ hasText: "No issues need you right now." })).toBeVisible();
    await expect(region.getByText("beta: bd list exited 2: boom")).toHaveCount(0);
    await expect(summary(page)).toContainText("0");
  });

  test("opens the existing drawer with a project deep link preserving filters", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = {
      projects: [{ path: BETA, name: "beta", issues: [issue("beta-2", "Approve license change", 0)] }],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.route("**/issues/beta-2", (route) => route.fulfill({ json: issue("beta-2", "Approve license change", 0) }));
    await page.goto("/?q=crash");
    await expand(page);
    await inbox(page).getByRole("button", { name: /beta-2/ }).click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Approve license change" })).toBeVisible();
    const params = new URL(page.url()).searchParams;
    expect(params.get("project")).toBe(BETA);
    expect(params.get("issue")).toBe("beta-2");
    expect(params.get("q")).toBe("crash");
    let graphProject = "";
    await page.route("**/issues/beta-2?relationships=all", (route) => {
      graphProject = decodeURIComponent(new URL(route.request().url()).pathname.split("/")[3]);
      return route.fulfill({ json: {
        ...issue("beta-2", "Approve license change", 0),
        dependencies: [{ id: "beta-review", title: "Review license", status: "open", priority: 1, dependency_type: "blocks" }],
        dependents: [], dependency_count: 1, dependent_count: 0, comment_count: 0,
      } });
    });
    await drawer.getByRole("tab", { name: /Dependencies/ }).click();
    await drawer.locator("summary", { hasText: "Dependency graph" }).click();
    await expect(drawer.getByRole("region", { name: "Dependency graph", exact: true })
      .getByRole("button", { name: /beta-review: Review license/ })).toBeVisible();
    expect(graphProject).toBe(BETA);
  });

  test("reports a total failure and can retry", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = { projects: [], requests: 0, fail: true };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await expand(page);
    await expect(panel(page)).toContainText("Couldn't load the needs-you list");
    await expect(summary(page)).not.toContainText("As of");

    control.fail = false;
    control.projects = [{ path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup")] }];
    await page.getByRole("button", { name: "Refresh needs you" }).click();
    await expect(summary(page)).toContainText("1");
    await expect(inbox(page).getByRole("button", { name: /alpha-1/ })).toBeVisible();
  });

  test("a failed refresh keeps the old snapshot but visibly marks it stale", async ({ page }) => {
    const control: Control = { projects: [{ path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup")] }], requests: 0, fail: false };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await expand(page);
    await expect(summary(page)).toContainText("1");
    control.fail = true;
    await inbox(page).getByRole("button", { name: "Refresh needs you" }).click();
    await expect(inbox(page)).toContainText("Showing the last result");
    await expect(inbox(page).getByRole("button", { name: /alpha-1/ })).toBeVisible();
    await expect(summary(page)).toContainText("!");
  });

  test("large inboxes remain bounded on mobile even with session changes expanded", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const control: Control = { projects: [{ path: ALPHA, name: "alpha", issues: Array.from({ length: 60 }, (_, index) => issue(`review-${index}`, `Review request ${index}`)) }], requests: 0, fail: false };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await page.getByRole("button", { name: /Choose project/ }).click();
    await expand(page);
    await expect(summary(page)).toContainText("60");
    expect(await inbox(page).evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await page.locator("summary", { hasText: "Session changes" }).click();
    await inbox(page).getByRole("button", { name: /review-59/ }).focus();
    await expect(inbox(page).getByRole("button", { name: /review-59/ })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(844);
  });

  test("mobile sidebar opens the inbox and drills into the drawer", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const control: Control = {
      projects: [{ path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup", 0)] }],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.goto("/");
    await page.getByRole("button", { name: /Choose project/ }).click();
    await expect(page.getByRole("dialog").getByText("alpha", { exact: true })).toBeVisible();
    await expand(page);
    await expect(summary(page)).toContainText("1");
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/needs-you-390.png", animations: "disabled" });
    }
    await inbox(page).getByRole("button", { name: /alpha-1/ }).click();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("project")).toBe(ALPHA);
  });

  test("needs you and session changes share one explicit rotating caret each, keyboard toggled", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const control: Control = {
      projects: [{ path: ALPHA, name: "alpha", issues: [issue("alpha-1", "Fix crash on startup")] }],
      requests: 0,
      fail: false,
    };
    await stubNeedsYou(page, control);
    await page.goto("/");

    const sidebar = page.locator('[data-slot="sidebar"]');
    const needsYouSummary = panel(page).locator("summary");
    const sessionSummary = sidebar.locator("summary", { hasText: "Session changes" });
    const needsYouCaret = needsYouSummary.locator(".lucide-chevron-right");
    const sessionCaret = sessionSummary.locator(".lucide-chevron-right");

    // Exactly two explicit carets in the sidebar, native markers suppressed.
    await expect(sidebar.locator(".lucide-chevron-right")).toHaveCount(2);
    await expect(needsYouCaret).toHaveCount(1);
    await expect(sessionCaret).toHaveCount(1);
    const rightEdges = await sidebar.locator(".lucide-chevron-right").evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().right));
    expect(rightEdges[0]).toBeCloseTo(rightEdges[1], 0);
    for (const item of [needsYouSummary, sessionSummary]) {
      // Native markers are suppressed cross-browser: list-style:none for
      // Firefox, the ::-webkit-details-marker rule for Chromium.
      expect(await item.evaluate((el) => getComputedStyle(el).listStyleType)).toBe("none");
      expect(await item.evaluate((el) => [...el.classList].some((name) => name.includes("details-marker")))).toBe(true);
    }

    // Closed: caret points right. Open by keyboard: caret rotates 90°.
    await expect(needsYouCaret).toHaveCSS("rotate", "none");
    await expect(sessionCaret).toHaveCSS("rotate", "none");
    await needsYouSummary.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toHaveAttribute("open", "");
    await expect(needsYouCaret).toHaveCSS("rotate", "90deg");
    await expect(sessionCaret).toHaveCSS("rotate", "none");
    await sessionSummary.focus();
    await page.keyboard.press("Enter");
    await expect(sessionSummary.locator("xpath=..")).toHaveAttribute("open", "");
    await expect(sessionCaret).toHaveCSS("rotate", "90deg");

    // Closing again restores the right-pointing caret.
    await needsYouSummary.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).not.toHaveAttribute("open", "");
    await expect(needsYouCaret).toHaveCSS("rotate", "none");
    await expect(sessionCaret).toHaveCSS("rotate", "90deg");
  });
});

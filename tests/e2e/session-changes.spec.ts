import { expect, test, type Page } from "@playwright/test";
import type { BeadsIssue } from "../../src/lib/types";

const START = Date.parse("2026-09-08T12:00:00Z");
function issue(id: string, title: string, extra: Partial<BeadsIssue> = {}): BeadsIssue {
  return { id, title, status: "open", priority: 2, created_at: "2026-01-01T00:00:00Z", dependency_count: 0, dependent_count: 0, comment_count: 0, ...extra };
}

async function setup(page: Page) {
  await page.clock.install({ time: new Date(START) });
  await page.clock.pauseAt(new Date(START));
  const control = {
    alpha: [issue("session-a", "Initial task"), issue("old-closed", "Old closed task", { status: "closed" })],
    beta: [issue("session-b", "Other project task")],
    requests: 0,
    fail: false,
  };
  await page.route("**/issues?scope=*", async (route) => {
    control.requests++;
    if (control.fail) { await route.fulfill({ status: 500, json: { error: "offline" } }); return; }
    const url = new URL(route.request().url());
    const project = decodeURIComponent(url.pathname.split("/")[3]).endsWith("/beta") ? "beta" : "alpha";
    const issues = control[project].filter((item) => url.searchParams.get("scope") === "all" || item.status !== "closed");
    await route.fulfill({ json: { issues, readyIds: issues.map((item) => item.id) } });
  });
  await page.route("**/issues/session-a", (route) => route.fulfill({ json: control.alpha[0] }));
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Issue board" }).getByRole("button", { name: /Initial task/ })).toBeVisible();
  return control;
}

async function openSummary(page: Page, mobile = false) {
  if (mobile) await page.getByRole("button", { name: /Choose project/ }).click();
  await page.locator("summary", { hasText: "Session changes" }).click();
  await page.clock.runFor(250);
  return page.getByRole("region", { name: "Session changes", exact: true });
}

for (const width of [1280, 390]) {
  test(`reviews changes and opens the changed issue at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const control = await setup(page);
    control.alpha[0] = { ...control.alpha[0], title: "Updated task", priority: 0 };
    control.alpha.push(issue("session-new", "New task", { created_at: new Date(START + 1000).toISOString() }));
    await page.clock.runFor(3000);
    await expect(page.getByRole("region", { name: "Issue board" }).getByRole("button", { name: /Updated task/ })).toBeVisible();
    const summary = await openSummary(page, width < 768);
    await expect(summary.getByRole("listitem")).toHaveCount(2);
    await expect(summary).toContainText("Created during this session");
    await expect(summary).toContainText("Title changed; Priority changed");
    await expect(summary).toBeInViewport({ ratio: 1 });
    if (process.env.UPDATE_SCREENSHOTS) await page.screenshot({ path: `docs/screenshots/session-changes-${width}.png`, animations: "disabled" });
    const changed = summary.getByRole("button", { name: /session-a: Updated task/ });
    await changed.focus();
    await changed.press("Enter");
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Updated task" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("issue")).toBe("session-a");
  });
}

test("scope changes and disappearing issues do not manufacture events", async ({ page }) => {
  const control = await setup(page);
  const summary = await openSummary(page);
  await expect(summary).toContainText("No observed changes");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(page.getByRole("region", { name: "Issue board" }).getByRole("button", { name: /Old closed task/ })).toBeVisible();
  await expect(summary).toContainText("No observed changes");
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Closed", exact: true })).toHaveCount(0);
  control.alpha[0] = { ...control.alpha[0], status: "closed" };
  await page.clock.runFor(3000);
  await expect(page.getByRole("region", { name: "Issue board" }).getByRole("button", { name: /Initial task/ })).toHaveCount(0);
  await expect(summary).toContainText("No observed changes");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  await expect(summary.getByRole("button", { name: /session-a/ })).toContainText("Closed");
  await summary.getByRole("button", { name: "Reset baseline" }).click();
  await expect(summary).toContainText("No observed changes");
  control.alpha[0] = { ...control.alpha[0], status: "open" };
  await page.clock.runFor(3000);
  await expect(summary).toContainText("Reopened");
});

test("filters, failed polls, project switches and resets preserve independent baselines", async ({ page }) => {
  const control = await setup(page);
  const summary = await openSummary(page);
  control.alpha[0] = { ...control.alpha[0], title: "Changed" };
  await page.clock.runFor(3000);
  await expect(summary).toContainText("Title changed");
  await page.getByRole("searchbox").fill("not matching");
  await expect(page.getByRole("region", { name: "Issue board" }).getByRole("button")).toHaveCount(0);
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  control.fail = true;
  await page.clock.runFor(3000);
  await expect(page.getByText(/failed to load issues/)).toBeVisible();
  await expect(summary.getByRole("listitem")).toHaveCount(1);
  control.fail = false;
  await page.getByRole("button", { name: /^beta/ }).click();
  await expect(page.getByRole("heading", { name: "beta", exact: true })).toBeVisible();
  await expect(summary).toContainText("No observed changes");
  await page.getByRole("button", { name: /^alpha/ }).click();
  await expect(page.getByRole("heading", { name: "alpha", exact: true })).toBeVisible();
  await expect(summary).toContainText("Title changed");
  await summary.getByRole("button", { name: "Reset baseline" }).click();
  await expect(summary).toContainText("No observed changes");
  await page.clock.runFor(3000);
  await expect(summary).toContainText("No observed changes");
});

test("a hidden tab only compares the next successful snapshot on return", async ({ page }) => {
  const control = await setup(page);
  const summary = await openSummary(page);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const before = control.requests;
  control.alpha[0] = { ...control.alpha[0], title: "While away" };
  await page.clock.runFor(9000);
  expect(control.requests).toBe(before);
  await expect(summary).toContainText("No observed changes");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(summary).toContainText("Title changed");
  await expect(summary).toContainText("While away");
});

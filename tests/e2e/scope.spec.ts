import { expect, test } from "@playwright/test";
import type { IssueListResponse } from "../../src/lib/types";

for (const width of [1280, 390]) {
  test(`Open -> All -> Open preserves readiness at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto("/");
    const ready = page.locator("section").filter({ has: page.getByRole("heading", { name: "Ready", exact: true }) });
    const backlog = page.locator("section").filter({ has: page.getByRole("heading", { name: "Backlog", exact: true }) });
    await expect(ready.getByRole("button", { name: /Write release notes/ })).toHaveCount(1);
    for (const scope of ["All", "Open"]) {
      const response = page.waitForResponse((res) => res.url().endsWith(`/issues?scope=${scope.toLowerCase()}`));
      await page.getByRole("button", { name: scope, exact: true }).click();
      expect((await (await response).json()).readyIds).toEqual(["alpha-3"]);
      await expect(ready.getByRole("button", { name: /Write release notes/ })).toHaveCount(1);
      await expect(backlog.getByRole("button", { name: /Write release notes/ })).toHaveCount(0);
      await expect(backlog.getByRole("button", { name: /Migrate database/ })).toHaveCount(1);
      await expect(page.getByRole("heading", { name: "Closed", exact: true })).toHaveCount(scope === "All" ? 1 : 0);
    }
  });

  test(`All keeps a long Closed column inside the board at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    // Keep the real API response (including readiness); only enlarge the closed history.
    await page.route("**/issues?scope=all", async (route) => {
      const response = await route.fetch();
      const data: IssueListResponse = await response.json();
      const closed = data.issues.find((issue) => issue.status === "closed")!;
      for (let i = 0; i < 60; i++) {
        data.issues.push({ ...closed, id: `history-${i}`, title: `Archived issue ${i}` });
      }
      await route.fulfill({ response, json: data });
    });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Write release notes/ })).toBeVisible();
    await page.getByRole("button", { name: "All", exact: true }).click();
    const closed = page.locator("section").filter({ has: page.getByRole("heading", { name: "Closed", exact: true }) });
    await expect(closed.getByRole("button")).toHaveCount(61);
    await page.screenshot({ path: testInfo.outputPath("all-before-scroll.png") });
    expect.soft(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect.soft(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(800);
    const controls = [
      page.getByRole("searchbox"),
      ...["Open", "All", "Refresh", "Change theme", "Toggle Sidebar"].map(
        (name) => page.getByRole("button", { name, exact: true }),
      ),
    ];
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    const board = page.getByRole("region", { name: "Issue board" });
    await board.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
    await expect(closed.getByRole("heading")).toBeInViewport({ ratio: 1 });
    const list = closed.locator(":scope > div");
    expect(await list.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await list.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(closed.getByRole("button").last()).toBeInViewport({ ratio: 1 });
    await expect(closed.getByRole("heading")).toBeInViewport({ ratio: 1 });
    for (const control of controls) {
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: testInfo.outputPath("all-after-scroll.png") });
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: `docs/screenshots/beads-all-${width}.png`, animations: "disabled" });
    }
    // Tabbing to an offscreen card must scroll its column, not the page/header.
    await closed.getByRole("button").first().focus();
    await expect(closed.getByRole("button").first()).toBeInViewport({ ratio: 1 });
    await closed.getByRole("button").nth(59).focus();
    await page.keyboard.press("Tab");
    await expect(closed.getByRole("button").last()).toBeFocused();
    await expect(closed.getByRole("button").last()).toBeInViewport({ ratio: 1 });
    await page.getByRole("searchbox").fill("Archived issue 59");
    await expect(closed.getByRole("button")).toHaveCount(1);
    await page.getByRole("searchbox").fill("");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(closed).toHaveCount(0);
    expect(await page.evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }))).toEqual({ x: 0, y: 0, width, height: 800 });
  });
}

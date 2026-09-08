import { expect, test } from "@playwright/test";

test("board polls every three seconds, pauses when hidden, and refreshes on return", async ({ page }) => {
  await page.clock.install();
  await page.clock.pauseAt(new Date());
  let projectRequests = 0;
  let boardRequests = 0;
  await page.route("**/api/projects", async (route) => {
    projectRequests++;
    await route.continue();
  });
  await page.route("**/issues?scope=open", async (route) => {
    const version = ++boardRequests;
    const response = await route.fetch();
    const data = await response.json();
    data.issues.find((issue: { id: string }) => issue.id === "alpha-1").title = `Updated issue ${version}`;
    await route.fulfill({ response, json: data });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Updated issue 1/ })).toBeVisible();
  await page.clock.runFor(2999);
  expect(boardRequests).toBe(1);
  await page.clock.runFor(1);
  await expect(page.getByRole("button", { name: /Updated issue 2/ })).toBeVisible();
  expect(projectRequests).toBe(2);

  for (let cycle = 0; cycle < 2; cycle++) {
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    const before = boardRequests;
    await page.clock.runFor(12_000);
    expect(boardRequests).toBe(before);
    expect(projectRequests).toBe(before);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(page.getByRole("button", { name: `Updated issue ${before + 1}`, exact: false })).toBeVisible();
    await page.clock.runFor(3000);
    await expect(page.getByRole("button", { name: `Updated issue ${before + 2}`, exact: false })).toBeVisible();
    expect(boardRequests).toBe(before + 2);
    expect(projectRequests).toBe(before + 2);
  }
});

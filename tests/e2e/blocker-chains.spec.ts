import { expect, test, type Page } from "@playwright/test";
import type { BeadsIssue, DependencyRef } from "../../src/lib/types";

const link = (id: string, type = "blocks"): DependencyRef => ({ id, title: `Issue ${id}`, dependency_type: type });
function issue(id: string, dependencies: DependencyRef[] = [], dependents: DependencyRef[] = []): BeadsIssue {
  return { id, title: `Issue ${id}`, status: "open", dependencies, dependents, dependency_count: dependencies.length, dependent_count: dependents.length, comment_count: 0 };
}
const data: Record<string, BeadsIssue> = {
  "alpha-1": issue("alpha-1", [link("b"), link("c"), link("missing"), link("parent", "parent-child"), link("related", "related")], [link("d")]),
  b: { ...issue("b", [link("c")]), status: "closed" },
  c: issue("c", [link("alpha-1"), link("end")]),
  d: issue("d", [], [link("e")]),
};

async function setup(page: Page) {
  const requests: string[] = [];
  await page.route("**/issues/*?relationships=all", async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    requests.push(id);
    await route.fulfill({ status: data[id] ? 200 : 404, json: data[id] ?? { error: "missing" } });
  });
  await page.route("**/issues/alpha-1", (route) => route.fulfill({ json: data["alpha-1"] }));
  await page.route("**/issues/b", (route) => route.fulfill({ json: data.b }));
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Fix crash/ }).click();
  await page.getByRole("tab", { name: /Dependencies/ }).click();
  return requests;
}

for (const width of [1280, 390]) {
  test(`explores typed, bounded chains at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const requests = await setup(page);
    expect(requests).toEqual([]);
    const summary = page.locator("summary", { hasText: "Explore blocker chains" });
    await summary.focus();
    await summary.press("Enter");
    const up = page.getByRole("region", { name: "Blocked by", exact: true });
    const down = page.getByRole("region", { name: "Blocks", exact: true });
    await up.getByRole("button", { name: "Expand b Blocked by", exact: true }).click();
    await expect(up).toContainText("blocking issue is closed");
    await expect(up).toContainText("listed above");
    await up.getByRole("button", { name: "Expand c Blocked by", exact: true }).click();
    await expect(up).toContainText("cycle");
    await expect(up).toContainText(/Stops here/);
    await expect(up.getByRole("button", { name: /Expand end/ })).toHaveCount(0);
    await expect(up).toContainText("parent (parent-child)");
    await expect(up).toContainText("related (related)");
    await expect(up.getByRole("button", { name: /Expand parent/ })).toHaveCount(0);
    await down.getByRole("button", { name: "Expand d Blocks", exact: true }).click();
    await expect(down.getByRole("button", { name: "e: Issue e", exact: true })).toBeVisible();
    await up.getByRole("button", { name: "Collapse b Blocked by", exact: true }).click();
    await up.getByRole("button", { name: "Expand b Blocked by", exact: true }).click();
    expect(requests.filter((id) => id === "b")).toHaveLength(1);
    expect(requests).not.toContain("parent");
    expect(await page.getByRole("dialog").evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    if (process.env.UPDATE_SCREENSHOTS) await page.screenshot({ path: `docs/screenshots/blocker-chains-${width}.png`, animations: "disabled" });
    await up.getByRole("button", { name: "b: Issue b", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Issue b", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Issue alpha-1", exact: true })).toBeVisible();
  });
}

test("missing chain nodes show an error and can be retried", async ({ page }) => {
  await setup(page);
  await page.locator("summary", { hasText: "Explore blocker chains" }).click();
  const up = page.getByRole("region", { name: "Blocked by", exact: true });
  await up.getByRole("button", { name: "Expand missing Blocked by", exact: true }).click();
  await expect(up).toContainText(/Couldn.t load this issue/);
  await page.route("**/issues/missing?relationships=all", (route) => route.fulfill({ json: issue("missing") }));
  await up.getByRole("button", { name: "Retry missing", exact: true }).click();
  await expect(up).not.toContainText(/Couldn.t load this issue/);
});

test("limits distinct issue requests even for a wide root", async ({ page }) => {
  await setup(page);
  let calls = 0;
  await page.route("**/issues/*?relationships=all", (route) => {
    calls++;
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    return route.fulfill({ json: id === "alpha-1" ? issue(id, Array.from({ length: 40 }, (_, i) => link(`wide-${i}`))) : issue(id) });
  });
  await page.locator("summary", { hasText: "Explore blocker chains" }).click();
  const up = page.getByRole("region", { name: "Blocked by", exact: true });
  await expect(up).toContainText("More rows not shown");
  for (let i = 0; i < 30; i++) {
    await up.getByRole("button", { name: `Expand wide-${i} Blocked by`, exact: true }).click();
  }
  await expect(page.getByText(/Load limit reached/)).toBeVisible();
  await expect.poll(() => calls).toBe(30); // Root plus 29 expanded issues.
});

test("board polling leaves expanded chains loaded", async ({ page }) => {
  let version = 0;
  await page.route("**/issues?scope=open", (route) => route.fulfill({ json: {
    issues: [{ ...data["alpha-1"], title: `Fix crash version ${++version}` }], readyIds: ["alpha-1"], childCounts: {},
  } }));
  const requests = await setup(page);
  await page.locator("summary", { hasText: "Explore blocker chains" }).click();
  const up = page.getByRole("region", { name: "Blocked by", exact: true });
  await up.getByRole("button", { name: "Expand b Blocked by", exact: true }).click();
  await expect(up.getByRole("button", { name: "Expand c Blocked by", exact: true })).toBeVisible();
  const next = version + 1;
  const board = page.getByRole("region", { name: "Issue board", includeHidden: true });
  await expect(board.getByRole("button", { name: new RegExp(`Fix crash version ${next}`), includeHidden: true })).toBeVisible({ timeout: 10_000 });
  await expect(up.getByRole("button", { name: "Collapse b Blocked by", exact: true })).toBeVisible();
  expect(requests).toEqual(["alpha-1", "b"]);
});

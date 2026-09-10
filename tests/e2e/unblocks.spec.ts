import { expect, test, type Page } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";
import type { UnblockCandidate, UnblocksAnalysis } from "../../src/lib/unblocks";

function makeIssue(id: string, title: string, extra: Partial<BeadsIssue> = {}): BeadsIssue {
  return {
    id,
    title,
    status: "open",
    priority: 2,
    labels: [],
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-02T10:00:00Z",
    ...extra,
  };
}

const root = makeIssue("alpha-1", "Issue alpha-1", { status: "in_progress", priority: 0 });

function candidate(id: string, verdict: UnblockCandidate["verdict"], reason: string, extra: Partial<UnblockCandidate> = {}): UnblockCandidate {
  return { id, title: `Issue ${id}`, status: "open", verdict, reason, ...extra };
}

const analysis: UnblocksAnalysis = {
  rootId: "alpha-1",
  rootStatus: "in_progress",
  projectCycleCount: 0,
  candidates: [
    candidate("u-likely", "likely", "Would become ready."),
    candidate("u-second", "not-likely", "Also blocked by u-other (Other issue, open).", {
      remainingBlockers: [{ id: "u-other", title: "Other issue", status: "open" }],
    }),
    candidate("u-ready", "not-likely", "Already ready."),
    candidate("u-parent", "verify", "Linked to alpha-0 as parent/child; check manually."),
  ],
  omitted: 0,
  missing: [],
};

async function stubApi(page: Page) {
  await page.route("**/api/projects/*/issues?scope=open", (route) => {
    const body: IssueListResponse = { issues: [root], readyIds: [] };
    return route.fulfill({ json: body });
  });
  await page.route("**/api/projects/*/issues/*/comments", (route) => route.fulfill({ json: [] }));
  // Drawer loads for any single issue id, excluding sub-paths like /comments
  // and /unblocks so the disclosure keeps its own route.
  await page.route(
    (url) => {
      const path = url.pathname;
      return path.includes("/issues/") && !path.endsWith("/comments") && !path.endsWith("/unblocks") && !url.search;
    },
    (route) => {
      const id = decodeURIComponent(route.request().url().split("/").pop()!);
      return route.fulfill({ json: makeIssue(id, `Issue ${id}`) });
    },
  );
}

async function openDrawer(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Issue alpha-1/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
  return drawer;
}

async function openDisclosure(drawer: import("@playwright/test").Locator) {
  await drawer.locator("summary", { hasText: "What would this unblock?" }).click();
}

for (const width of [1280, 390]) {
  test(`shows likely, verification, and excluded groups on demand at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await stubApi(page);
    let unblocksRequests = 0;
    await page.route("**/api/projects/*/issues/*/unblocks", (route) => {
      unblocksRequests += 1;
      return route.fulfill({ json: { fetchedAt: Date.now(), ...analysis } });
    });
    const drawer = await openDrawer(page);

    // On demand: nothing is fetched until the disclosure opens.
    expect(unblocksRequests).toBe(0);
    await openDisclosure(drawer);
    await expect.poll(() => unblocksRequests).toBe(1);

    await expect(drawer.getByText("1 would become ready · 1 need a manual check · 2 would not change")).toBeVisible();
    const likely = drawer.getByRole("region", { name: "Would become ready" });
    await expect(likely.getByRole("button", { name: /u-likely: Issue u-likely/ })).toBeVisible();
    const verify = drawer.getByRole("region", { name: "Needs a manual check" });
    await expect(verify.getByRole("button", { name: /u-parent: Issue u-parent/ })).toBeVisible();
    await expect(verify.getByText(/parent\/child/)).toBeVisible();
    const excluded = drawer.getByRole("region", { name: "Would not change" });
    await expect(excluded.getByRole("button", { name: /u-second: Issue u-second/ })).toBeVisible();
    await expect(excluded.getByRole("button", { name: /u-ready: Issue u-ready/ })).toBeVisible();
    await expect(excluded.getByText(/Already ready/)).toBeVisible();
    // Remaining blockers are linked.
    await expect(excluded.getByRole("button", { name: /u-other/ })).toBeVisible();
    await expect(drawer.getByText(/An estimate of what finishing this issue would unblock/)).toBeVisible();

    // No polling: waiting well past the 3s board poll interval changes nothing.
    await page.waitForTimeout(4000);
    expect(unblocksRequests).toBe(1);

    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({
        path: `docs/screenshots/unblocks-${width}.png`,
        animations: "disabled",
      });
    }
  });
}

test("clicking a likely candidate opens it and Back returns to the root", async ({ page }) => {
  await stubApi(page);
  await page.route("**/api/projects/*/issues/*/unblocks", (route) =>
    route.fulfill({ json: { fetchedAt: Date.now(), ...analysis } }),
  );
  const drawer = await openDrawer(page);
  await openDisclosure(drawer);

  await drawer.getByRole("region", { name: "Would become ready" })
    .getByRole("button", { name: /u-likely: Issue u-likely/ }).click();
  await expect(drawer.getByRole("heading", { name: "Issue u-likely" })).toBeVisible();
  await drawer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();
});

test("a failed estimate shows an explicit error and Retry recovers", async ({ page }) => {
  await stubApi(page);
  await page.route("**/api/projects/*/issues/*/unblocks", (route) =>
    route.fulfill({ status: 500, json: { error: "boom" } }),
  );
  const drawer = await openDrawer(page);
  await openDisclosure(drawer);
  await expect(drawer.getByText(/Couldn't load the unblock estimate/)).toBeVisible();

  // Register the fixed route after, so the retry succeeds.
  await page.route("**/api/projects/*/issues/*/unblocks", (route) =>
    route.fulfill({ json: { fetchedAt: Date.now(), ...analysis } }),
  );
  await drawer.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(drawer.getByRole("region", { name: "Would become ready" })).toBeVisible();
  await expect(drawer.getByText(/Couldn't load the unblock estimate/)).toHaveCount(0);
});
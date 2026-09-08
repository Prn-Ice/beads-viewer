import path from "node:path";
import { expect, test } from "@playwright/test";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";

const alphaPath = path.resolve(__dirname, "../fixtures/projects/alpha");

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

// A depends on B, B depends on C. C lists B as a dependent (so the chain is
// reachable in both directions) and also lists itself as a dependency to
// exercise self-links. Following "Required by" from C returns to A, forming a
// cycle back to the root.
const relA = makeIssue("rel-a", "Issue A", {
  dependencies: [{ id: "rel-b", title: "Issue B", status: "open", issue_id: "rel-a", depends_on_id: "rel-b", type: "dependency" }],
  dependents: [{ id: "rel-c", title: "Issue C", status: "open", issue_id: "rel-a", depends_on_id: "rel-c", type: "dependency" }],
});
const relB = makeIssue("rel-b", "Issue B", {
  dependencies: [{ id: "rel-c", title: "Issue C", status: "open", issue_id: "rel-b", depends_on_id: "rel-c", type: "dependency" }],
  dependents: [{ id: "rel-a", title: "Issue A", status: "open", issue_id: "rel-a", depends_on_id: "rel-b", type: "dependency" }],
});
const relC = makeIssue("rel-c", "Issue C", {
  dependencies: [{ id: "rel-c", title: "Issue C", status: "open", issue_id: "rel-c", depends_on_id: "rel-c", type: "dependency" }],
  dependents: [
    { id: "rel-b", title: "Issue B", status: "open", issue_id: "rel-b", depends_on_id: "rel-c", type: "dependency" },
    { id: "rel-a", title: "Issue A", status: "open", issue_id: "rel-a", depends_on_id: "rel-c", type: "dependency" },
  ],
});
const chain = [relA, relB, relC];

async function stubRelationships(page: import("@playwright/test").Page) {
  await page.route("**/api/projects/*/issues?scope=open", async (route) => {
    const body: IssueListResponse = { issues: chain, readyIds: [] };
    await route.fulfill({ json: body });
  });
  for (const issue of chain) {
    await page.route(`**/api/projects/*/issues/${issue.id}`, async (route) => {
      await route.fulfill({ json: issue });
    });
  }
  await page.route("**/api/projects/*/issues/*/comments", (route) =>
    route.fulfill({ json: [] }),
  );
}

async function openIssueFromBoard(page: import("@playwright/test").Page, title: string) {
  const card = page.getByRole("button", { name: new RegExp(`.*${title}`) }).first();
  await card.click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: title })).toBeVisible();
  return drawer;
}

async function openDependenciesTab(drawer: import("@playwright/test").Locator) {
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
}

function backButton(drawer: import("@playwright/test").Locator) {
  return drawer.getByRole("button", { name: "Back", exact: true });
}

function relationshipButton(drawer: import("@playwright/test").Locator, id: string) {
  return drawer.getByRole("button", { name: new RegExp(`^${id} `) });
}

test.describe("drawer back trail", () => {
  test.beforeEach(async ({ page }) => {
    await stubRelationships(page);
  });

  test("follows dependencies A->B->C and steps back twice", async ({ page }) => {
    await page.goto(`/?foo=keep#notes`);
    const drawer = await openIssueFromBoard(page, "Issue A");

    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    await relationshipButton(drawer, "rel-c").click();
    await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();
    await expect(backButton(drawer)).toBeVisible();

    // The URL follows the drawer while preserving unrelated query and hash.
    const params = new URL(page.url()).searchParams;
    expect(params.get("project")).toBe(alphaPath);
    expect(params.get("issue")).toBe("rel-c");
    expect(params.get("foo")).toBe("keep");
    expect(new URL(page.url()).hash).toBe("#notes");

    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("issue")).toBe("rel-b");

    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("issue")).toBe("rel-a");

    // Back to the trail root: the Back button disappears.
    await expect(backButton(drawer)).toHaveCount(0);

    if (process.env.UPDATE_SCREENSHOTS) {
      await relationshipButton(drawer, "rel-b").click();
      await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
      await page.screenshot({
        path: "docs/screenshots/drawer-back-desktop.png",
        animations: "disabled",
      });
    }
  });

  test("keeps cycle and self-link steps sensible", async ({ page }) => {
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");

    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
    await relationshipButton(drawer, "rel-c").click();
    await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();

    // Cycle: "Required by" from C lists A, taking us back to the root. The
    // trail still holds B and C, so Back returns to C first.
    await relationshipButton(drawer, "rel-a").click();
    await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();

    // Self-link: clicking an issue's own dependency does not grow the trail,
    // so Back still lands on the previous step and never on itself.
    await relationshipButton(drawer, "rel-c").click();
    await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
    expect(new URL(page.url()).searchParams.get("issue")).toBe("rel-b");
  });

  test("closing and reopening the drawer resets the trail", async ({ page }) => {
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    const reopened = await openIssueFromBoard(page, "Issue A");
    await expect(reopened.getByRole("tab", { name: "Overview", exact: true })).toHaveAttribute("aria-selected", "true");
    await openDependenciesTab(reopened);
    await expect(backButton(reopened)).toHaveCount(0);
  });

  test("switching projects resets the trail", async ({ page }) => {
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    // The drawer overlay blocks the sidebar, so close first — as a user would.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: /^beta/ }).click();
    await expect(page.getByRole("heading", { name: "beta" })).toBeVisible();

    const betaDrawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(betaDrawer);
    await expect(backButton(betaDrawer)).toHaveCount(0);
  });

  test("a direct URL load starts without a trail", async ({ page }) => {
    await page.goto(`/?project=${encodeURIComponent(alphaPath)}&issue=rel-b`);
    let drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
    await openDependenciesTab(drawer);
    await expect(backButton(drawer)).toHaveCount(0);

    // Relationship navigation from a direct load still builds a trail.
    await relationshipButton(drawer, "rel-c").click();
    drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
  });

  test("browser Back and Forward stay sensible with an app-managed trail", async ({ page }) => {
    await page.goto("/");
    await openIssueFromBoard(page, "Issue A");
    const drawer = page.getByRole("dialog");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    // Relationship steps replace the drawer entry, so browser Back returns to
    // the board rather than replaying trail steps.
    await page.goBack();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("issue")).toBeNull();

    await page.goForward();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Issue B" })).toBeVisible();
    await expect(backButton(page.getByRole("dialog"))).toHaveCount(0);
  });

  test("the Back button is keyboard-operable", async ({ page }) => {
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    await backButton(drawer).focus();
    await page.keyboard.press("Enter");
    await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();
  });

  test("closing returns focus to the original board trigger", async ({ page }) => {
    await page.goto("/");
    await openIssueFromBoard(page, "Issue A");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Closing from the card-open state restores focus to the board card.
    await expect(page.getByRole("button", { name: /.*Issue A/ }).first()).toBeFocused();
  });

  test("closing after relationship navigation does not strand focus on a removed button", async ({ page }) => {
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await expect(page.getByRole("button", { name: /.*Issue A/ }).first()).toBeFocused();
  });

  test("returns focus to the list row after relationship navigation", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "List", exact: true }).click();
    const row = page.getByRole("region", { name: "Issue list" })
      .getByRole("button", { name: "Issue A", exact: true });
    await row.focus();
    await row.press("Enter");
    const drawer = page.getByRole("dialog");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(row).toBeFocused();
  });

  test("Back remains available when a linked issue fails to load", async ({ page }) => {
    await page.route("**/api/projects/*/issues/rel-b", (route) =>
      route.fulfill({ status: 404, json: { error: "not found" } }),
    );
    await page.goto("/");
    const drawer = await openIssueFromBoard(page, "Issue A");
    await openDependenciesTab(drawer);
    await relationshipButton(drawer, "rel-b").click();
    await expect(drawer.getByText(/failed to load issue/)).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("follows the trail and steps back on a phone-sized screen", async ({ page }) => {
      await page.goto("/");
      const drawer = await openIssueFromBoard(page, "Issue A");
      await openDependenciesTab(drawer);
      await relationshipButton(drawer, "rel-b").click();
      await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
      await relationshipButton(drawer, "rel-c").click();
      await expect(drawer.getByRole("heading", { name: "Issue C" })).toBeVisible();

      await backButton(drawer).click();
      await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
      await backButton(drawer).click();
      await expect(drawer.getByRole("heading", { name: "Issue A" })).toBeVisible();

      if (process.env.UPDATE_SCREENSHOTS) {
        await relationshipButton(drawer, "rel-b").click();
        await expect(drawer.getByRole("heading", { name: "Issue B" })).toBeVisible();
        await page.screenshot({
          path: "docs/screenshots/drawer-back-mobile.png",
          animations: "disabled",
        });
      }
    });
  });
});

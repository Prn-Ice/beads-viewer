import { expect, test } from "@playwright/test";
import type { EpicChild } from "../../src/lib/epic-progress";
import type { BeadsIssue, IssueListResponse } from "../../src/lib/types";

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

// 9 direct children, 5 closed: the denominator must stay 9 no matter how the
// board or the drawer list is filtered.
const epic = makeIssue("epic-root", "Release epic", { issue_type: "epic" });

const epicChildren: EpicChild[] = [
  { id: "epic-c1", title: "Open child one", status: "open", issue_type: "task" },
  { id: "epic-c2", title: "Open child two", status: "open", issue_type: "task" },
  { id: "epic-c3", title: "Blocked child", status: "blocked", issue_type: "task" },
  { id: "epic-c4", title: "Deferred child", status: "deferred", issue_type: "task" },
  { id: "epic-c5", title: "Closed child one", status: "closed", issue_type: "task" },
  { id: "epic-c6", title: "Closed child two", status: "closed", issue_type: "task" },
  { id: "epic-c7", title: "Closed child three", status: "closed", issue_type: "task" },
  { id: "epic-c8", title: "Closed child four", status: "closed", issue_type: "task" },
  { id: "epic-c9", title: "Closed child five", status: "closed", issue_type: "task" },
];

// A nested epic with its own (smaller) child set.
const nestedChildren: EpicChild[] = [
  { id: "epic-n1", title: "Nested open child", status: "open", issue_type: "task" },
  { id: "epic-n2", title: "Nested closed child", status: "closed", issue_type: "task" },
];

function childAsIssue(child: EpicChild): BeadsIssue {
  return makeIssue(child.id, child.title, { status: child.status, issue_type: child.issue_type ?? "task" });
}

interface StubOptions {
  board?: BeadsIssue[];
  children?: EpicChild[];
  nestedChildren?: EpicChild[];
  childrenStatus?: number;
}

async function stubEpic(page: import("@playwright/test").Page, options: StubOptions = {}) {
  const board = options.board ?? [epic];
  const children = options.children ?? epicChildren;
  const childStatus = options.childrenStatus ?? 200;

  for (const scope of ["open", "all"]) {
    await page.route(`**/api/projects/*/issues?scope=${scope}`, async (route) => {
      const body: IssueListResponse = { issues: board, readyIds: [] };
      await route.fulfill({ json: body });
    });
  }
  for (const issue of [...board, ...children.map(childAsIssue)]) {
    await page.route(`**/api/projects/*/issues/${issue.id}`, async (route) => {
      await route.fulfill({ json: issue });
    });
  }
  await page.route("**/api/projects/*/issues/*/comments", (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`**/api/projects/*/issues/epic-root/children`, async (route) => {
    if (childStatus !== 200) {
      await route.fulfill({ status: childStatus, json: { error: "boom" } });
    } else {
      await route.fulfill({ json: children });
    }
  });
  if (options.nestedChildren !== undefined) {
    await page.route(`**/api/projects/*/issues/epic-nest/children`, (route) =>
      route.fulfill({ json: options.nestedChildren }),
    );
  }
}

async function openEpicDrawer(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /epic-root.*Release epic/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
  return drawer;
}

function expandChildren(drawer: import("@playwright/test").Locator) {
  return drawer.locator("summary", { hasText: "Children" }).click();
}

function childButton(drawer: import("@playwright/test").Locator, id: string) {
  return drawer.getByRole("button", { name: new RegExp(`^${id} `) });
}

function backButton(drawer: import("@playwright/test").Locator) {
  return drawer.getByRole("button", { name: "Back", exact: true });
}

test.describe("epic progress", () => {
  test("long child identifiers and titles fit on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    const id = `epic-${"long-child-id-".repeat(6)}`;
    await stubEpic(page, { children: [{ id, title: "A very long child title ".repeat(6), status: "in_progress" }] });
    const drawer = await openEpicDrawer(page);
    await expandChildren(drawer);
    const child = childButton(drawer, id);
    await expect(child).toBeVisible();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(child.getByText(/^in progress$/i)).toBeInViewport({ ratio: 1 });
  });
  test("shows closed/total from ALL children and Show closed only filters the list", async ({ page }) => {
    await stubEpic(page);
    const drawer = await openEpicDrawer(page);

    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();
    const bar = drawer.getByRole("progressbar", { name: "Epic progress" });
    await expect(bar).toHaveAttribute("aria-valuenow", "5");
    await expect(bar).toHaveAttribute("aria-valuemax", "9");
    await expect(bar).toHaveAttribute("aria-valuemin", "0");

    // Closed children are hidden from the list by default; the summary count
    // reflects the filtered list while the progress stays at 5 of 9.
    await expandChildren(drawer);
    await expect(childButton(drawer, "epic-c1")).toBeVisible();
    await expect(childButton(drawer, "epic-c5")).toHaveCount(0);
    await expect(drawer.getByText("4 of 9", { exact: true })).toBeVisible();

    await drawer.getByRole("checkbox", { name: "Show closed" }).check();
    await expect(childButton(drawer, "epic-c5")).toBeVisible();
    await expect(drawer.getByText("9 of 9", { exact: true })).toBeVisible();
    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();

    await drawer.getByRole("checkbox", { name: "Show closed" }).uncheck();
    await expect(childButton(drawer, "epic-c5")).toHaveCount(0);
    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();

    if (process.env.UPDATE_SCREENSHOTS) {
      await drawer.getByRole("checkbox", { name: "Show closed" }).check();
      await page.screenshot({
        path: "docs/screenshots/epic-progress-desktop.png",
        animations: "disabled",
      });
    }
  });

  test("board scope and search never change the denominator", async ({ page }) => {
    await stubEpic(page);
    const drawer = await openEpicDrawer(page);
    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();

    // The drawer overlay blocks the header, so close it first — as a user would.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search issues" }).fill("release");
    await page.getByRole("button", { name: /epic-root.*Release epic/ }).click();

    const reopened = page.getByRole("dialog");
    await expect(reopened.getByText("5 of 9 closed")).toBeVisible();
    await expandChildren(reopened);
    await expect(childButton(reopened, "epic-c5")).toHaveCount(0);
    await expect(reopened.getByText("5 of 9 closed")).toBeVisible();
  });

  test("an empty epic shows an explicit empty state without recursion", async ({ page }) => {
    await stubEpic(page, { children: [] });
    const drawer = await openEpicDrawer(page);
    await expect(drawer.getByText("0 of 0 closed")).toBeVisible();
    await expandChildren(drawer);
    await expect(drawer.getByText("No children yet.")).toBeVisible();
    await expect(drawer.getByRole("checkbox", { name: "Show closed" })).toHaveCount(0);
    await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
  });

  test("a child without a parent record opens cleanly and Back returns to the epic", async ({ page }) => {
    await stubEpic(page);
    const drawer = await openEpicDrawer(page);
    await expandChildren(drawer);
    // epic-c1's show data has no parent field (missing parent): it still opens.
    await childButton(drawer, "epic-c1").click();
    await expect(drawer.getByRole("heading", { name: "Open child one" })).toBeVisible();
    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();
  });

  test("a nested epic opens its own drawer with its own progress", async ({ page }) => {
    await stubEpic(page, {
      children: [...epicChildren, { id: "epic-nest", title: "Nested epic", status: "open", issue_type: "epic" }],
      nestedChildren,
    });
    const drawer = await openEpicDrawer(page);
    await expect(drawer.getByText("5 of 10 closed")).toBeVisible();
    await expandChildren(drawer);
    await childButton(drawer, "epic-nest").click();

    await expect(drawer.getByRole("heading", { name: "Nested epic" })).toBeVisible();
    await expect(drawer.getByText("1 of 2 closed")).toBeVisible();
    await expandChildren(drawer);
    await expect(childButton(drawer, "epic-n2")).toHaveCount(0);

    await backButton(drawer).click();
    await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
    await expect(drawer.getByText("5 of 10 closed")).toBeVisible();
  });

  test("a children load failure shows an explicit error and Retry recovers", async ({ page }) => {
    await stubEpic(page, { childrenStatus: 500 });
    const drawer = await openEpicDrawer(page);

    await expect(drawer.getByText(/failed to load children/)).toBeVisible();

    // Registered after stubEpic, so this route wins for the retry.
    await page.route(`**/api/projects/*/issues/epic-root/children`, (route) =>
      route.fulfill({ json: epicChildren }),
    );
    await drawer.getByRole("button", { name: "Retry" }).click();
    await expect(drawer.getByText("5 of 9 closed")).toBeVisible();
    await expect(drawer.getByText(/failed to load children/)).toHaveCount(0);
  });

  test("children expand and open with the keyboard, and Back walks the trail", async ({ page }) => {
    await stubEpic(page);
    const drawer = await openEpicDrawer(page);

    const summary = drawer.locator("summary", { hasText: "Children" });
    await summary.focus();
    await summary.press("Enter");
    await expect(drawer.getByRole("checkbox", { name: "Show closed" })).toBeVisible();

    const child = childButton(drawer, "epic-c1");
    await child.focus();
    await child.press("Enter");
    await expect(drawer.getByRole("heading", { name: "Open child one" })).toBeVisible();

    await backButton(drawer).focus();
    await backButton(drawer).press("Enter");
    await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
  });

  test.describe("mobile", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("expands, opens a child, and steps back on a phone-sized screen", async ({ page }) => {
      await stubEpic(page);
      const drawer = await openEpicDrawer(page);
      await expect(drawer.getByText("5 of 9 closed")).toBeVisible();

      await expandChildren(drawer);
      const child = childButton(drawer, "epic-c2");
      await child.focus();
      await child.press("Enter");
      await expect(drawer.getByRole("heading", { name: "Open child two" })).toBeVisible();

      await backButton(drawer).click();
      await expect(drawer.getByRole("heading", { name: "Release epic" })).toBeVisible();
      await expect(drawer.getByText("5 of 9 closed")).toBeVisible();

      if (process.env.UPDATE_SCREENSHOTS) {
        await expandChildren(drawer);
        await drawer.getByRole("checkbox", { name: "Show closed" }).check();
        await page.screenshot({
          path: "docs/screenshots/epic-progress-mobile.png",
          animations: "disabled",
        });
      }
    });
  });
});

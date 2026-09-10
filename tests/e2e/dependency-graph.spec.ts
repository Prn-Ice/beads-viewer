import { expect, test, type Page } from "@playwright/test";
import type { EpicChild } from "../../src/lib/epic-progress";
import type { BeadsIssue, DependencyRef } from "../../src/lib/types";

const link = (id: string, type = "blocks", status?: string): DependencyRef => ({
  id,
  title: `Issue ${id}`,
  dependency_type: type,
  priority: 1,
  ...(status ? { status } : {}),
});
function issue(
  id: string,
  dependencies: DependencyRef[] = [],
  dependents: DependencyRef[] = [],
  extra: Partial<BeadsIssue> = {},
): BeadsIssue {
  return {
    id,
    title: `Issue ${id}`,
    status: "open",
    priority: 2,
    dependencies,
    dependents,
    dependency_count: dependencies.length,
    dependent_count: dependents.length,
    comment_count: 0,
    ...extra,
  };
}

// Neighborhood around alpha-1: a closed blocker (b), typed edges
// (parent-child/related/conditional), an unresolved reference, and a dependent
// chain d -> e -> alpha-1 that forms a cycle when e is expanded.
const alpha1 = issue(
  "alpha-1",
  [
    link("b", "blocks", "closed"),
    link("parent-relation", "parent-child"),
    link("rel", "related"),
    link("cond", "conditional"),
    { type: "blocks" }, // unresolved reference, no id
  ],
  [link("d")],
  { status: "in_progress", priority: 0, parent: "epic-root" },
);
const b = issue("b", [link("c")], [], { status: "closed" });
const d = issue("d", [], [link("e")]);
const e = issue("e", [], [link("alpha-1")]);
const epicRoot = issue("epic-root", [], [], { issue_type: "epic" });

const epicChildren: EpicChild[] = [
  { id: "alpha-1", title: "Fix crash on startup", status: "in_progress", issue_type: "bug" },
  { id: "epic-c1", title: "Open child", status: "open", issue_type: "task" },
  { id: "epic-c2", title: "Closed child", status: "closed", issue_type: "task" },
];

const data: Record<string, BeadsIssue> = { "alpha-1": alpha1, b, d, e, "epic-root": epicRoot, "epic-c1": issue("epic-c1", [link("epic-c2"), link("outside")]) };

/** Records relationships=all requests by issue id. */
async function stubRelationships(page: Page, records: Record<string, BeadsIssue>, requests: string[]) {
  await page.route("**/issues/*?relationships=all", async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    requests.push(id);
    const record = records[id];
    await route.fulfill({ status: record ? 200 : 404, json: record ?? { error: "missing" } });
  });
}

interface StubOptions {
  records?: Record<string, BeadsIssue>;
  children?: EpicChild[];
}

async function setup(page: Page, options: StubOptions = {}) {
  const requests: string[] = [];
  const records = options.records ?? data;
  await stubRelationships(page, records, requests);
  // Drawer issue loads: any /issues/{id} without a query and not /comments.
  await page.route(
    (url) => url.pathname.includes("/issues/") && !url.search && !url.pathname.endsWith("/comments"),
    (route) => {
      const id = decodeURIComponent(route.request().url().split("/").pop()!);
      const record = records[id];
      return route.fulfill({ status: record ? 200 : 404, json: record ?? { error: "missing" } });
    },
  );
  await page.route("**/issues/epic-root/children", (route) =>
    route.fulfill({ json: options.children ?? epicChildren }),
  );
  await page.route("**/issues/*/comments", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Fix crash/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
  return { drawer, requests };
}

function openGraph(drawer: import("@playwright/test").Locator) {
  return drawer.locator("summary", { hasText: "Dependency graph" }).click();
}

function graphRegion(drawer: import("@playwright/test").Locator) {
  return drawer.getByRole("region", { name: "Dependency graph", exact: true });
}

/** Locates the SVG edge group between two nodes of a given type. */
function edgeLocator(container: import("@playwright/test").Locator, from: string, to: string, type: string) {
  return container.locator(`g[data-edge="${from}>${to}:${type}"]`);
}

function expandNodeButton(drawer: import("@playwright/test").Locator, id: string) {
  return drawer.getByRole("button", { name: `Expand node ${id}`, exact: true });
}

for (const width of [1280, 390]) {
  test(`shows a typed neighborhood, expands on demand, and stays bounded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { drawer, requests } = await setup(page);
    expect(requests).toEqual([]);
    await openGraph(drawer);

    // The root loads on demand; its immediate neighborhood appears.
    await expect(graphRegion(drawer).getByRole("button", { name: /alpha-1: Issue alpha-1/ })).toBeVisible();
    await expect(graphRegion(drawer).getByRole("button", { name: /b: Issue b/ })).toBeVisible();
    await expect(graphRegion(drawer).getByRole("button", { name: /d: Issue d/ })).toBeVisible();
    await expect.poll(() => requests).toEqual(["alpha-1"]);
    // The graph is wider than the bounded preview (upstream left, root center,
    // downstream right); scroll the root into view so the assertion is about
    // the visible canvas, not the off-screen area.
    await graphRegion(drawer).scrollIntoViewIfNeeded();
    await expect(graphRegion(drawer).getByRole("button", { name: /alpha-1: Issue alpha-1/ })).toBeInViewport({ ratio: 1 });
    await expect(graphRegion(drawer).getByRole("button", { name: /b: Issue b/ })).toContainText("P1");

    // The typed legend explains every relationship; edge labels are contextual
    // (only the hovered/focused edge shows its type).
    await expect(drawer).toContainText("parent-child");
    await expect(drawer).toContainText("related");
    await expect(drawer).toContainText("other/unknown");
    await expect(drawer.getByText(/The arrow points from the blocked issue/)).toBeVisible();
    // The conditional edge is present; its label is revealed on hover/focus.
    await expect(edgeLocator(graphRegion(drawer), "alpha-1", "cond", "conditional")).toHaveCount(1);

    // Closed nodes are never expanded.
    await expect(expandNodeButton(drawer, "b")).toHaveCount(0);
    await expect(graphRegion(drawer).getByRole("button", { name: /b: Issue b/ })).toContainText("closed");

    // Expanding a node fetches exactly one record and adds one more hop.
    await expandNodeButton(drawer, "d").click();
    await expect(graphRegion(drawer).getByRole("button", { name: /e: Issue e/ })).toBeVisible();
    await expect.poll(() => requests).toEqual(["alpha-1", "d"]);

    // Expanding e exposes the cycle back to alpha-1 and stops there.
    await expandNodeButton(drawer, "e").click();
    await expect(edgeLocator(graphRegion(drawer), "alpha-1", "e", "blocks")).toHaveCount(1);
    await expect(drawer.getByText("Loops are marked; each issue appears once.")).toBeVisible();
    await expect.poll(() => requests).toEqual(["alpha-1", "d", "e"]);

    // Unresolved references are terminal: no request is ever made for them.
    await expect(graphRegion(drawer).getByRole("button", { name: /unknown issue/i })).toBeVisible();
    expect(requests).not.toContain("__missing__");

    await graphRegion(drawer).evaluate((element) => {
      element.scrollTop = 0;
      element.scrollLeft = 0;
    });
    await graphRegion(drawer).scrollIntoViewIfNeeded();
    // Center the root node horizontally so the preview screenshot shows the
    // upstream-left / root-center / downstream-right layout.
    await graphRegion(drawer).evaluate((element) => {
      const root = element.querySelector('[aria-current="true"]') as HTMLElement | null;
      if (root) {
        const rootLeft = root.getBoundingClientRect().left - element.getBoundingClientRect().left + element.scrollLeft;
        element.scrollLeft = Math.max(0, rootLeft - (element.clientWidth - root.offsetWidth) / 2);
        const rootTop = root.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
        element.scrollTop = Math.max(0, rootTop - (element.clientHeight - root.offsetHeight) / 2);
      }
    });
    if (width === 390) {
      // The dialog itself never overflows horizontally on mobile.
      expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      if (process.env.UPDATE_SCREENSHOTS) {
        await page.screenshot({ path: "docs/screenshots/dependency-graph-390.png", animations: "disabled" });
      }
    } else if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: "docs/screenshots/dependency-graph-1280.png", animations: "disabled" });
    }

    // Selecting a node opens the existing drawer and Back returns.
    await graphRegion(drawer).getByRole("button", { name: /d: Issue d/ }).click();
    await expect(drawer.getByRole("heading", { name: "Issue d" })).toBeVisible();
    await drawer.getByRole("button", { name: "Back", exact: true }).click();
    await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();
  });
}

test("keyboard users can expand nodes, open them, and use the list view", async ({ page }) => {
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await graphRegion(drawer).getByRole("button", { name: /alpha-1: Issue alpha-1/ }).focus();
  await page.keyboard.press("Tab");
  const expand = expandNodeButton(drawer, "d");
  await expand.focus();
  await expand.press("Enter");
  await expect(graphRegion(drawer).getByRole("button", { name: /e: Issue e/ })).toBeVisible();

  const nodeD = graphRegion(drawer).getByRole("button", { name: /d: Issue d/ });
  await nodeD.focus();
  await nodeD.press("Enter");
  await expect(drawer.getByRole("heading", { name: "Issue d" })).toBeVisible();
  await drawer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();

  // A fresh drawer session opens on the preserved Dependencies tab; reopen the
  // graph and use the accessible list view.
  await openGraph(drawer);
  await drawer.locator("summary", { hasText: "List view" }).click();
  await expect(drawer.getByText(/^d: Issue d/).first()).toBeVisible();
  // The accessible list retains every edge label even though the canvas only
  // shows labels contextually on hover/focus.
  await expect(drawer.getByText(/\(conditional\)/).first()).toBeVisible();
  await drawer.getByRole("button", { name: "Expand node d in list", exact: true }).click();
  await expect(drawer.getByRole("button", { name: "Expand node e in list", exact: true })).toBeVisible();
  await drawer.getByRole("button", { name: "Expand node e in list", exact: true }).click();
  await expect(drawer.getByText(/^alpha-1 → e/).first()).toBeVisible();
  await expect(drawer.getByText(/cycle, not expanded/).first()).toBeVisible();
});

test("epic scope shows the parent epic and ALL direct children, denominator unfiltered", async ({ page }) => {
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await drawer.getByRole("button", { name: /Scope to parent epic epic-root/ }).click();

  await expect(graphRegion(drawer).getByRole("button", { name: /epic-root: Issue epic-root/ })).toBeVisible();
  await expect(graphRegion(drawer).getByRole("button", { name: /epic-c1: Open child/ })).toBeVisible();
  // Closed children are included: the denominator is never filtered.
  await expect(graphRegion(drawer).getByRole("button", { name: /epic-c2: Closed child/ })).toContainText("closed");
  await expect(drawer.getByText("3 direct children (all statuses)")).toBeVisible();
  await expandNodeButton(drawer, "epic-c1").click();
  await drawer.locator("summary", { hasText: "List view" }).click();
  await expect(drawer.getByText(/^epic-c1 → epic-c2 \(blocks\)/)).toBeVisible();
  await expect(graphRegion(drawer).getByRole("button", { name: /outside:/ })).toHaveCount(0);

  await drawer.getByRole("button", { name: "Back to neighborhood" }).click();
  await expect(graphRegion(drawer).getByRole("button", { name: /b: Issue b/ })).toBeVisible();
});

test("a root epic scopes to itself", async ({ page }) => {
  const requests: string[] = [];
  for (const scope of ["open", "all"]) {
    await page.route(`**/issues?scope=${scope}`, (route) =>
      route.fulfill({ json: { issues: [epicRoot], readyIds: [], childCounts: {} } }),
    );
  }
  await stubRelationships(page, { "epic-root": epicRoot }, requests);
  await page.route("**/issues/epic-root", (route) => route.fulfill({ json: epicRoot }));
  await page.route("**/issues/epic-root/children", (route) =>
    route.fulfill({ json: [{ id: "epic-x1", title: "Only child", status: "open", issue_type: "task" }] }),
  );
  await page.route("**/issues/*/comments", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: /epic-root.*Issue epic-root/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Issue epic-root" })).toBeVisible();
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
  await openGraph(drawer);
  await drawer.getByRole("button", { name: "Scope to this epic", exact: true }).click();
  await expect(graphRegion(drawer).getByRole("button", { name: /epic-x1: Only child/ })).toBeVisible();
  await expect.poll(() => requests).toEqual(["epic-root"]);
});

test("a failed node load shows an explicit error and Retry recovers", async ({ page }) => {
  const failing = issue("alpha-1", [link("ghost")]);
  const requests: string[] = [];
  await page.route("**/issues/*?relationships=all", async (route) => {
    const id = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop()!);
    requests.push(id);
    if (id === "ghost") return route.fulfill({ status: 404, json: { error: "missing" } });
    return route.fulfill({ json: id === "alpha-1" ? failing : issue(id) });
  });
  await page.route("**/issues/alpha-1", (route) => route.fulfill({ json: failing }));
  await page.route("**/issues/*/comments", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Fix crash/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
  await openGraph(drawer);
  await expandNodeButton(drawer, "ghost").click();
  await expect(drawer.getByText(/ghost: Couldn.t load this issue/)).toBeVisible();
  await expect.poll(() => requests).toEqual(["alpha-1", "ghost"]);

  // Register the fixed route after, so the retry succeeds and expands.
  await page.route("**/issues/ghost?relationships=all", (route) => route.fulfill({ json: issue("ghost") }));
  await drawer.getByRole("button", { name: "Retry ghost", exact: true }).click();
  await expect(drawer.getByText(/ghost: Couldn.t load this issue/)).toHaveCount(0);
  await expect(drawer.getByRole("button", { name: "Collapse node ghost", exact: true })).toBeVisible();
});

test("a wide root truncates at the node limit with an explicit note", async ({ page }) => {
  const wide = issue("alpha-1", Array.from({ length: 40 }, (_, i) => link(`wide-${i}`)));
  await page.route("**/issues/*?relationships=all", (route) => route.fulfill({ json: wide }));
  await page.route("**/issues/alpha-1", (route) => route.fulfill({ json: alpha1 }));
  await page.route("**/issues/*/comments", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Fix crash/ }).click();
  const drawer = page.getByRole("dialog");
  await drawer.getByRole("tab", { name: /Dependencies/ }).click();
  await openGraph(drawer);
  await expect(drawer.getByText(/Only the first 30 issues are shown/)).toBeVisible();
});

test("board polling never triggers per-issue graph requests", async ({ page }) => {
  const { drawer, requests } = await setup(page);
  await openGraph(drawer);
  await expect(graphRegion(drawer).getByRole("button", { name: /d: Issue d/ })).toBeVisible();
  await expect.poll(() => requests).toEqual(["alpha-1"]);

  await page.route("**/issues?scope=open", (route) =>
    route.fulfill({ json: { issues: [alpha1], readyIds: ["alpha-1"], childCounts: {} } }),
  );
  await expect(expandNodeButton(drawer, "d").first()).toBeVisible();
  await page.waitForTimeout(4000);
  expect(requests).toEqual(["alpha-1"]);
});

test("collapsing one branch preserves another branch's expansion", async ({ page }) => {
  const records = {
    "alpha-1": issue("alpha-1", [link("b"), link("d")]),
    b: issue("b", [link("c")]), d: issue("d", [link("e")]), e: issue("e", [link("tail")]),
  };
  const { drawer } = await setup(page, { records });
  await openGraph(drawer);
  await expandNodeButton(drawer, "b").click();
  await expandNodeButton(drawer, "d").click();
  await expandNodeButton(drawer, "e").click();
  await expect(graphRegion(drawer).getByRole("button", { name: /tail:/ })).toBeVisible();
  await drawer.getByRole("button", { name: "Collapse node b", exact: true }).click();
  await expect(graphRegion(drawer).getByRole("button", { name: /tail:/ })).toBeVisible();
  await expect(graphRegion(drawer).getByRole("button", { name: /c:/ })).toHaveCount(0);
});

test("leaving epic scope cancels a late response", async ({ page }) => {
  const { drawer } = await setup(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let finished = false;
  await page.route("**/issues/epic-root/children", async (route) => {
    await gate;
    await route.fulfill({ json: epicChildren }).catch(() => {});
    finished = true;
  });
  await openGraph(drawer);
  const request = page.waitForRequest("**/issues/epic-root/children");
  await drawer.getByRole("button", { name: /Scope to parent epic/ }).click();
  await request;
  await drawer.getByRole("button", { name: "Back to neighborhood" }).click();
  release();
  await expect.poll(() => finished).toBe(true);
  await expect(drawer.getByRole("button", { name: "Back to neighborhood" })).toHaveCount(0);
  await expect(graphRegion(drawer).getByRole("button", { name: /alpha-1:/ })).toBeVisible();
});

function largeDialog(page: Page) {
  return page.getByRole("dialog", { name: "Dependency graph" });
}

function graphStage(dialog: import("@playwright/test").Locator) {
  return dialog.getByRole("region", { name: "Graph workspace", exact: true });
}

for (const width of [1280, 390]) {
  test(`large view reuses preview state with no refetch, Escape restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const { drawer, requests } = await setup(page);
    await openGraph(drawer);
    await expandNodeButton(drawer, "d").click();
    await expandNodeButton(drawer, "e").click();
    await expect.poll(() => requests).toEqual(["alpha-1", "d", "e"]);

    await drawer.getByRole("button", { name: "Expand graph", exact: true }).click();
    const dialog = largeDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
    const rootNode = dialog.getByRole("button", { name: /alpha-1: Issue alpha-1/ });
    await expect(rootNode).toBeInViewport({ ratio: 1 });
    expect((await rootNode.boundingBox())!.width).toBeGreaterThanOrEqual(180);
    expect((await graphStage(dialog).boundingBox())!.height).toBeGreaterThan(844 * 0.75);

    // The large view shares the exact loaded/expanded state: node e is present
    // and toggling the view triggers no new request.
    await expect(dialog.getByRole("button", { name: /e: Issue e/ })).toBeVisible();
    expect(requests).toEqual(["alpha-1", "d", "e"]);

    // Edge focus is exposed to assistive technology, not hidden by the SVG.
    const edge = dialog.getByRole("img", { name: /blocks edge from alpha-1 to b/ });
    const point = await edge.locator("path").first().evaluate((element) => {
      const path = element as SVGPathElement;
      const midpoint = path.getPointAtLength(path.getTotalLength() / 2);
      const screen = new DOMPoint(midpoint.x, midpoint.y).matrixTransform(path.getScreenCTM()!);
      return { x: screen.x, y: screen.y };
    });
    await page.mouse.move(point.x, point.y);
    await expect(edge.locator("text")).toBeVisible();
    await page.mouse.move(5, 5);
    await expect(edge.locator("text")).toHaveCount(0);
    await edge.focus();
    await expect(edge.locator("text")).toHaveText("blocks");
    await dialog.getByRole("button", { name: "Reset zoom" }).click();
    await expect(rootNode).toBeInViewport({ ratio: 1 });

    if (process.env.UPDATE_SCREENSHOTS) {
      await dialog.screenshot({ path: `docs/screenshots/dependency-graph-large-${width}.png`, animations: "disabled" });
    }

    // Escape closes the dialog and restores focus to the Expand graph trigger.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Expand graph", exact: true })).toBeFocused();

    // Preview state is preserved after toggling back.
    await expect(graphRegion(drawer).getByRole("button", { name: /e: Issue e/ })).toBeVisible();
    expect(requests).toEqual(["alpha-1", "d", "e"]);
  });
}

test("large view zoom in/out and fit controls work without body overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await drawer.getByRole("button", { name: "Expand graph", exact: true }).click();
  const dialog = largeDialog(page);
  await expect(dialog).toBeVisible();

  const stage = graphStage(dialog);
  const width = () => stage.getByRole("button", { name: /alpha-1: Issue alpha-1/ }).evaluate((el) => el.getBoundingClientRect().width);
  const before = await width();

  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect.poll(width).toBeGreaterThan(before);
  await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("125%");
  await dialog.getByRole("button", { name: "Expand node d", exact: true }).click();
  await expect(dialog.getByRole("button", { name: /e: Issue e/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("125%");

  await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
  await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
  await dialog.getByRole("button", { name: "Fit graph to view", exact: true }).click();
  const fits = await stage.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1);
  expect(fits).toBe(true);
  await dialog.getByRole("button", { name: "Reset zoom" }).click();
  await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("100%");
  await dialog.locator("summary", { hasText: "Graph details and list" }).click();
  await expect(dialog.getByRole("button", { name: /Scope to parent epic/ })).toBeVisible();

  // The page body itself never overflows horizontally on mobile or desktop.
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  ).toBe(true);
});

test("clicking a node in the large view opens the root drawer", async ({ page }) => {
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await drawer.getByRole("button", { name: "Expand graph", exact: true }).click();
  const dialog = largeDialog(page);
  await expect(dialog).toBeVisible();

  await dialog.getByRole("button", { name: /d: Issue d/ }).click();
  await expect(drawer.getByRole("heading", { name: "Issue d" })).toBeVisible();
  await drawer.getByRole("button", { name: "Back", exact: true }).click();
  await expect(drawer.getByRole("heading", { name: "Issue alpha-1" })).toBeVisible();
});

test("all three arrow markers share user-space geometry with the tip at the endpoint", async ({ page }) => {
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await expect(graphRegion(drawer).getByRole("button", { name: /alpha-1: Issue alpha-1/ })).toBeVisible();

  const markers = await graphRegion(drawer).locator("svg marker").evaluateAll((elements) =>
    elements.map((element) => {
      const marker = element as SVGMarkerElement;
      const path = marker.querySelector("path") as SVGGeometryElement | null;
      const box = path?.getBBox();
      return {
        markerUnits: marker.getAttribute("markerUnits"),
        markerWidth: marker.getAttribute("markerWidth"),
        markerHeight: marker.getAttribute("markerHeight"),
        viewBox: marker.getAttribute("viewBox"),
        refX: marker.getAttribute("refX"),
        refY: marker.getAttribute("refY"),
        orient: marker.getAttribute("orient"),
        d: path?.getAttribute("d"),
        width: box?.width ?? 0,
        height: box?.height ?? 0,
      };
    }),
  );
  expect(markers).toHaveLength(3);
  for (const marker of markers) {
    // Fixed user-space units: the arrowhead keeps one size on every edge,
    // regardless of the parent-child 2.5 vs 1.5 stroke width.
    expect(marker.markerUnits).toBe("userSpaceOnUse");
    expect(marker.markerWidth).toBe("8");
    expect(marker.markerHeight).toBe("8");
    expect(marker.viewBox).toBe("0 0 8 8");
    // refX sits exactly on the triangle tip (right edge), refY at the center,
    // so the tip lands on the path endpoint and never detaches.
    expect(marker.refX).toBe("8");
    expect(marker.refY).toBe("4");
    expect(marker.orient).toBe("auto");
    expect(marker.width).toBeCloseTo(8, 1);
    expect(marker.height).toBeCloseTo(8, 1);
  }
  // The three types share identical geometry; only the fill differs.
  expect(new Set(markers.map((marker) => `${marker.viewBox}|${marker.d}|${marker.width}|${marker.height}`)).size).toBe(1);
});

test("arrowheads stay proportional to the graph at 125% and 80% zoom with no clamp", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 844 });
  const { drawer } = await setup(page);
  await openGraph(drawer);
  await drawer.getByRole("button", { name: "Expand graph", exact: true }).click();
  const dialog = largeDialog(page);
  await expect(dialog).toBeVisible();

  async function arrowSize() {
    return dialog.getByRole("group", { name: "Dependency connections" }).evaluate((svg) => {
      const markerPath = svg.querySelector("marker path") as SVGGeometryElement | null;
      const userSize = markerPath?.getBBox().width ?? 0;
      const edge = svg.querySelector("g[data-edge] path[stroke-width]") as SVGPathElement | null;
      const ctm = edge?.getScreenCTM();
      const scale = ctm ? Math.hypot(ctm.a, ctm.b) : 0;
      return { userSize, screenSize: userSize * scale };
    });
  }

  const base = await arrowSize();
  expect(base.userSize).toBeCloseTo(8, 1);

  await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("125%");
  const zoomed = await arrowSize();
  expect(zoomed.userSize).toBe(base.userSize); // user-space geometry never changes
  expect(zoomed.screenSize).toBeCloseTo(base.screenSize * 1.25, 1);

  await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
  await dialog.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "Reset zoom" })).toHaveText("80%");
  const out = await arrowSize();
  expect(out.userSize).toBe(base.userSize);
  expect(out.screenSize).toBeCloseTo(base.screenSize * 0.8, 1);
});

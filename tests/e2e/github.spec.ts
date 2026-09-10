import { expect, test, type Page } from "@playwright/test";

const SUMMARY = {
  total_issues: 3,
  open_issues: 2,
  in_progress_issues: 1,
  blocked_issues: 0,
  closed_issues: 0,
  deferred_issues: 0,
  ready_issues: 2,
  pinned_issues: 0,
};

const GH_PATH = "/cache/gh/o/r1";
const GH_PROJECT = {
  id: encodeURIComponent(GH_PATH),
  name: "o/r1",
  path: GH_PATH,
  source: "github",
  summary: SUMMARY,
};

const GH_ISSUE = {
  id: "gh-1",
  title: "Remote issue from GitHub",
  status: "open",
  priority: 1,
  issue_type: "task",
  labels: [],
  created_at: "2026-09-01T10:00:00Z",
  updated_at: "2026-09-02T10:00:00Z",
  dependency_count: 0,
  dependent_count: 0,
  comment_count: 0,
};

function repoList(page: Page, slugs: string[]) {
  return page.route("**/api/github/repos", (route) =>
    route.fulfill({ json: slugs.map((slug) => ({ slug })) }),
  );
}

// Intercepts /api/github/repos/<slug>; the handler decides per slug.
function repoLoads(
  page: Page,
  handler: (slug: string) => { delayMs?: number; body: unknown } | undefined,
) {
  return page.route("**/api/github/repos/*", async (route) => {
    const slug = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const plan = handler(slug);
    if (!plan) return route.fallback();
    if (plan.delayMs) await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
    return route.fulfill({ json: plan.body });
  });
}

test.describe("github projects", () => {
  test("locals render immediately and remote repos stream in sequentially", async ({ page }) => {
    const requestedAt: Record<string, number> = {};
    await repoList(page, ["o/slow", "o/fast"]);
    await repoLoads(page, (slug) => {
      if (!requestedAt[slug]) requestedAt[slug] = Date.now();
      if (slug === "o/slow") {
        // Generous delays: under a parallel e2e run the browser can stall long
        // enough that a short window closes before the assertions below poll.
        return { delayMs: 2500, body: { slug, state: "ok", project: { ...GH_PROJECT, name: "o/slow" } } };
      }
      if (slug === "o/fast") {
        return { delayMs: 1500, body: { slug, state: "ok", project: { ...GH_PROJECT, id: "x", path: "/cache/gh/o/fast", name: "o/fast" } } };
      }
      return undefined;
    });

    await page.goto("/");

    // Local projects show up right away, before any remote repo has synced.
    await expect(page.locator('[data-slot="sidebar"]').getByRole("button", { name: /alpha/ })).toBeVisible();
    await expect(page.getByRole("status", { name: "Syncing o/slow from GitHub" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Syncing o/fast from GitHub" })).toBeVisible();

    // The slow repo resolves first because loading is sequential: the fast
    // repo's request must not even start before the slow one finished.
    await expect(page.getByRole("button", { name: "o/slow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "o/fast" })).toHaveCount(0);
    await expect(page.getByRole("status", { name: "Syncing o/fast from GitHub" })).toBeVisible();
    await expect(page.getByRole("button", { name: "o/fast" })).toBeVisible();

    expect(requestedAt["o/fast"] - requestedAt["o/slow"]).toBeGreaterThanOrEqual(1000);
    await expect(page.getByRole("status", { name: /Syncing/ })).toHaveCount(0);
  });

  test("failed repos show an error row and repos without beads disappear", async ({ page }) => {
    await repoList(page, ["o/broken", "o/nobeans", "o/good"]);
    await repoLoads(page, (slug) => {
      if (slug === "o/broken") return { body: { slug, state: "error", message: "access denied" } };
      if (slug === "o/nobeans") return { body: { slug, state: "empty" } };
      if (slug === "o/good") {
        return { body: { slug, state: "ok", project: { ...GH_PROJECT, name: "o/good" } } };
      }
      return undefined;
    });

    await page.goto("/");

    await expect(page.getByRole("button", { name: "o/good" })).toBeVisible();
    await expect(page.getByRole("status", { name: "access denied" })).toBeVisible();
    await expect(page.getByText("o/nobeans")).toHaveCount(0);
  });

  test("deep link to a remote project waits for it without a not-found banner", async ({
    page,
  }) => {
    await repoList(page, ["o/deep"]);
    await repoLoads(page, (slug) =>
      slug === "o/deep"
        ? { delayMs: 800, body: { slug, state: "ok", project: { ...GH_PROJECT, name: "o/deep" } } }
        : undefined,
    );
    await page.route(`**/api/projects/${encodeURIComponent(GH_PATH)}/issues*`, (route) =>
      route.fulfill({ json: { issues: [GH_ISSUE], readyIds: [], childCounts: {} } }),
    );

    await page.goto(`/?project=${encodeURIComponent(GH_PATH)}`);
    const banner = page.getByText("Linked project was not found");

    // Locals load first; the banner must not flash while GitHub is syncing.
    await expect(page.locator('[data-slot="sidebar"]').getByRole("button", { name: /alpha/ })).toBeVisible();
    await expect(banner).toHaveCount(0);

    await expect(page.getByRole("button", { name: "o/deep" })).toBeVisible();
    await expect(page.getByRole("button", { name: /gh-1.*Remote issue from GitHub/ })).toBeVisible();
    await expect(banner).toHaveCount(0);
  });

  test("picker: choose a repo, save, and it streams into the sidebar", async ({ page }) => {
    // gh's repo list for the settings panel.
    await page.route("**/api/github/available", (route) =>
      route.fulfill({
        json: {
          repos: [
            { slug: "o/pick", private: false },
            { slug: "o/skip", private: true },
          ],
        },
      }),
    );

    // Config GET reflects a local file; capture what the UI PUTs.
    const configFile = { repos: [] as string[] };
    let putBody: unknown = null;
    await page.route("**/api/github/config", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        putBody = request.postDataJSON();
        configFile.repos = (putBody as { repos: string[] }).repos;
        return route.fulfill({ json: { repos: configFile.repos } });
      }
      return route.fulfill({
        json: { repos: configFile.repos, source: configFile.repos.length ? "file" : "none" },
      });
    });

    // The sweep's repo list is driven by the saved config.
    await page.route("**/api/github/repos", (route) =>
      route.fulfill({ json: configFile.repos.map((slug) => ({ slug })) }),
    );
    await repoLoads(page, (slug) =>
      slug === "o/pick"
        ? { body: { slug, state: "ok", project: { ...GH_PROJECT, name: "o/pick" } } }
        : undefined,
    );

    await page.goto("/");

    // Open settings from the gear button in the GitHub group label.
    await page.getByRole("button", { name: "GitHub repo settings" }).click();
    await expect(page.getByRole("heading", { name: "GitHub repositories" })).toBeVisible();

    // Check one repo and save.
    await page.getByRole("checkbox", { name: "o/pick" }).check();
    await page.getByRole("button", { name: "Save" }).click();

    // The saved repo streams into the sidebar; PUT carried the slug.
    await expect(page.getByRole("button", { name: "o/pick" })).toBeVisible();
    expect(putBody).toEqual({ repos: ["o/pick"] });
  });

  test("picker: unchecking all and saving empties the GitHub group", async ({ page }) => {
    await page.route("**/api/github/available", (route) =>
      route.fulfill({ json: { repos: [{ slug: "o/pick", private: false }] } }),
    );
    const configFile = { repos: ["o/pick"] as string[] };
    await page.route("**/api/github/config", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        configFile.repos = (request.postDataJSON() as { repos: string[] }).repos;
        return route.fulfill({ json: { repos: configFile.repos } });
      }
      return route.fulfill({
        json: { repos: configFile.repos, source: configFile.repos.length ? "file" : "none" },
      });
    });
    await page.route("**/api/github/repos", (route) =>
      route.fulfill({ json: configFile.repos.map((slug) => ({ slug })) }),
    );

    await page.goto("/");
    await page.getByRole("button", { name: "GitHub repo settings" }).click();
    await expect(page.getByRole("checkbox", { name: "o/pick" })).toBeVisible();
    await page.getByRole("checkbox", { name: "o/pick" }).uncheck();
    await page.getByRole("button", { name: "Save" }).click();

    // The group empties out (no repo rows).
    await expect(page.getByRole("button", { name: "o/pick" })).toHaveCount(0);
  });

  test("picker: keyboard — open settings, tab to a checkbox, toggle with space", async ({
    page,
  }) => {
    await page.route("**/api/github/available", (route) =>
      route.fulfill({ json: { repos: [{ slug: "o/kbd", private: false }] } }),
    );
    await page.route("**/api/github/config", (route) =>
      route.fulfill({ json: { repos: [], source: "none" } }),
    );
    await repoList(page, []);

    await page.goto("/");
    await page.getByRole("button", { name: "GitHub repo settings" }).click();
    const checkbox = page.getByRole("checkbox", { name: "o/kbd" });
    await expect(checkbox).toBeVisible();
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
  });
});

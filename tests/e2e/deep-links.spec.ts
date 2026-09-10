import path from "node:path";
import { expect, test } from "@playwright/test";

const alphaPath = path.resolve(__dirname, "../fixtures/projects/alpha");
const betaPath = path.resolve(__dirname, "../fixtures/projects/beta");

async function openDrawer(page: import("@playwright/test").Page) {
  await page.goto(`/?project=${encodeURIComponent(alphaPath)}&issue=alpha-1`);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  return drawer;
}

test("directly loads a bookmarked issue and restores project + drawer on reload", async ({ page }) => {
  const url = `/?foo=bar&project=${encodeURIComponent(alphaPath)}&issue=alpha-1`;
  await page.goto(url);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("project")).toBe(alphaPath);

  await page.reload();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^alpha \d+$/ })).toHaveAttribute("data-active");
});

for (const width of [1280, 390]) {
  test(`deep link loads at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`/?project=${encodeURIComponent(alphaPath)}&issue=alpha-1`);
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({
        path: `docs/screenshots/deep-links-${width}.png`,
        animations: "disabled",
      });
    }
  });
}

test("opening an issue pushes a history entry; Back closes, Forward reopens", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("issue")).toBe("alpha-1");

  await page.goBack();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("issue")).toBeNull();

  await page.goForward();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
});

test("closing the drawer removes the issue from the URL", async ({ page }) => {
  await page.goto("/?filter=keep#notes");
  await page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const params = new URL(page.url()).searchParams;
  expect(params.get("issue")).toBeNull();
  expect(params.get("project")).toBe(alphaPath);
  expect(params.get("filter")).toBe("keep");
  expect(new URL(page.url()).hash).toBe("#notes");
  await page.getByRole("button", { name: /^beta \d+$/ }).click();
  await expect(page.getByRole("heading", { name: "beta" })).toBeVisible();
  expect(new URL(page.url()).hash).toBe("#notes");
  expect(new URL(page.url()).searchParams.get("filter")).toBe("keep");
});

test("switching projects clears the open issue", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: /^beta \d+$/ }).click();
  await expect(page.getByRole("heading", { name: "beta" })).toBeVisible();
  const params = new URL(page.url()).searchParams;
  expect(params.get("issue")).toBeNull();
  expect(params.get("project")).toBe(betaPath);
});

test("a missing issue shows a predictable error in the drawer", async ({ page }) => {
  await page.goto(`/?project=${encodeURIComponent(alphaPath)}&issue=does-not-exist`);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText(/Couldn.t load this issue/)).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Retry" })).toBeVisible();
});

test("an invalid project normalizes without opening the issue in another project", async ({ page }) => {
  await page.goto("/?project=%2Fdoes%2Fnot%2Fexist&issue=alpha-1");
  await expect(page.getByRole("button", { name: /^alpha \d+$/ })).toHaveAttribute("data-active");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("Linked project was not found");
});

test.describe("copy link", () => {
  test("reports an unavailable clipboard API accessibly", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    });
    const drawer = await openDrawer(page);
    await drawer.getByRole("button", { name: "Copy link" }).click();
    await expect(drawer.getByRole("status")).toContainText("Copy failed");
  });
  test("copies a deep link preserving unrelated params and hash", async ({ page, context, baseURL }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: baseURL });
    await page.goto(
      `/?theme=forest&project=${encodeURIComponent(alphaPath)}&issue=alpha-1#notes`,
    );
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    await drawer.getByRole("button", { name: "Copy link" }).click();
    await expect(drawer.getByText("Link copied to clipboard")).toBeVisible();

    const link = await page.evaluate(() => navigator.clipboard.readText());
    const url = new URL(link);
    expect(url.origin).toBe(baseURL);
    expect(url.searchParams.get("project")).toBe(alphaPath);
    expect(url.searchParams.get("issue")).toBe("alpha-1");
    expect(url.searchParams.get("theme")).toBe("forest");
    expect(url.hash).toBe("#notes");
  });

  test("reports clipboard failure accessibly", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText: () => Promise.reject(new Error("denied")) },
        configurable: true,
      });
    });
    const drawer = await openDrawer(page);
    await drawer.getByRole("button", { name: "Copy link" }).click();
    await expect(drawer.getByText(/Copy failed/)).toBeVisible();
  });
});

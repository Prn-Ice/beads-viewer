import { expect, test } from "@playwright/test";

test.describe("board journey", () => {
  test("shows projects, a board with columns, and issue details", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: "alpha" })).toBeVisible();
    await expect(page.getByRole("button", { name: "beta" })).toBeVisible();

    for (const column of ["Ready", "In Progress", "Blocked", "Backlog"]) {
      await expect(page.getByRole("heading", { name: column, exact: true })).toBeVisible();
    }

    const card = page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ });
    await expect(card).toBeVisible();
    await card.click();

    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    await expect(drawer.getByText("The app", { exact: false })).toBeVisible();

    await drawer.getByRole("tab", { name: /Comments/ }).click();
    await expect(drawer.getByText("Fix merged in #42")).toBeVisible();
  });

  test("filters the board with search", async ({ page }) => {
    await page.goto("/");
    const search = page.getByRole("searchbox", { name: "Search issues" });
    await search.fill("export feature");
    await expect(page.getByRole("button", { name: /Add export feature/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Fix crash on startup/ })).toHaveCount(0);
  });

  test("shows closed issues in All scope", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Closed", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Retire legacy endpoint/ })).toBeVisible();
  });

  test("opens an issue with the keyboard", async ({ page }) => {
    await page.goto("/");
    const card = page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ });
    await card.focus();
    await card.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
  });

  test("switches between light and dark mode", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);
  });

  test("applies a color theme", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Forest" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "forest");
  });
});

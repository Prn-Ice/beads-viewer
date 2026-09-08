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

  test.describe("copy as markdown", () => {
    test("copies the issue snapshot as markdown", async ({ page, context, baseURL }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: baseURL,
      });
      await page.goto("/");
      await page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ }).click();
      const drawer = page.getByRole("dialog");
      await drawer.getByRole("button", { name: "Copy as Markdown" }).click();
      await expect(drawer.getByText("Copied to clipboard")).toBeVisible();

      const text = await page.evaluate(() => navigator.clipboard.readText());
      expect(text).toContain("# alpha-1 · Fix crash on startup");
      expect(text).toContain("**Project**:");
      expect(text).toContain("**Status**: in_progress");
      expect(text).toContain("## Description");
      expect(text).toContain("## Acceptance Criteria");
      expect(text).toContain("## Dependencies");
      expect(text).toContain("> Comments are not included in this copy.");
      expect(text).not.toContain("Reproduced");
      await page.evaluate(() => navigator.clipboard.writeText("Something else"));
      await drawer.getByRole("button", { name: "Copy as Markdown" }).click();
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    });

    test("reports clipboard failure accessibly", async ({ page }) => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: () => Promise.reject(new Error("denied")) },
          configurable: true,
        });
      });
      await page.goto("/");
      await page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ }).click();
      const drawer = page.getByRole("dialog");
      await drawer.getByRole("button", { name: "Copy as Markdown" }).click();
      await expect(drawer.getByText(/Copy failed/)).toBeVisible();
    });
  });

  test("switches between light and dark mode", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/dark/);
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/dark/);
    await page.keyboard.press("Escape");
  });

  for (const mode of ["Light", "Dark"] as const) {
    test(`color themes visibly update controls in ${mode.toLowerCase()} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: mode === "Light" ? "light" : "dark" });
      await page.goto("/");
      const project = page.getByRole("button", { name: /^alpha \d+$/ });
      const scope = page.getByRole("button", { name: "Open", exact: true });
      await expect(project).toHaveAttribute("data-active");
      await page.getByRole("button", { name: "Change theme" }).click();
      await page.getByRole("menuitemradio", { name: mode, exact: true }).click();
      const neutralProject = await project.evaluate((el) => getComputedStyle(el).backgroundColor);
      const neutralScope = await scope.evaluate((el) => getComputedStyle(el).backgroundColor);
      const colors = new Set<string>([neutralProject]);

      for (const color of ["Ocean", "Forest", "Rose"]) {
        const option = page.getByRole("menuitemradio", { name: color, exact: true });
        await option.click();
        await expect(option).toBeChecked();
        await expect(page.locator("html")).toHaveAttribute("data-theme", color.toLowerCase());
        await expect(project).not.toHaveCSS("background-color", neutralProject);
        await expect(scope).not.toHaveCSS("background-color", neutralScope);
        colors.add(await project.evaluate((el) => getComputedStyle(el).backgroundColor));
      }
      expect(colors.size).toBe(4);
      const roseProject = await project.evaluate((el) => getComputedStyle(el).backgroundColor);
      await page.reload();
      await expect(project).toHaveCSS("background-color", roseProject);
      await page.getByRole("button", { name: "Change theme" }).click();
      await expect(page.getByRole("menuitemradio", { name: "Rose", exact: true })).toBeChecked();
      await expect(page.getByRole("menuitemradio", { name: mode, exact: true })).toBeChecked();
      await page.getByRole("menuitemradio", { name: "Neutral", exact: true }).click();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      await expect(project).toHaveCSS("background-color", neutralProject);
      await expect(scope).toHaveCSS("background-color", neutralScope);
      await page.reload();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      await expect(project).toHaveCSS("background-color", neutralProject);
    });
  }

  test("preserves the color theme when system mode changes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await page.getByRole("button", { name: "Change theme" }).click();
    await page.getByRole("menuitemradio", { name: "System", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Forest" }).click();
    const project = page.getByRole("button", { name: /^alpha \d+$/ });
    const lightColor = await project.evaluate((el) => getComputedStyle(el).backgroundColor);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "forest");
    await expect(project).not.toHaveCSS("background-color", lightColor);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(project).toHaveCSS("background-color", lightColor);
  });
});

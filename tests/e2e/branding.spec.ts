import { expect, test, type Locator } from "@playwright/test";

async function expectHeaderAlignment(header: Locator) {
  await expect(header).toBeVisible();
  await expect(header.getByText("View Beads", { exact: true })).toHaveCount(0);
  await expect(header.getByText("Local issue dashboard", { exact: true })).toBeVisible();
  // Measure together so the mobile drawer animation cannot move between reads.
  const { logo, subtitle } = await header.evaluate((element) => ({
    logo: element.querySelector('img[alt="Beads"]')!.getBoundingClientRect().toJSON(),
    subtitle: [...element.querySelectorAll("span")]
      .find((span) => span.textContent === "Local issue dashboard")!.getBoundingClientRect().toJSON(),
  }));
  expect(logo).not.toBeNull();
  expect(subtitle).not.toBeNull();
  expect(logo!.width).toBe(28);
  expect(logo!.height).toBe(28);
  expect(subtitle!.x).toBeCloseTo(logo!.x, 0);
  expect(subtitle!.y - (logo!.y + logo!.height)).toBeCloseTo(8, 0);
}

for (const mode of ["light", "dark"] as const) {
  test(`official branding loads locally in ${mode} mode`, async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ colorScheme: mode });
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      if (!request.url().startsWith(`${baseURL}/`)) {
        externalRequests.push(request.url());
      }
    });
    await page.goto("/");
    const card = page.getByRole("button", { name: /alpha-1.*Fix crash on startup/ });
    await expect(card).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("body")).toHaveCSS("background-color", mode === "light" ? "rgb(249, 251, 250)" : "rgb(11, 14, 14)");
    expect(await page.evaluate(() => [...document.fonts].some((font) => font.family.includes("paperMono") && font.status === "loaded"))).toBe(true);
    await expect(page.locator("body")).toHaveCSS("font-feature-settings", '"cv02", "cv03", "cv04", "cv11"');
    const title = page.getByRole("heading", { name: "alpha", exact: true });
    await expect(title).toHaveCSS("font-size", "20px");
    await expect(title).toHaveCSS("line-height", "28px");
    await expect(title).toHaveCSS("font-weight", "600");
    await expect(title).toHaveCSS("letter-spacing", "-0.5px");
    const columnTitle = page.getByRole("heading", { name: "Ready", exact: true });
    await expect(columnTitle).toHaveCSS("font-size", "16px");
    await expect(columnTitle).toHaveCSS("line-height", "24px");
    await expect(columnTitle).toHaveCSS("font-weight", "600");
    await expect(columnTitle).toHaveCSS("letter-spacing", "-0.4px");
    const logo = page.getByRole("img", { name: "Beads", exact: true }).filter({ visible: true });
    await expect(logo).toHaveCount(1);
    expect(await logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(32);
    await expectHeaderAlignment(page.locator('[data-slot="sidebar-header"]'));
    await expect(page.getByRole("link", { name: /Beads documentation/ })).toHaveAttribute("href", "https://beads.gascity.com/");
    await expect(card).toHaveCSS("cursor", "pointer");
    expect(externalRequests).toEqual([]);
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: `docs/screenshots/beads-board-${mode}.png`, animations: "disabled" });
    }
    await card.focus();
    await card.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Fix crash on startup", exact: true })).toHaveCSS("font-size", "18px");
    if (process.env.UPDATE_SCREENSHOTS && mode === "dark") {
      await page.screenshot({ path: "docs/screenshots/beads-issue-drawer.png", animations: "disabled" });
    }
    await page.keyboard.press("Escape");
    await expect(card).toBeFocused();
    await page.getByRole("button", { name: "Change theme" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Ocean", exact: true })).toBeVisible();
    if (process.env.UPDATE_SCREENSHOTS && mode === "dark") {
      await page.screenshot({ path: "docs/screenshots/beads-theme-menu.png", animations: "disabled" });
    }
  });
}

for (const width of [390, 1280]) {
  test(`long project names leave room for counts at ${width}px`, async ({ page }) => {
    const name = "LenovoLegionLinuxFrontendWithALongerProjectName";
    await page.setViewportSize({ width, height: 844 });
    await page.route("**/api/projects", async (route) => {
      const response = await route.fetch();
      const projects = await response.json();
      projects[0].name = name;
      projects[0].summary.open_issues = 1000;
      await route.fulfill({ response, json: projects });
    });
    await page.goto("/");
    if (width < 768) {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
    }
    const project = page.getByRole("button", { name: new RegExp(name) });
    await expect(project).toBeVisible();
    await expect(project).toHaveAttribute("title", name);
    const label = project.locator("span");
    const count = project.locator('[data-slot="sidebar-menu-badge"]');
    await expect(count).toHaveText("1000");
    await page.evaluate(() => document.fonts.ready);
    await expect(label).toHaveCSS("text-overflow", "ellipsis");
    expect(await label.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    const labelBox = (await label.boundingBox())!;
    const countBox = (await count.boundingBox())!;
    const buttonBox = (await project.boundingBox())!;
    expect(countBox.x - (labelBox.x + labelBox.width)).toBeGreaterThanOrEqual(8);
    expect(countBox.x + countBox.width).toBeLessThanOrEqual(buttonBox.x + buttonBox.width);
    if (process.env.UPDATE_SCREENSHOTS) {
      await page.screenshot({ path: `docs/screenshots/beads-long-project-${width}.png`, animations: "disabled" });
    }
  });
}

for (const width of [360, 390, 768]) {
  test(`dashboard remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Fix crash on startup/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    for (const name of ["Open", "All", "Refresh", "Change theme"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    await page.getByRole("searchbox").fill("export");
    await expect(page.getByRole("button", { name: /Add export feature/ })).toBeVisible();
    await page.getByRole("searchbox").fill("");
    if (process.env.UPDATE_SCREENSHOTS && width === 390) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: "docs/screenshots/beads-mobile.png", animations: "disabled" });
    }
    await page.getByRole("button", { name: /Fix crash on startup/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Fix crash on startup" })).toBeVisible();
    expect(await drawer.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const tabList = drawer.getByRole("tablist");
    expect(await tabList.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return [...element.querySelectorAll('[role="tab"]')].every((tab) => tab.getBoundingClientRect().bottom <= bounds.bottom);
    })).toBe(true);
    if (process.env.UPDATE_SCREENSHOTS && width === 390) {
      await page.screenshot({ path: "docs/screenshots/beads-mobile-drawer.png", animations: "disabled" });
    }
    await drawer.getByRole("tab", { name: /Comments/ }).click();
    await expect(drawer.getByText("Fix merged in #42")).toBeVisible();
    await page.keyboard.press("Escape");
    if (width < 768) {
      await page.getByRole("button", { name: "Toggle Sidebar" }).click();
      const sidebar = page.getByRole("dialog");
      await expect(sidebar.getByRole("img", { name: "Beads" })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await expectHeaderAlignment(sidebar.locator('[data-slot="sidebar-header"]'));
      if (process.env.UPDATE_SCREENSHOTS && width === 390) {
        await page.screenshot({ path: "docs/screenshots/beads-mobile-sidebar.png", animations: "disabled" });
      }
      await sidebar.getByRole("button", { name: /^beta/ }).click();
      await page.keyboard.press("Escape");
    } else {
      await page.getByRole("button", { name: /^beta/ }).click();
    }
    await expect(page.getByRole("heading", { name: "beta", exact: true })).toBeVisible();
  });
}

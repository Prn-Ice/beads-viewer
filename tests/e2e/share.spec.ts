import { expect, test } from "@playwright/test";

const FAKE_URL = "https://fake-tunnel-abc123.trycloudflare.com";

test.describe("sharing", () => {
  test.afterEach(async ({ request }) => {
    await request.put("/api/share", { data: { settings: { mode: "quick" } } });
    await request.delete("/api/share");
  });

  test("starts a quick tunnel, shows the link, copies it, and stops sharing", async ({
    page,
    context,
    baseURL,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: baseURL,
    });
    await page.goto("/");

    const shareButton = page.getByRole("button", { name: "Share board" });
    await expect(shareButton).toBeVisible();
    await shareButton.click();

    const panel = page.getByRole("dialog", { name: "Share board" });
    await expect(panel.getByRole("combobox", { name: "Tunnel" })).toContainText("Quick tunnel (no setup)");
    await panel.getByRole("button", { name: "Start sharing" }).click();
    await expect(panel.getByRole("textbox", { name: "Public link" })).toHaveValue(FAKE_URL);
    await expect(panel.getByText(/Anyone with this link/)).toBeVisible();

    await panel.getByRole("button", { name: "Copy link" }).click();
    await expect(panel.getByRole("button", { name: "Copied" })).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(FAKE_URL);

    await panel.getByRole("button", { name: "Stop sharing" }).click();
    await expect(panel.getByRole("button", { name: "Start sharing" })).toBeVisible();

    const status = await page.request.get("/api/share");
    expect(await status.json()).toEqual({
      url: null,
      settings: { mode: "quick", name: "", url: "", hasToken: false },
      source: "file",
    });

    // Starting again spins up a fresh tunnel.
    await panel.getByRole("button", { name: "Start sharing" }).click();
    await expect(panel.getByRole("textbox", { name: "Public link" })).toHaveValue(FAKE_URL);
  });

  test("saves named tunnel settings and shares through them", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Share board" }).click();
    const panel = page.getByRole("dialog", { name: "Share board" });

    await panel.getByRole("combobox", { name: "Tunnel" }).click();
    await page.getByRole("option", { name: "Named tunnel" }).click();
    await panel.getByText("Setup steps").click();
    await expect(panel.getByText(/cloudflared tunnel create view-beads/)).toBeVisible();
    const start = panel.getByRole("button", { name: "Start sharing" });
    await expect(start).toBeDisabled();
    await panel.getByLabel("Tunnel name").fill("view-beads");
    await expect(start).toBeDisabled();
    await panel.getByLabel("Public URL").fill("https://board.example.com");
    await expect(start).toBeEnabled();

    await start.click();
    await expect(panel.getByRole("textbox", { name: "Public link" })).toHaveValue(
      "https://board.example.com",
    );

    const status = await page.request.get("/api/share");
    const body = await status.json();
    expect(body.settings).toEqual({
      mode: "named",
      name: "view-beads",
      url: "https://board.example.com",
      hasToken: false,
    });
    expect(body.source).toBe("file");
  });

  test("saves token settings without leaking the token", async ({ page, baseURL }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Share board" }).click();
    const panel = page.getByRole("dialog", { name: "Share board" });

    await panel.getByRole("combobox", { name: "Tunnel" }).click();
    await page.getByRole("option", { name: "Token tunnel" }).click();
    await panel.getByText("Setup steps").click();
    await expect(panel.getByText(`http://localhost:${new URL(baseURL!).port}`)).toBeVisible();
    await panel.getByLabel("Token").fill("super-secret-token");
    await panel.getByLabel("Public URL").fill("https://board.example.com");
    await panel.getByRole("button", { name: "Start sharing" }).click();
    await expect(panel.getByRole("textbox", { name: "Public link" })).toHaveValue(
      "https://board.example.com",
    );

    const body = await (await page.request.get("/api/share")).json();
    expect(JSON.stringify(body)).not.toContain("super-secret-token");
    expect(body.settings.hasToken).toBe(true);
  });

  test("reflects a running tunnel after a reload", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Share board" }).click();
    await page.getByRole("dialog", { name: "Share board" }).getByRole("button", { name: "Start sharing" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Share board" })
        .getByRole("textbox", { name: "Public link" }),
    ).toHaveValue(FAKE_URL);

    await page.reload();
    const shareButton = page.getByRole("button", { name: "Share board" });
    await expect(shareButton).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("dialog", { name: "Share board" })).not.toBeVisible();

    await shareButton.click();
    await expect(
      page
        .getByRole("dialog", { name: "Share board" })
        .getByRole("textbox", { name: "Public link" }),
    ).toHaveValue(FAKE_URL);
  });

  test("closes the panel with Escape and returns focus to the trigger", async ({ page }) => {
    await page.goto("/");
    const shareButton = page.getByRole("button", { name: "Share board" });
    await shareButton.click();
    await expect(page.getByRole("dialog", { name: "Share board" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Share board" })).not.toBeVisible();
    await expect(shareButton).toBeFocused();
  });

  test("Escape in the tunnel dropdown closes only the dropdown", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Share board" }).click();
    const panel = page.getByRole("dialog", { name: "Share board" });

    await panel.getByRole("combobox", { name: "Tunnel" }).click();
    await expect(page.getByRole("option", { name: "Named tunnel" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("option", { name: "Named tunnel" })).not.toBeVisible();
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(panel).not.toBeVisible();
  });

  test("starts sharing with the keyboard", async ({ page }) => {
    await page.goto("/");
    const shareButton = page.getByRole("button", { name: "Share board" });
    await shareButton.focus();
    await shareButton.press("Enter");
    await expect(page.getByRole("button", { name: "Start sharing" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("dialog", { name: "Share board" })
        .getByRole("textbox", { name: "Public link" }),
    ).toHaveValue(FAKE_URL);
  });
});

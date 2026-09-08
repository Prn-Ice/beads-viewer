import { expect, test } from "@playwright/test";

test("home-screen metadata links to correctly sized local icons", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);

  const apple = page.locator('link[rel="apple-touch-icon"]');
  await expect(apple).toHaveCount(1);
  await expect(apple).toHaveAttribute("sizes", "180x180");
  await expect(apple).toHaveAttribute("type", "image/png");
  const appleHref = await apple.getAttribute("href");
  expect(appleHref).toMatch(/^\/apple-icon\.png(?:\?|$)/);

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);
  await expect(manifestLink).toHaveAttribute("href", "/manifest.webmanifest");
  const response = await request.get((await manifestLink.getAttribute("href"))!);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: "/",
    name: "View Beads",
    short_name: "View Beads",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f9fbfa",
    theme_color: "#2e8555",
  });
  expect(manifest.icons).toEqual([
    { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  ]);

  for (const { src, size } of [
    { src: appleHref!, size: 180 },
    { src: manifest.icons[0].src, size: 192 },
    { src: manifest.icons[1].src, size: 512 },
  ]) {
    const imageResponse = await request.get(src);
    expect(imageResponse.ok()).toBe(true);
    expect(imageResponse.headers()["content-type"]).toContain("image/png");
    const png = await imageResponse.body();
    expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    const dimensions = await page.evaluate(async (src) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }, src);
    expect(dimensions).toEqual([size, size]);
  }
});

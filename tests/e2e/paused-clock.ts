import type { Page } from "@playwright/test";

// Pauses the page clock at `time`. The fake clock runs in real time from
// install, so installing a second early keeps pauseAt from landing in the past
// ("Cannot fast-forward to the past"). Nothing is scheduled before navigation,
// so that second fires no timers.
export async function pauseClockAt(page: Page, time = new Date()): Promise<void> {
  await page.clock.install({ time: new Date(time.getTime() - 1_000) });
  await page.clock.pauseAt(time);
}

// The dashboard renders inside <Suspense> (src/app/page.tsx). When that boundary
// resolves after its fallback committed, React holds the reveal until 300 ms of
// scheduler time have passed (FALLBACK_THROTTLE_MS) using setTimeout. With the
// clock paused before navigation that timer never fires and the page stays
// blank. So if the dashboard hasn't mounted on its own, give the paused clock
// those 300 ms. Either way it mounts at the current paused instant, so its poll
// timers start exactly where the test expects.
export async function gotoWithPausedClock(page: Page, url = "/"): Promise<void> {
  await page.goto(url);
  const dashboard = page.locator('[data-slot="sidebar-wrapper"]');
  try {
    await dashboard.waitFor({ state: "attached", timeout: 1_000 });
  } catch {
    await page.clock.runFor(300);
    await dashboard.waitFor({ state: "attached" });
  }
}

import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Projects with the events journal on: the fake bd follows
// .beads/fake-events.jsonl and answers from .beads/fake-data.json. The
// embedded one runs `bd events tail`; the server-mode one goes through the
// fake `bd serve`.
const port = Number(process.env.E2E_PORT ?? 8455);
const liveRoot = path.join(os.tmpdir(), `view-beads-e2e-live-${port}`);
const modes = [
  { name: "embedded", metadata: {} },
  { name: "server", metadata: { dolt_mode: "server" } },
];

function writeData(beadsDir: string, title: string) {
  const issue = {
    id: "live-1",
    title,
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2026-09-01T10:00:00Z",
    updated_at: "2026-09-01T10:00:00Z",
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
  };
  const summary = { total_issues: 1, open_issues: 1, in_progress_issues: 0, blocked_issues: 0, closed_issues: 0, deferred_issues: 0, ready_issues: 1, pinned_issues: 0 };
  writeFileSync(path.join(beadsDir, "fake-data.json"), JSON.stringify({ status: { summary }, list: [issue], ready: [issue], show: { "live-1": [issue] }, comments: {} }));
}

// Each run gets its own project, so parallel workers and --repeat-each never
// share a journal or a server-side checkpoint.
let projectPath = "";

test.afterEach(() => {
  if (projectPath) rmSync(projectPath, { recursive: true, force: true });
});

for (const mode of modes) {
  test(`${mode.name}-mode board with the events journal on stops polling and updates when pushed`, async ({ page }, testInfo) => {
    projectPath = path.join(liveRoot, `live-${mode.name}-${testInfo.workerIndex}-${testInfo.repeatEachIndex}`);
    const beadsDir = path.join(projectPath, ".beads");
    mkdirSync(beadsDir, { recursive: true });
    writeFileSync(path.join(beadsDir, "metadata.json"), JSON.stringify(mode.metadata));
    writeFileSync(path.join(beadsDir, "fake-events.jsonl"), "");
    writeData(beadsDir, "Live task");

    const boardUrl = `/api/projects/${encodeURIComponent(projectPath)}/issues?scope=`;
    let boardRequests = 0;
    let projectRequests = 0;
    page.on("request", (request) => {
      if (request.url().includes(boardUrl)) boardRequests++;
      if (request.url().endsWith("/api/projects")) projectRequests++;
    });

    await page.goto(`/?project=${encodeURIComponent(projectPath)}`);
    const board = page.getByRole("region", { name: "Issue board" });
    await expect(board.getByRole("button", { name: /Live task/ })).toBeVisible();
    // Going live reloads the board once to catch anything missed meanwhile.
    await expect.poll(() => boardRequests).toBeGreaterThanOrEqual(2);

    // The sidebar keeps polling every 3 seconds; the live board does not.
    const before = { board: boardRequests, projects: projectRequests };
    await page.waitForTimeout(7_000);
    expect(projectRequests).toBeGreaterThan(before.projects);
    expect(boardRequests).toBe(before.board);

    // A journal record pushes a change and the board reloads right away.
    writeData(beadsDir, "Live task renamed");
    appendFileSync(path.join(beadsDir, "fake-events.jsonl"), `${JSON.stringify({ seq: 1, op: "update", issue_id: "live-1", issue: {} })}\n`);
    await expect(board.getByRole("button", { name: /Live task renamed/ })).toBeVisible({ timeout: 2_000 });
  });
}

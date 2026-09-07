import { spawn } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(__dirname, "..", "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures");

test("view-beads cli prints a link and serves the app", async () => {
  const cli = spawn(process.execPath, ["bin/view-beads.mjs", "--no-open", "--port", "8460"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      VIEW_BEADS_SERVER: path.join(repoRoot, ".next", "standalone", "server.js"),
      BEADS_BIN: path.join(fixtureDir, "fake-bd.mjs"),
      BEADS_HOME: fixtureDir,
      BEADS_PROJECT_ROOTS: path.join(fixtureDir, "projects"),
    },
  });

  let output = "";
  cli.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const code = await new Promise<number>((resolve) => cli.on("close", resolve));

  expect(code).toBe(0);
  expect(output).toContain("view-beads: http://127.0.0.1:8460");

  const health = await fetch("http://127.0.0.1:8460/api/health");
  expect(health.ok).toBe(true);
  expect((await health.json()).app).toBe("view-beads");

  const projects = await fetch("http://127.0.0.1:8460/api/projects");
  const body = (await projects.json()) as { name: string }[];
  expect(body.map((project) => project.name).sort()).toEqual(["alpha", "beta"]);
});

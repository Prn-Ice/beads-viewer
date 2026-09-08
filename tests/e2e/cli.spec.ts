import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(__dirname, "..", "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures");
const PORT = 8460;
const URL = `http://127.0.0.1:${PORT}`;

function killPort() {
  spawnSync("fuser", ["-k", `${PORT}/tcp`], { stdio: "ignore" });
}

test.afterAll(() => {
  killPort();
});

test("view-beads cli prints a link and serves the app", async () => {
  killPort();

  const cli = spawn(process.execPath, ["bin/view-beads.mjs", "--no-open", "--port", String(PORT)], {
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
  expect(output).toContain(URL);

  const health = await fetch(`${URL}/api/health`);
  expect(health.ok).toBe(true);
  expect((await health.json()).app).toBe("view-beads");

  const pid = readFileSync(path.join(tmpdir(), `view-beads-${PORT}.pid`), "utf8").trim();
  const processName = spawnSync("ps", ["-p", pid, "-o", "comm="], { encoding: "utf8" });
  expect(processName.status).toBe(0);
  expect(processName.stdout.trim()).toBe("view-beads");

  const projects = await fetch(`${URL}/api/projects`);
  const body = (await projects.json()) as { name: string }[];
  expect(body.map((project) => project.name).sort()).toEqual(["alpha", "beta"]);
});

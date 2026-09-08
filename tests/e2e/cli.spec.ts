import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

const repoRoot = path.join(__dirname, "..", "..");
const fixtureDir = path.join(repoRoot, "tests", "fixtures");
const PORT = Number(process.env.E2E_PORT ?? 8455) + 5;
const URL = `http://127.0.0.1:${PORT}`;

test("view-beads cli prints a link and serves the app", async () => {
  // Never reuse or kill another worktree's server, including CLI fallback ports.
  for (let port = PORT; port < PORT + 5; port++) {
    await new Promise<void>((resolve, reject) => {
      const probe = createServer();
      probe.once("error", reject);
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
    });
  }
  const pidDir = mkdtempSync(path.join(tmpdir(), "view-beads-cli-"));
  const serverPath = path.join(repoRoot, ".next", "standalone", "server.js");

  try {
    const cli = spawn(process.execPath, ["bin/view-beads.mjs", "--no-open", "--port", String(PORT)], {
      cwd: repoRoot,
      env: {
        ...process.env,
        VIEW_BEADS_SERVER: serverPath,
        TMPDIR: pidDir,
        BEADS_BIN: path.join(fixtureDir, "fake-bd.mjs"),
        BEADS_HOME: fixtureDir,
        BEADS_PROJECT_ROOTS: path.join(fixtureDir, "projects"),
      },
    });

    let output = "";
    cli.stdout.on("data", (chunk) => {
      output += chunk;
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      cli.on("error", reject);
      cli.on("close", resolve);
    });

    expect(code).toBe(0);
    expect(output.trim()).toBe(`view-beads: ${URL}`);

    const health = await fetch(`${URL}/api/health`);
    expect(health.ok).toBe(true);
    expect(await health.json()).toMatchObject({
      app: "view-beads",
      build: String(statSync(serverPath).mtimeMs),
    });

    const pid = readFileSync(path.join(pidDir, `view-beads-${PORT}.pid`), "utf8").trim();
    const processName = spawnSync("ps", ["-p", pid, "-o", "comm="], { encoding: "utf8" });
    expect(processName.status).toBe(0);
    expect(processName.stdout.trim()).toBe("view-beads");

    const projects = await fetch(`${URL}/api/projects`);
    const body = await projects.json();
    expect(body).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "alpha", path: path.join(fixtureDir, "projects", "alpha") }),
      expect.objectContaining({ name: "beta", path: path.join(fixtureDir, "projects", "beta") }),
    ]));
  } finally {
    for (let port = PORT; port < PORT + 5; port++) {
      const file = path.join(pidDir, `view-beads-${port}.pid`);
      if (!existsSync(file)) continue;
      const pid = Number(readFileSync(file, "utf8").trim());
      if (!Number.isInteger(pid) || pid <= 0) continue;
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
    rmSync(pidDir, { recursive: true, force: true });
  }
});

import path from "node:path";
import { defineConfig } from "@playwright/test";

const fixtureDir = path.join(__dirname, "tests", "fixtures");
const port = Number(process.env.E2E_PORT ?? 8455);
if (!Number.isInteger(port) || port < 1024 || port > 65526) {
  throw new Error("E2E_PORT must be an integer from 1024 to 65526 (reserves ten ports)");
}
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL,
  },
  webServer: {
    command: [
      "npm run build",
      "node .next/standalone/server.js",
    ].join(" && "),
    env: {
      BEADS_BIN: path.join(fixtureDir, "fake-bd.mjs"),
      BEADS_HOME: fixtureDir,
      BEADS_PROJECT_ROOTS: path.join(fixtureDir, "projects"),
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
    },
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
  },
});

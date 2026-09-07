import path from "node:path";
import { defineConfig } from "@playwright/test";

const fixtureDir = path.join(__dirname, "tests", "fixtures");
const serverEnv = [
  `BEADS_BIN=${path.join(fixtureDir, "fake-bd.mjs")}`,
  `BEADS_HOME=${fixtureDir}`,
  `BEADS_PROJECT_ROOTS=${path.join(fixtureDir, "projects")}`,
  "PORT=8455",
  "HOSTNAME=127.0.0.1",
].join(" ");

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:8455",
  },
  webServer: {
    command: [
      "npm run build",
      "cp -r .next/static .next/standalone/.next/static",
      "cp -r public .next/standalone/public",
      `${serverEnv} node .next/standalone/server.js`,
    ].join(" && "),
    url: "http://127.0.0.1:8455/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});

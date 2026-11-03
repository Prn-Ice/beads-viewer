import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
let temp;
let launcher;
let pathBin;
let emptyPath;
let bundledBd;

before(() => {
  const system = execFileSync("nix", ["eval", "--impure", "--raw", "--expr", "builtins.currentSystem"], {
    encoding: "utf8",
  });
  const phase = execFileSync("nix", [
    "eval", "--raw", "--no-write-lock-file",
    `.#packages.${system}.view-beads.installPhase`,
  ], { cwd: root, encoding: "utf8" });
  const heredoc = phase.match(/cat > \$out\/bin\/view-beads <<EOF\n[\s\S]*?\nEOF/);
  assert.ok(heredoc, "installPhase must generate the launcher via a heredoc");
  bundledBd = phase.match(/\/nix\/store\/[^\s'"]+\/bin\/bd/)?.[0];
  assert.ok(bundledBd, "installPhase must include the bundled bd fallback");

  temp = mkdtempSync(join(tmpdir(), "view-beads-launcher-"));
  launcher = join(temp, "bin/view-beads");
  pathBin = join(temp, "runtime path");
  emptyPath = join(temp, "empty-path");
  for (const dir of [join(temp, "bin"), join(temp, "lib/view-beads"), pathBin, emptyPath]) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(join(pathBin, "bd"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(pathBin, "bd"), 0o755);
  writeFileSync(join(temp, "lib/view-beads/view-beads.mjs"), `
    console.log(JSON.stringify({
      bd: process.env.BEADS_BIN,
      server: process.env.VIEW_BEADS_SERVER,
      args: process.argv.slice(2),
    }));
  `);

  // Evaluate the real Nix string and run its unquoted build-time heredoc.
  // Only replace the Node executable: no full app/dependency build is needed.
  const buildScript = heredoc[0].replace(/exec \/nix\/store\/[^\s]+\/bin\/node /,
    `exec '${process.execPath}' `);
  execFileSync("/bin/sh", ["-c", buildScript, "build-time", "must-not-leak"], {
    env: { ...process.env, out: temp, BEADS_BIN: "/build-time/bd" },
  });
});

after(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
});

function run(beadsBin, path, args = []) {
  const env = { ...process.env, PATH: path };
  delete env.BEADS_BIN;
  if (beadsBin !== undefined) env.BEADS_BIN = beadsBin;
  // Invoke through sh so testing does not require realizing the Nix bash path.
  return JSON.parse(execFileSync("/bin/sh", [launcher, ...args], { env, encoding: "utf8" }));
}

test("preserves a nonempty explicit override even when it does not exist", () => {
  const override = join(temp, "explicit bd override");
  assert.equal(run(override, pathBin).bd, override);
});

for (const [label, value] of [["unset", undefined], ["empty", ""]]) {
  test(`${label} BEADS_BIN selects bd from the runtime PATH`, () => {
    assert.equal(run(value, pathBin).bd, join(pathBin, "bd"));
  });

  test(`${label} BEADS_BIN falls back to the bundled bd with no bd on PATH`, () => {
    assert.equal(run(value, emptyPath).bd, bundledBd);
  });
}

test("passes arguments unchanged and exports the installed server path", () => {
  const args = ["--no-open", "--port", "8555", "two words", "", "$literal", "*"];
  const result = run(undefined, pathBin, args);
  assert.deepEqual(result.args, args);
  assert.equal(result.server, join(temp, "lib/view-beads/server.js"));
});

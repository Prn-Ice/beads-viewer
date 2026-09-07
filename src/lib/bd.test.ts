import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBd } from "./bd";

const FAKE_BD = fileURLToPath(new URL("../../tests/fixtures/fake-bd.mjs", import.meta.url));
const ORIGINAL_BIN = process.env.BEADS_BIN;

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "view-beads-bd-"));
  process.env.BEADS_BIN = FAKE_BD;
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
  if (ORIGINAL_BIN === undefined) delete process.env.BEADS_BIN;
  else process.env.BEADS_BIN = ORIGINAL_BIN;
});

describe("runBd", () => {
  it("parses JSON from a successful command", async () => {
    const data = (await runBd(["status"], cwd)) as { summary: { total_issues: number } };
    expect(data.summary.total_issues).toBe(6);
  });

  it("passes extra flags through to bd", async () => {
    const data = (await runBd(["list", "--limit", "0"], cwd)) as { id: string }[];
    expect(data.map((issue) => issue.id)).toContain("alpha-1");
  });

  it("rejects when bd exits non-zero", async () => {
    await expect(runBd(["fail"], cwd)).rejects.toThrow(/boom/);
  });

  it("rejects when bd outputs invalid JSON", async () => {
    await expect(runBd(["badjson"], cwd)).rejects.toThrow(/invalid JSON/);
  });
});

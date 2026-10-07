import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cached, clearCache } from "./cache";
import { isWatched, stopAllWatchers, subscribe, watchProject, type WatchEvent } from "./events";

const FAKE_BD = fileURLToPath(new URL("../../tests/fixtures/fake-bd.mjs", import.meta.url));
const ORIGINAL_ENV = { ...process.env };

let dir: string;
let journal: string;
let log: string;

async function until(check: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}

function followerRuns(): string[] {
  return existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

function record(seq: number): void {
  appendFileSync(journal, `${JSON.stringify({ seq, op: "update", issue_id: "alpha-1", issue: {} })}\n`);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "view-beads-events-"));
  journal = join(dir, "journal.jsonl");
  log = join(dir, "bd.log");
  process.env.BEADS_BIN = FAKE_BD;
  process.env.FAKE_BD_LOG = log;
});

afterEach(() => {
  stopAllWatchers();
  clearCache();
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("watchProject", () => {
  it("leaves polling alone when the journal is off", async () => {
    delete process.env.FAKE_BD_EVENTS;
    expect(watchProject(dir)).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(watchProject(dir)).toBe(false);
    expect(followerRuns()).toEqual([]);
  });

  it("follows the journal and clears the project's cache on each record", async () => {
    process.env.FAKE_BD_EVENTS = journal;
    expect(watchProject(dir)).toBe(false);
    await until(() => isWatched(dir) && followerRuns().length === 1);
    expect(followerRuns()[0]).toBe("events tail --since 0 --follow --json");

    let loads = 0;
    const load = async () => ++loads;
    await cached(`list|${dir}|open`, 60_000, load);
    expect(await cached(`list|${dir}|open`, 60_000, load)).toBe(1);

    record(1);
    await until(async () => (await cached(`list|${dir}|open`, 60_000, load)) === 2);
  });

  it("stops an idle follower and resumes from its checkpoint", async () => {
    process.env.FAKE_BD_EVENTS = journal;
    record(1);
    record(2);
    vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
    watchProject(dir);
    await until(() => isWatched(dir));
    await new Promise((resolve) => setTimeout(resolve, 200));

    vi.advanceTimersByTime(75_000);
    expect(isWatched(dir)).toBe(false);

    watchProject(dir);
    await until(() => followerRuns().length === 2);
    expect(followerRuns()[1]).toBe("events tail --since 2 --follow --json");
  });
});

describe("subscribe", () => {
  it("only reports polling when the journal is off", async () => {
    delete process.env.FAKE_BD_EVENTS;
    const events: WatchEvent[] = [];
    const unsubscribe = subscribe(dir, (event) => events.push(event));
    await new Promise((resolve) => setTimeout(resolve, 300));
    unsubscribe();
    expect(events).toEqual(["polling"]);
  });

  it("goes live and pushes one change per burst of records", async () => {
    process.env.FAKE_BD_EVENTS = journal;
    const events: WatchEvent[] = [];
    const unsubscribe = subscribe(dir, (event) => events.push(event));
    await until(() => events.includes("live"));
    expect(events).toEqual(["polling", "live"]);

    record(1);
    record(2);
    record(3);
    await until(() => events.includes("change"));
    await new Promise((resolve) => setTimeout(resolve, 200));
    unsubscribe();
    expect(events).toEqual(["polling", "live", "change"]);
  });

  it("pushes a change the journal never recorded", async () => {
    const data = join(dir, "data.json");
    const fixture = JSON.parse(readFileSync(new URL("../../tests/fixtures/beads-data.json", import.meta.url), "utf8"));
    writeFileSync(data, JSON.stringify(fixture));
    process.env.FAKE_BD_DATA = data;
    process.env.FAKE_BD_EVENTS = journal;
    vi.useFakeTimers({ toFake: ["Date", "setInterval"] });
    const events: WatchEvent[] = [];
    subscribe(dir, (event) => events.push(event));
    await until(() => events.includes("live"));

    // The first re-check sets the baseline; the second sees the edit.
    vi.advanceTimersByTime(15_000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    fixture.list[0].title = "Edited by a sync";
    writeFileSync(data, JSON.stringify(fixture));
    vi.advanceTimersByTime(15_000);
    await until(() => events.includes("change"));
  });
});

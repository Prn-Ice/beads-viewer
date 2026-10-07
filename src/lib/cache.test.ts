import { afterEach, describe, expect, it } from "vitest";
import { cached, clearCache, clearProject } from "./cache";

afterEach(() => {
  clearCache();
});

describe("cached", () => {
  it("reuses a value until its TTL expires", async () => {
    let loads = 0;
    const load = async () => ++loads;
    expect(await cached("list|/a", 60_000, load)).toBe(1);
    expect(await cached("list|/a", 60_000, load)).toBe(1);
  });
});

describe("clearProject", () => {
  it("drops every entry for that project and keeps the rest", async () => {
    let loads = 0;
    const load = async () => ++loads;
    await cached("list|/a|open", 60_000, load);
    await cached("status|/a", 60_000, load);
    await cached("status|/b", 60_000, load);

    clearProject("/a");

    expect(await cached("list|/a|open", 60_000, load)).toBe(4);
    expect(await cached("status|/a", 60_000, load)).toBe(5);
    expect(await cached("status|/b", 60_000, load)).toBe(3);
  });

  it("never stores a load that started before the project changed", async () => {
    let release: (value: string) => void = () => {};
    const first = cached("list|/a", 60_000, () => new Promise<string>((resolve) => (release = resolve)));

    clearProject("/a");
    release("stale");

    expect(await first).toBe("stale");
    expect(await cached("list|/a", 60_000, async () => "fresh")).toBe("fresh");
  });
});

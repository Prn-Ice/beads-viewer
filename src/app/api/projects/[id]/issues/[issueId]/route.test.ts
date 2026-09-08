import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runBd } from "@/lib/bd";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";

vi.mock("@/lib/bd", () => ({ runBd: vi.fn() }));
const dir = mkdtempSync(join(tmpdir(), "view-beads-relationships-"));
mkdirSync(join(dir, ".beads"));
afterEach(() => { rmSync(dir, { recursive: true, force: true }); clearCache(); });

it("only requests full dependents on demand and keeps that cache distinct", async () => {
  vi.mocked(runBd).mockResolvedValue([{ id: "a", title: "A", dependent_count: 1 }]);
  const context = { params: Promise.resolve({ id: encodeURIComponent(dir), issueId: "a" }) };
  await GET(new Request("http://test/issue"), context);
  await GET(new Request("http://test/issue?relationships=all"), context);
  await GET(new Request("http://test/issue?relationships=all"), context);
  expect(runBd).toHaveBeenNthCalledWith(1, ["show", "a"], dir);
  expect(runBd).toHaveBeenNthCalledWith(2, ["show", "a", "--include-dependents"], dir);
  expect(runBd).toHaveBeenCalledTimes(2);
});

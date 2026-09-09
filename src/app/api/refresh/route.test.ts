import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "@/lib/cache";
import { POST } from "./route";

vi.mock("@/lib/github", () => ({
  forceSyncGithubRepos: vi.fn(),
}));

import { forceSyncGithubRepos } from "@/lib/github";

afterEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("POST /api/refresh", () => {
  it("returns ok without awaiting the forced sync", async () => {
    // A never-resolving sync must not block the refresh response.
    vi.mocked(forceSyncGithubRepos).mockReturnValue(new Promise(() => {}));
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true });
    expect(forceSyncGithubRepos).toHaveBeenCalledTimes(1);
  });

  it("returns ok even when the forced sync is skipped (no repos configured)", async () => {
    vi.mocked(forceSyncGithubRepos).mockResolvedValue(undefined);
    const res = await POST();
    expect(await res.json()).toEqual({ ok: true });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCache } from "@/lib/cache";
import { GET } from "./route";

vi.mock("@/lib/github", () => ({ listGhRepos: vi.fn() }));

import { listGhRepos } from "@/lib/github";

beforeEach(() => {
  vi.mocked(listGhRepos).mockResolvedValue([{ slug: "o/r1", private: false }]);
});

afterEach(() => {
  vi.clearAllMocks();
  clearCache();
});

describe("GET /api/github/available", () => {
  it("returns the user's repos", async () => {
    vi.mocked(listGhRepos).mockResolvedValue([
      { slug: "o/r1", private: false },
      { slug: "o/r2", private: true },
    ]);
    expect(await (await GET()).json()).toEqual({
      repos: [
        { slug: "o/r1", private: false },
        { slug: "o/r2", private: true },
      ],
    });
  });

  it("passes through a friendly error when gh is unavailable", async () => {
    vi.mocked(listGhRepos).mockRejectedValue(new Error("gh not available or not authenticated"));
    expect(await (await GET()).json()).toEqual({
      error: "gh not available or not authenticated",
    });
  });

  it("caches the repo list within the TTL", async () => {
    await GET();
    await GET();
    expect(listGhRepos).toHaveBeenCalledTimes(1);
  });
});

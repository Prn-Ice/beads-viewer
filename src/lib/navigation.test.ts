import { describe, expect, it } from "vitest";
import { buildIssueUrl, readDeepLink, withDeepLink } from "./navigation";

describe("readDeepLink", () => {
  it("reads project and issue params", () => {
    const params = new URLSearchParams("project=/a/b&issue=abc-1&scope=all");
    expect(readDeepLink(params)).toEqual({ project: "/a/b", issue: "abc-1" });
  });

  it("returns null when absent", () => {
    expect(readDeepLink(new URLSearchParams("scope=all"))).toEqual({
      project: null,
      issue: null,
    });
  });
});

describe("withDeepLink", () => {
  it("sets project and issue while preserving unrelated params", () => {
    const params = new URLSearchParams("scope=all&theme=forest");
    expect(withDeepLink("/", params, { project: "/p/alpha", issue: "a-1" })).toBe(
      "/?scope=all&theme=forest&project=%2Fp%2Falpha&issue=a-1",
    );
  });

  it("removes issue when set to null", () => {
    const params = new URLSearchParams("project=/p/alpha&issue=a-1&scope=all");
    expect(withDeepLink("/", params, { issue: null })).toBe("/?project=%2Fp%2Falpha&scope=all");
  });

  it("removes project when set to null", () => {
    const params = new URLSearchParams("project=/p/alpha&issue=a-1");
    expect(withDeepLink("/", params, { project: null })).toBe("/?issue=a-1");
  });

  it("returns bare pathname when no params remain", () => {
    expect(withDeepLink("/", new URLSearchParams("issue=a-1"), { issue: null })).toBe("/");
  });
});

describe("buildIssueUrl", () => {
  it("builds an absolute url preserving unrelated params and hash", () => {
    const url = buildIssueUrl(
      "http://localhost:3000",
      "/",
      "?scope=all&theme=forest",
      "#comments",
      "/p/alpha",
      "a-1",
    );
    expect(url).toBe(
      "http://localhost:3000/?scope=all&theme=forest&project=%2Fp%2Falpha&issue=a-1#comments",
    );
  });

  it("handles an empty search and hash", () => {
    const url = buildIssueUrl("http://localhost:3000", "/", "", "", "/p/alpha", "a-1");
    expect(url).toBe("http://localhost:3000/?project=%2Fp%2Falpha&issue=a-1");
  });

  it("encodes project paths via URLSearchParams", () => {
    const url = buildIssueUrl("http://x", "/", "", "", "/home/u/My Project", "a b");
    expect(url).toBe("http://x/?project=%2Fhome%2Fu%2FMy+Project&issue=a+b");
  });
});

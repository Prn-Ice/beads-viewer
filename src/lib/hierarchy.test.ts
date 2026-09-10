import { describe, expect, it } from "vitest";
import { countChildren } from "./hierarchy";

describe("countChildren", () => {
  it("counts direct children per parent id", () => {
    const issues = [
      { parent: "epic" },
      { parent: "epic" },
      { parent: "epic" },
      { parent: "other" },
      { parent: undefined },
    ];
    expect(countChildren(issues)).toEqual({ epic: 3, other: 1 });
  });

  it("returns an empty map when nothing has a parent", () => {
    expect(countChildren([{ parent: undefined }, { parent: undefined }])).toEqual({});
  });

  it("handles an empty list", () => {
    expect(countChildren([])).toEqual({});
  });
});

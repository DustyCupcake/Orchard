import { describe, expect, it } from "vitest";
import { findClosestNameMatch } from "@/lib/task-packs";

describe("findClosestNameMatch", () => {
  it("matches a near-miss like a plural", () => {
    const match = findClosestNameMatch("Wood", [{ id: "1", name: "Woods" }]);
    expect(match?.id).toBe("1");
  });

  it("matches case-insensitively", () => {
    const match = findClosestNameMatch("WOOD", [{ id: "1", name: "woods" }]);
    expect(match?.id).toBe("1");
  });

  it("matches a simple typo", () => {
    const match = findClosestNameMatch("Kicthen", [{ id: "1", name: "Kitchen" }]);
    expect(match?.id).toBe("1");
  });

  it("returns null when nothing clears the threshold", () => {
    const match = findClosestNameMatch("Fruit", [{ id: "1", name: "Support" }]);
    expect(match).toBeNull();
  });

  it("returns null with no candidates at all", () => {
    expect(findClosestNameMatch("Fruit", [])).toBeNull();
  });

  it("returns an exact match too (a caller that skips its own exact-match check first still gets the right answer)", () => {
    const match = findClosestNameMatch("Fruit", [{ id: "1", name: "Fruit" }]);
    expect(match?.id).toBe("1");
  });

  it("picks the closest of several candidates, not just the first", () => {
    const match = findClosestNameMatch("Kitchen", [
      { id: "unrelated", name: "Zebra" },
      { id: "closer", name: "Kithcen" },
      { id: "further", name: "Kitchenette" },
    ]);
    expect(match?.id).toBe("closer");
  });

  it("never suggests a near-match for two names that just happen to share a few letters", () => {
    const match = findClosestNameMatch("Art", [{ id: "1", name: "Party planning" }]);
    expect(match).toBeNull();
  });
});

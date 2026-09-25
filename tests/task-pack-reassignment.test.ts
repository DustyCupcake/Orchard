import { describe, expect, it } from "vitest";
import { resolveReassignmentBranches } from "@/app/(app)/task-packs/import/[packId]/reassignment";

describe("pack-import reassignment resolution", () => {
  it("applies a bulk branch only to checked tasks", () => {
    const result = resolveReassignmentBranches({
      declinedItemIds: ["a", "b", "c"],
      individualBranchForItem: () => "",
      bulkItemIds: ["a", "c"],
      bulkBranchId: "branch-1",
    });

    expect(result.overrides).toEqual({ a: "branch-1", c: "branch-1" });
    expect(result.missingItemIds).toEqual(["b"]);
  });

  it("gives an explicit per-task branch precedence over the bulk choice", () => {
    const result = resolveReassignmentBranches({
      declinedItemIds: ["a", "b"],
      individualBranchForItem: (id) => (id === "a" ? " branch-specific " : ""),
      bulkItemIds: ["a", "b"],
      bulkBranchId: "branch-bulk",
    });

    expect(result.overrides).toEqual({ a: "branch-specific", b: "branch-bulk" });
    expect(result.missingItemIds).toEqual([]);
  });
});

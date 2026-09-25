export type ReassignmentResolution = {
  overrides: Record<string, string>;
  missingItemIds: string[];
};

/**
 * Resolve the second pack-import screen without coupling the form to the
 * commit transaction. An explicit per-task choice wins; a checked bulk
 * choice fills only that task's empty field. Anything still empty is
 * reported back to the reviewer rather than silently dropping the task.
 */
export function resolveReassignmentBranches({
  declinedItemIds,
  individualBranchForItem,
  bulkItemIds,
  bulkBranchId,
}: {
  declinedItemIds: readonly string[];
  individualBranchForItem: (itemId: string) => string;
  bulkItemIds: readonly string[];
  bulkBranchId: string;
}): ReassignmentResolution {
  const bulkIds = new Set(bulkItemIds);
  const bulkTarget = bulkBranchId.trim();
  const overrides: Record<string, string> = {};
  const missingItemIds: string[] = [];

  for (const itemId of declinedItemIds) {
    const individual = individualBranchForItem(itemId).trim();
    const branchId = individual || (bulkIds.has(itemId) ? bulkTarget : "");
    if (branchId) overrides[itemId] = branchId;
    else missingItemIds.push(itemId);
  }

  return { overrides, missingItemIds };
}

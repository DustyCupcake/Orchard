import type { DbOrTx } from "@/db";
import { budgetEntry } from "@/db/schema";

// A transfer between two scopes: an event and the community's own budget
// (docs/plans/archive/budget-funds-plan.md D10). It writes *two* entries sharing a
// `transfer_id`, one in each scope with opposite signs, both confirmed, so every
// scope's balance stays a plain sum of its own entries and the pair nets to zero
// across the community.
//
// This file imports nothing from the rest of the budget library on purpose: the
// proposals, which move money when a request is approved, and settlement, which
// moves it when an event's books close, both need it, and neither can import the
// other without a cycle.
export async function postTransfer(
  executor: DbOrTx,
  input: {
    communityId: string;
    /** The scope the money leaves: an event's cycle id, or null for the community's own budget. */
    fromCycleId: string | null;
    /** The scope the money arrives in. */
    toCycleId: string | null;
    /** Positive. */
    amount: number;
    /** `allocation` (the community's budget funds an event) or `settlement` (an event's books close). */
    kind: "allocation" | "settlement";
    /** Shared by the pair. An allocation uses its proposal's id, so it can be traced back. */
    transferId: string;
    /** Who did it. */
    actorId: string;
    fromDescription: string;
    toDescription: string;
  },
) {
  const occurredOn = new Date().toISOString().slice(0, 10);
  const common = {
    communityId: input.communityId,
    kind: input.kind,
    status: "confirmed" as const,
    submittedBy: input.actorId,
    confirmedBy: input.actorId,
    confirmedAt: new Date(),
    occurredOn,
    transferId: input.transferId,
  };
  await executor.insert(budgetEntry).values([
    { ...common, cycleId: input.fromCycleId, amount: -input.amount, description: input.fromDescription },
    { ...common, cycleId: input.toCycleId, amount: input.amount, description: input.toDescription },
  ]);
}

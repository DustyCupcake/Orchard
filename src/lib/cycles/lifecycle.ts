import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ConfirmationRequiredError, NotFoundError } from "../errors";
import { requireAdmins } from "../settings/admins";
import { getCommunity } from "../settings/community";
import { isModuleEnabled } from "../modules";
import { getBudgetCycleForCycle } from "../budget/cycles";

type Member = typeof memberTable.$inferSelect;
type CycleRow = typeof cycle.$inferSelect;

// Shared closed-cycle guard — docs/development-plan.md's Phase 65:
// "closing locks everything about that cycle." Wired into
// updateCycleSettings/updatePhaseBoundary/updatePhaseHighlight
// (./crud.ts) and declareParticipation (../participation.ts), the four
// functions this phase's own confirmed lock scope covers — task/board-
// level writes are untouched, cycle-awareness for those is Phase 67's
// job.
export function requireCycleOpen(cycleRow: Pick<CycleRow, "closedAt">) {
  if (cycleRow.closedAt) {
    throw new ConflictError("This cycle is closed");
  }
}

// Admin-gated (Phase 63/64's requireAdmins — "any current Admin," no
// separate cycle-admin concept). Never hard-blocks: the Budget-owner
// warning is overridable via options.overrideBudgetWarning, the same
// ConfirmationRequiredError flow tasks/join-requests.ts's self-assign
// check already established — the caller is expected to pre-compute
// this condition and show a real confirm banner (see
// src/app/(app)/tasks/[id]/page.tsx's needsSelfAssignConfirmation for
// the UX pattern this mirrors), not just surface a raw thrown error.
export async function closeCycle(
  actor: Member,
  cycleId: string,
  options: { overrideBudgetWarning?: boolean } = {},
) {
  await requireAdmins(actor);

  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found");
  }
  if (row.closedAt) {
    throw new ConflictError("This cycle is already closed");
  }

  if (!options.overrideBudgetWarning) {
    const communityRow = await getCommunity(actor);
    if (isModuleEnabled(communityRow, "budget")) {
      const budgetCycleRow = await getBudgetCycleForCycle(actor, cycleId);
      if (budgetCycleRow && !budgetCycleRow.ownerMarkedDoneAt) {
        throw new ConfirmationRequiredError(
          `The current Budget owner hasn't marked "${budgetCycleRow.title}" done yet — close anyway?`,
        );
      }
    }
  }

  const [updated] = await db
    .update(cycle)
    .set({ closedAt: new Date(), closedBy: actor.id })
    .where(eq(cycle.id, cycleId))
    .returning();
  return updated;
}

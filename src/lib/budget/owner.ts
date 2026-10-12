import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetCycle, budgetProposal, permissionGrant, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError } from "../errors";
import { isModuleOpenToEveryone } from "../permissions";
import type { NeedsAction } from "../needs-action";
import {
  getBudgetCycle,
  lineItemInput,
  listActiveBudgetCycles,
  requireValidLineItems,
} from "./cycles";

type Member = typeof memberTable.$inferSelect;
type BudgetCycleRow = typeof budgetCycle.$inferSelect;

// Whoever currently holds a `budget` PermissionGrant task whose own
// placement matches this BudgetCycle's scope is its owner. The task's
// `cycleId` is the authority's only scope read: a Cycle-placed grant
// owns that Cycle's budget, while a cycle-less grant owns budgets whose
// `cycleId` is also null. Excludes shadow slots, matching the other
// task-is-the-authority checks throughout the app.
export async function isBudgetOwner(actor: Member, cycleRow: Pick<BudgetCycleRow, "cycleId">) {
  // An open `budget` module answers true for every budget period
  // (docs/plans/archive/open-permissions-plan.md D3) — open is the community/evergreen
  // scope, which is already the superset for a `cycle`-tier module, so the
  // cycleRow.cycleId comparison below is skipped rather than extended.
  //
  // The visible consequence is in listBudgetNeedsAction, which uses this to
  // decide who has proposals to decide. With Budget open every member
  // qualifies — the "collaborative decision rather than one person managing it"
  // case D12 handles by marking those rows shared instead of personal.
  if (await isModuleOpenToEveryone(actor.communityId, "budget")) {
    return true;
  }
  return holdsBudgetGrant(actor, cycleRow);
}

// The task-holding half of isBudgetOwner, kept separate because
// listBudgetNeedsAction needs to tell the two apart: an open module makes
// every member a budget *owner*, but only a real holder is on the hook for
// deciding its proposals. Splitting here is what lets that list label the
// rows shared without re-deriving ownership a second way.
export async function holdsBudgetGrant(actor: Member, cycleRow: Pick<BudgetCycleRow, "cycleId">) {
  const [holding] = await db
    .select({ id: permissionGrant.id })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(permissionGrant.communityId, actor.communityId),
        eq(permissionGrant.moduleKey, "budget"),
        eq(task.communityId, actor.communityId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        cycleRow.cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleRow.cycleId),
      ),
    );
  return Boolean(holding);
}

export async function requireBudgetOwner(actor: Member, cycleRow: Pick<BudgetCycleRow, "cycleId">) {
  if (!(await isBudgetOwner(actor, cycleRow))) {
    throw new ForbiddenError("Only the current Budget owner can do this");
  }
}

export const updateBudgetCycleInput = z.object({
  title: z.string().min(1).optional(),
  fixedCosts: z.array(lineItemInput).optional(),
  // null clears the deadline: proposals then stay open until the owner closes them.
  proposalDeadline: z.string().datetime().nullable().optional(),
});
export type UpdateBudgetCycleInput = z.infer<typeof updateBudgetCycleInput>;

// Lets the owner correct a title/fixed-costs/deadline mistake — including a
// proposalDeadline that was only ever a guess, or one that is no longer wanted
// (null clears it) — without having to get it exactly right up front. Only
// while the budget is open: once it is finished, what it decided is history.
export async function updateBudgetCycle(actor: Member, budgetCycleId: string, input: UpdateBudgetCycleInput) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  await requireBudgetOwner(actor, cycleRow);
  if (cycleRow.status !== "proposals_open") {
    throw new ConflictError("This budget is finished — it can't be changed any more");
  }
  if (input.fixedCosts !== undefined) {
    await requireValidLineItems(actor.communityId, input.fixedCosts);
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.fixedCosts !== undefined && { fixedCosts: input.fixedCosts }),
      ...(input.proposalDeadline !== undefined && {
        proposalDeadline: input.proposalDeadline === null ? null : new Date(input.proposalDeadline),
      }),
    })
    .where(eq(budgetCycle.id, budgetCycleId))
    .returning();
  return updated;
}

// The owner's small, deliberate "this budget is wrapped up" (Phase 65), which
// lets closeCycle (src/lib/cycles/lifecycle.ts) skip its warning. It also
// finishes the budget: no new proposals, no further edits. It used to require
// the budget to have been confirmed through a vote first, which meant an event
// that never used its budget had to be taken through one just to clear a
// warning; with no ranking and no confirmation there is nothing to wait for,
// so the owner can say it whenever it is true. Owner-gated, same authority as
// everything else in this file. Phase 3 of docs/plans/budget-funds-plan.md
// replaces this with settlement.
export async function markBudgetCycleDone(actor: Member, budgetCycleId: string) {
  const cycleRow = await getBudgetCycle(actor, budgetCycleId);
  await requireBudgetOwner(actor, cycleRow);
  if (cycleRow.ownerMarkedDoneAt) {
    throw new ConflictError("This budget is already marked done");
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({ ownerMarkedDoneAt: new Date(), status: "confirmed" })
    .where(eq(budgetCycle.id, budgetCycleId))
    .returning();
  return updated;
}

export interface BudgetNeedsAction {
  /** The event this budget belongs to; null for the community's own. Where its link goes. */
  scopeCycleId: string | null;
  /** The budget's name, shown on the dashboard row. */
  title: string;
  kind: "decide_proposals";
  /** How many open proposals are waiting for a decision. */
  count: number;
}

// Dashboard's own needs-action surface — see docs/plans/development-plan.md's
// Phase 49. Who holds a budget has proposals to decide: every unfinished
// event budget, and the community's own. Nothing for an ordinary member now
// that "cast your vote" has gone with the ballot. Gracefully returns [] rather
// than throwing for a non-owner, unlike requireBudgetOwner's own gate — this
// is read for every member's Dashboard.
//
// Split the way every needs-action list is (D12 of
// docs/plans/archive/open-permissions-plan.md): a real holder's items are
// personal, and with Budget open every member qualifies without anyone being on
// the hook, so those are shared.
export async function listBudgetNeedsAction(actor: Member): Promise<NeedsAction<BudgetNeedsAction>> {
  const personal: BudgetNeedsAction[] = [];
  const shared: BudgetNeedsAction[] = [];

  const scopes: { scopeCycleId: string | null; title: string }[] = (await listActiveBudgetCycles(actor))
    .filter((row) => row.cycleId !== null)
    .map((row) => ({ scopeCycleId: row.cycleId, title: row.title }));
  scopes.push({ scopeCycleId: null, title: "Community budget" });

  for (const scope of scopes) {
    if (!(await isBudgetOwner(actor, { cycleId: scope.scopeCycleId }))) continue;
    const open = await db
      .select({ id: budgetProposal.id })
      .from(budgetProposal)
      .where(
        and(
          eq(budgetProposal.communityId, actor.communityId),
          eq(budgetProposal.status, "open"),
          scope.scopeCycleId === null ? isNull(budgetProposal.cycleId) : eq(budgetProposal.cycleId, scope.scopeCycleId),
        ),
      );
    if (open.length === 0) continue;
    const item: BudgetNeedsAction = {
      scopeCycleId: scope.scopeCycleId,
      title: scope.title,
      kind: "decide_proposals",
      count: open.length,
    };
    // The distinction the open flag makes invisible from outside: being an
    // owner by openness is not the same as holding the task.
    (await holdsBudgetGrant(actor, { cycleId: scope.scopeCycleId }) ? personal : shared).push(item);
  }

  return { personal, shared };
}

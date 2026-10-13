import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetCycle, budgetEntry, budgetProposal, permissionGrant, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError } from "../errors";
import { isModuleOpenToEveryone } from "../permissions";
import { isAdmin } from "../settings/admins";
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
  // The ask: what each person is asked to contribute to this event, whole units.
  // null clears it. An average, not a bill, and it need not match what the plan
  // implies (docs/plans/budget-funds-plan.md 3b).
  contributionPerMember: z.number().int().nonnegative().nullable().optional(),
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
  // Re-checked here, not just in the schema, so a direct lib caller is held to
  // it too.
  if (
    input.contributionPerMember !== undefined &&
    input.contributionPerMember !== null &&
    (!Number.isInteger(input.contributionPerMember) || input.contributionPerMember < 0)
  ) {
    throw new AppError("The ask is a whole number, zero or more");
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.fixedCosts !== undefined && { fixedCosts: input.fixedCosts }),
      ...(input.proposalDeadline !== undefined && {
        proposalDeadline: input.proposalDeadline === null ? null : new Date(input.proposalDeadline),
      }),
      ...(input.contributionPerMember !== undefined && { contributionPerMember: input.contributionPerMember }),
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
  // Money still waiting for a decision would be left unaccounted for: resolve it
  // first, so what is recorded is what the budget finished with.
  const waiting = await countPendingEntries(actor.communityId, cycleRow.cycleId);
  if (waiting > 0) {
    throw new ConflictError(
      `${waiting} ${waiting === 1 ? "entry is" : "entries are"} still waiting for you to confirm or reject — resolve ${waiting === 1 ? "it" : "them"} first`,
    );
  }

  const [updated] = await db
    .update(budgetCycle)
    .set({ ownerMarkedDoneAt: new Date(), status: "confirmed" })
    .where(eq(budgetCycle.id, budgetCycleId))
    .returning();
  return updated;
}

// Entries waiting for the scope's holder, in one scope.
async function countPendingEntries(communityId: string, cycleId: string | null) {
  const rows = await db
    .select({ id: budgetEntry.id })
    .from(budgetEntry)
    .where(
      and(
        eq(budgetEntry.communityId, communityId),
        eq(budgetEntry.status, "pending"),
        cycleId === null ? isNull(budgetEntry.cycleId) : eq(budgetEntry.cycleId, cycleId),
      ),
    );
  return rows.length;
}

// Whether anyone really holds this scope's budget grant. Not "is the module
// open": an open module makes every member an owner for deciding proposals, but
// money is confirmed only by a real holder (D13), so this is the question that
// says whether money that is waiting has anyone to confirm it.
async function scopeHasHolder(communityId: string, cycleId: string | null) {
  const [row] = await db
    .select({ id: permissionGrant.id })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(permissionGrant.communityId, communityId),
        eq(permissionGrant.moduleKey, "budget"),
        eq(task.communityId, communityId),
        eq(taskAssignment.isShadow, false),
        cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export interface BudgetNeedsAction {
  /** The event this budget belongs to; null for the community's own. Where its link goes. */
  scopeCycleId: string | null;
  /** The budget's name, shown on the dashboard row. */
  title: string;
  /**
   * decide_proposals — proposals for the owner to approve or decline.
   * confirm_entries  — expenses and payments waiting for the owner to confirm.
   * no_holder        — money is waiting and nobody holds the budget to confirm it; shown to Admins, because
   *                    filling the task is platform work, and it gives them no sight of an amount.
   */
  kind: "decide_proposals" | "confirm_entries" | "no_holder";
  /** How many are waiting. */
  count: number;
}

// Dashboard's own needs-action surface — see docs/plans/development-plan.md's
// Phase 49. Who holds a budget has proposals to decide and money to confirm:
// every unfinished event budget, and the community's own. Nothing for an
// ordinary member now that "cast your vote" has gone with the ballot. Gracefully
// returns [] rather than throwing for a non-owner, unlike requireBudgetOwner's
// own gate — this is read for every member's Dashboard.
//
// Split the way every needs-action list is (D12 of
// docs/plans/archive/open-permissions-plan.md): a real holder's items are
// personal, and with Budget open every member qualifies to decide proposals
// without anyone being on the hook, so those are shared. Money is never shared:
// only a real holder confirms it.
export async function listBudgetNeedsAction(actor: Member): Promise<NeedsAction<BudgetNeedsAction>> {
  const personal: BudgetNeedsAction[] = [];
  const shared: BudgetNeedsAction[] = [];
  const admin = await isAdmin(actor);

  const scopes: { scopeCycleId: string | null; title: string }[] = (await listActiveBudgetCycles(actor))
    .filter((row) => row.cycleId !== null)
    .map((row) => ({ scopeCycleId: row.cycleId, title: row.title }));
  scopes.push({ scopeCycleId: null, title: "Community budget" });

  for (const scope of scopes) {
    const holds = await holdsBudgetGrant(actor, { cycleId: scope.scopeCycleId });

    if (holds || (await isBudgetOwner(actor, { cycleId: scope.scopeCycleId }))) {
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
      if (open.length > 0) {
        // The distinction the open flag makes invisible from outside: being an
        // owner by openness is not the same as holding the task.
        (holds ? personal : shared).push({ scopeCycleId: scope.scopeCycleId, title: scope.title, kind: "decide_proposals", count: open.length });
      }
    }

    if (holds || admin) {
      const waiting = await countPendingEntries(actor.communityId, scope.scopeCycleId);
      if (waiting > 0) {
        if (holds) {
          personal.push({ scopeCycleId: scope.scopeCycleId, title: scope.title, kind: "confirm_entries", count: waiting });
        } else if (!(await scopeHasHolder(actor.communityId, scope.scopeCycleId))) {
          personal.push({ scopeCycleId: scope.scopeCycleId, title: scope.title, kind: "no_holder", count: waiting });
        }
      }
    }
  }

  return { personal, shared };
}

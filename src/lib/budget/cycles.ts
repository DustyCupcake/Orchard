import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, budgetCycle, community, cycle, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCycleParticipationSummary } from "../participation";

type Member = typeof memberTable.$inferSelect;
type BudgetCycleRow = typeof budgetCycle.$inferSelect;

// `quantity` and `perAttendee` are two different multiplier shapes on
// the same {label, amount} line item — Leaf's own request ("8x | Item
// | amount" vs. "Item | Amount, multiplied by amount of attendees"),
// not two separate features: `quantity` is a manually entered count
// (8 tables), `perAttendee` scales automatically off however many
// members have declared Participation `coming` for this BudgetCycle's
// linked Cycle (see getBudgetCycleAttendeeCount below) — mutually
// exclusive since a line item is either a fixed count or a
// headcount-driven one, never both at once.
//
// `branchId` is a per-item override for "which Branch does this
// belong to" — independent of a BudgetProposal's own top-level
// branchId (still the proposal's default/primary branch). A single
// proposal can genuinely span more than one Branch (shared
// infrastructure plus one Branch's own gear, say); an item left
// unset falls back to its parent proposal's branchId for the
// per-branch breakdown (see resolveLineItemBranchId), the same
// "override only when it actually differs" posture quantity/
// perAttendee already take.
export const lineItemInput = z
  .object({
    label: z.string().min(1),
    amount: z.number().int().positive(),
    quantity: z.number().int().positive().optional(),
    perAttendee: z.boolean().optional(),
    branchId: z.string().uuid().optional(),
  })
  .refine((item) => !(item.perAttendee && item.quantity), {
    message: "A line item can have a fixed quantity or scale per attendee, not both",
  });
export type BudgetLineItem = z.infer<typeof lineItemInput>;

// Re-checked here, not just via zod (the .refine() above catches the
// quantity/perAttendee conflict, and each branchId's own
// z.string().uuid() catches a malformed id) — a direct lib caller
// (tests, another lib function) skips the Server Action's own
// `.parse()` entirely, so nothing here is actually enforced for it
// unless it's re-checked at this layer too. Same defense-in-depth
// precedent proposals.ts's own top-level branchId check already
// established, now covering a whole line-item array at once rather
// than one id.
export async function requireValidLineItems(communityId: string, items: BudgetLineItem[]) {
  if (items.some((i) => i.perAttendee && i.quantity)) {
    throw new AppError("A line item can have a fixed quantity or scale per attendee, not both");
  }

  const ids = [...new Set(items.map((i) => i.branchId).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const rows = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.communityId, communityId), inArray(branch.id, ids)));
  if (rows.length !== ids.length) {
    throw new AppError("A line item names a Branch that isn't part of your community");
  }
}

// How many times a line item's amount actually counts — a plain
// quantity (default 1) unless it's flagged perAttendee, in which case
// the manually entered quantity (there shouldn't be one, per the
// refine above) is ignored in favor of the live attendee count.
// attendeeCount is null when this BudgetCycle isn't tied to a real
// Cycle at all (Cycles off, or never linked) — treated as 0 rather
// than falling back to 1, so an unlinked perAttendee item visibly
// contributes nothing to totals instead of silently pretending
// there's exactly one attendee.
export function lineItemQuantity(item: BudgetLineItem, attendeeCount: number | null): number {
  if (item.perAttendee) return attendeeCount ?? 0;
  return item.quantity ?? 1;
}

export function lineItemTotal(item: BudgetLineItem, attendeeCount: number | null): number {
  return item.amount * lineItemQuantity(item, attendeeCount);
}

export function sumLineItems(items: BudgetLineItem[], attendeeCount: number | null): number {
  return items.reduce((sum, i) => sum + lineItemTotal(i, attendeeCount), 0);
}

// The live headcount a perAttendee line item scales against — however
// many members currently have Participation `coming` for the real
// Cycle this BudgetCycle is linked to (see
// getCycleParticipationSummary). Null when there's no linked Cycle at
// all, the same "optional — set only when cycles are on" posture
// budgetCycle.cycleId's own schema comment already establishes.
export async function getBudgetCycleAttendeeCount(
  actor: Member,
  cycleRow: Pick<BudgetCycleRow, "cycleId">,
): Promise<number | null> {
  if (!cycleRow.cycleId) return null;
  const summary = await getCycleParticipationSummary(actor, cycleRow.cycleId);
  return summary.comingCount;
}

export const createBudgetCycleInput = z.object({
  title: z.string().min(1),
  cycleId: z.string().uuid().nullable().optional(),
  fixedCosts: z.array(lineItemInput).optional(),
  proposalDeadline: z.string().datetime(),
  ownerTaskId: z.string().uuid(),
});
export type CreateBudgetCycleInput = z.infer<typeof createBudgetCycleInput>;

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "One active cycle at a time for v1" — see docs/development-plan.md's
// Phase 26 out-of-scope note. A prior cycle sitting at `confirmed`
// (Phase 27) doesn't block starting a fresh one; anything still
// `proposals_open`/`voting` does.
export async function createBudgetCycle(actor: Member, input: CreateBudgetCycleInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "budget");

  const [taskRow] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, input.ownerTaskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found in your community");
  }

  if (input.cycleId) {
    const [cycleRow] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, input.cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
  }

  if (input.fixedCosts) {
    await requireValidLineItems(actor.communityId, input.fixedCosts);
  }

  const existing = await getCurrentBudgetCycle(actor);
  if (existing && existing.status !== "confirmed") {
    throw new ConflictError("This Community already has an active budget cycle");
  }

  const [created] = await db
    .insert(budgetCycle)
    .values({
      communityId: actor.communityId,
      cycleId: input.cycleId ?? null,
      title: input.title,
      fixedCosts: input.fixedCosts ?? [],
      proposalDeadline: new Date(input.proposalDeadline),
      ownerTaskId: input.ownerTaskId,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// The most recently created cycle for the actor's Community — the only
// one that matters day to day, since v1 keeps at most one non-
// `confirmed` cycle at a time (see createBudgetCycle above). A past
// `confirmed` cycle still surfaces here until a new one is started, so
// /budget can show its final funded set rather than going blank.
export async function getCurrentBudgetCycle(actor: Member) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(eq(budgetCycle.communityId, actor.communityId))
    .orderBy(desc(budgetCycle.createdAt))
    .limit(1);
  return row ?? null;
}

export async function getBudgetCycle(actor: Member, budgetCycleId: string) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(and(eq(budgetCycle.id, budgetCycleId), eq(budgetCycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Budget cycle not found");
  }
  return row;
}

// Unlike getCurrentBudgetCycle above (community-wide, cycle-agnostic —
// still used as-is by callers like src/lib/nav.ts's isAnyBudgetOwner),
// this scopes to one specific real Cycle — what a cycle-scoped /budget
// page (docs/development-plan.md's Phase 65) and closeCycle's own
// owner-warning check both need.
export async function getBudgetCycleForCycle(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(and(eq(budgetCycle.communityId, actor.communityId), eq(budgetCycle.cycleId, cycleId)))
    .orderBy(desc(budgetCycle.createdAt))
    .limit(1);
  return row ?? null;
}

// Opt-in convenience for "start a Cycle and also start its Budget" —
// never automatic on its own (a brand-new Cycle otherwise starts with
// no Budget process until someone actually sets one up, same as Event
// scheduling/Spatial planning — docs/spec.md's "Concurrent cycles &
// view scope"). Only called when the admin explicitly checked the box
// on the create-Cycle form — see .../participation/actions.ts's
// createCycleAction.
//
// Carries the previous BudgetCycle's ownerTaskId and fixedCosts
// forward as a starting point — a nudge, never an inheritance of
// authority, the same "recipe not the date" posture Cycle cloning
// already takes elsewhere: whoever currently holds that task is still
// the real owner regardless of how it got set here, and it still needs
// claiming like any other task. proposalDeadline has no repeatable
// recipe to carry forward (a point in time, not a shape) — two weeks
// out is a visible placeholder the owner is expected to revise with
// updateBudgetCycle before relying on it.
//
// Returns null (not an error) rather than creating anything when
// there's no previous BudgetCycle to carry an owner task forward from
// yet, or the community's last one is still active — the "one active
// cycle at a time" invariant createBudgetCycle itself enforces. Either
// way the admin can still start one by hand from /budget.
export async function startBudgetCycleForNewCycle(actor: Member, newCycle: { id: string; name: string }) {
  const previous = await getCurrentBudgetCycle(actor);
  if (!previous || previous.status !== "confirmed") return null;

  return createBudgetCycle(actor, {
    title: `${newCycle.name} Budget`,
    cycleId: newCycle.id,
    fixedCosts: previous.fixedCosts as BudgetLineItem[],
    proposalDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    ownerTaskId: previous.ownerTaskId,
  });
}

import { and, desc, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, budgetCycle, community, cycle } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "../errors";
import { isModuleEnabled, requireModuleEnabled } from "../modules";
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

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// The most recently created budget in the actor's Community, whatever its
// scope. Only the API's bare GET still asks "the" current one; every page
// and feed reads a specific scope (getBudgetCycleForScope) or all the
// unfinished ones (listActiveBudgetCycles), because concurrent events each
// have a budget of their own.
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
    throw new NotFoundError("Budget period not found");
  }
  return row;
}

// Resolve a BudgetCycle for one exact placement scope. `null` is a
// real scope — the evergreen/community Budget — rather than a shorthand
// for "no filter"; use an explicit IS NULL so a cycle-less Budget can
// never be confused with a Cycle-linked one. The newest row wins when a
// Community has retained more than one BudgetCycle for the same scope.
export async function getBudgetCycleForScope(actor: Member, scopeCycleId: string | null) {
  const [row] = await db
    .select()
    .from(budgetCycle)
    .where(
      and(
        eq(budgetCycle.communityId, actor.communityId),
        scopeCycleId === null ? isNull(budgetCycle.cycleId) : eq(budgetCycle.cycleId, scopeCycleId),
      ),
    )
    .orderBy(desc(budgetCycle.createdAt))
    .limit(1);
  return row ?? null;
}

// Unlike getCurrentBudgetCycle above (community-wide, cycle-agnostic —
// still used as-is by callers like src/lib/nav.ts's isAnyBudgetOwner),
// this scopes to one specific real Cycle — what a cycle-scoped /budget
// page (docs/plans/development-plan.md's Phase 65) and closeCycle's own
// owner-warning check both need. Keep the non-null wrapper for callers
// that already have a real Cycle id; the nullable-safe implementation
// above is the single scope-matching path.
export async function getBudgetCycleForCycle(actor: Member, cycleId: string) {
  return getBudgetCycleForScope(actor, cycleId);
}

// Every unfinished budget in the Community — one per running event, and the
// community's own if it has one. What the calendar, the nav and the
// dashboard read now that "the current budget" is no longer a single row.
export async function listActiveBudgetCycles(actor: Member) {
  return db
    .select()
    .from(budgetCycle)
    .where(and(eq(budgetCycle.communityId, actor.communityId), ne(budgetCycle.status, "confirmed")))
    .orderBy(desc(budgetCycle.createdAt));
}

// An event's budget, made with the event (docs/plans/budget-funds-plan.md D1).
// Idempotent: it returns the event's budget if it has one, creates it if the
// event is open and the module is on, and otherwise returns null — a closed
// event with no budget is not backfilled, and a community with Budget off has
// none to make. Safe to call from every place that might be first (the
// moment an event is created, and the Budget page of an event that predates
// this), including concurrently: the unfinished-per-event unique index lets
// exactly one insert win and the others read what it wrote.
//
// Titled after the event. Fixed costs are carried forward from the most
// recent *other event's* budget as a starting point — a recipe, not an
// inheritance of authority: Budget ownership is configured independently for
// the new event's scope under Settings → Access & permissions. There is no
// deadline, because there is no honest date to invent (D2); the owner can set
// one if the event wants it.
export async function ensureEventBudget(actor: Member, cycleId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  if (!isModuleEnabled(communityRow, "budget")) return null;

  const existing = await getBudgetCycleForScope(actor, cycleId);
  if (existing) return existing;

  const [eventRow] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!eventRow) {
    throw new NotFoundError("Event not found in your community");
  }
  if (eventRow.closedAt) return null;

  const [previous] = await db
    .select({ fixedCosts: budgetCycle.fixedCosts })
    .from(budgetCycle)
    .where(
      and(
        eq(budgetCycle.communityId, actor.communityId),
        isNotNull(budgetCycle.cycleId),
        ne(budgetCycle.cycleId, cycleId),
      ),
    )
    .orderBy(desc(budgetCycle.createdAt))
    .limit(1);

  const [created] = await db
    .insert(budgetCycle)
    .values({
      communityId: actor.communityId,
      cycleId,
      title: `${eventRow.name} Budget`,
      fixedCosts: previous?.fixedCosts ?? [],
      proposalDeadline: null,
      createdBy: eventRow.startedBy ?? actor.id,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getBudgetCycleForScope(actor, cycleId));
}

// What every place that creates an event calls straight after: the event's
// budget is made with it (D1). A failure here must never mean the event
// itself failed to start, so it is swallowed — the event's Budget page makes
// the budget on first visit (ensureEventBudget is idempotent), which is why
// nothing is lost by letting this one be best-effort.
export async function ensureNewEventBudget(actor: Member, cycleId: string) {
  try {
    await ensureEventBudget(actor, cycleId);
  } catch {
    // Made lazily instead; see above.
  }
}

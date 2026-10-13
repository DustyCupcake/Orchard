import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { budgetEntry, budgetProposal, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { getBudgetCycle } from "./cycles";
import { holdsBudgetGrant } from "./owner";
import { requireEventTakingPart } from "./proposals";

type Member = typeof memberTable.$inferSelect;
type EntryRow = typeof budgetEntry.$inferSelect;
type BudgetCycleRow = Awaited<ReturnType<typeof getBudgetCycle>>;

// The ledger: what actually happened, as opposed to what was planned
// (docs/plans/budget-funds-plan.md D5). One table of entries per scope, an event
// or the community's own budget; a scope's balance is the sum of its *confirmed*
// entries. Entries are never edited or deleted: a correction is an adjustment
// that reverses the entry it undoes, so the original stays visible.
//
// Authority is the grant and nothing else (D13). Recording and confirming money
// use `holdsBudgetGrant` — a real holder of that scope's grant — and never
// `isBudgetOwner`, because the Budget module can be open to everyone, which makes
// every member an "owner" for deciding proposals and would make every member
// someone who confirms, and reads, everybody's money.
//
// Privacy is enforced here, in the read functions, not in the page (D8): the
// totals are open to every member, and an entry is visible only to the scope's
// holder and to the member it concerns. An Admin who isn't a holder is an
// ordinary member here.

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the date as YYYY-MM-DD")
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "That isn't a real date");

export const recordEntryInput = z.object({
  kind: z.enum(["opening_balance", "expense", "income"]),
  // An expense or income is entered as a positive amount: the kind says which way
  // the money went. An opening balance is whatever the balance was, which is
  // normally positive and is allowed to be anything.
  amount: z.number().int(),
  description: z.string().trim().min(1, "Say what it was for").max(300),
  occurredOn: isoDate,
  receiptNote: z.string().trim().max(500).nullable().optional(),
  // The approved proposal an expense spends against.
  proposalId: z.string().uuid().nullable().optional(),
  // Who paid an expense out of their own pocket. Only the owner can set it; a
  // member's own claim is always about themselves.
  memberId: z.string().uuid().nullable().optional(),
});
export type RecordEntryInput = z.infer<typeof recordEntryInput>;

export const rejectEntryInput = z.object({ note: z.string().trim().max(500).nullable().optional() });
export const reverseEntryInput = z.object({ note: z.string().trim().min(1, "Say what is being corrected").max(500) });

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

// `budgetCycleId` is an event's budget, or null for the community's own.
type Scope = { cycleId: string | null; budgetCycle: BudgetCycleRow | null };

async function resolveScope(actor: Member, budgetCycleId: string | null): Promise<Scope> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  if (budgetCycleId === null) return { cycleId: null, budgetCycle: null };
  const budgetCycle = await getBudgetCycle(actor, budgetCycleId);
  if (budgetCycle.cycleId === null) {
    throw new ConflictError("The community's own budget has no round — record against the community budget itself");
  }
  return { cycleId: budgetCycle.cycleId, budgetCycle };
}

function scopeCondition(communityId: string, cycleId: string | null) {
  return and(
    eq(budgetEntry.communityId, communityId),
    cycleId === null ? isNull(budgetEntry.cycleId) : eq(budgetEntry.cycleId, cycleId),
  );
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------

// Who may record what:
//
//   the scope's holder   an opening balance (the community's own budget, once),
//                        income, or an expense — born confirmed, since the person
//                        who confirms is the person recording it.
//   any other member     an expense on an open event's budget, about themselves:
//                        they paid something out of pocket and are asking for it
//                        to be counted and paid back. Born pending.
//
// With no holder, a member's claim waits: nobody can confirm it, and the Admins
// are told it is waiting (see listBudgetNeedsAction). That is the plan's answer
// to an open module or an unfilled grant, not an oversight.
export async function recordEntry(actor: Member, budgetCycleId: string | null, input: RecordEntryInput) {
  const scope = await resolveScope(actor, budgetCycleId);
  const parsed = recordEntryInput.parse(input);

  if (scope.budgetCycle) {
    await requireEventTakingPart(actor, scope.budgetCycle);
  }
  const holder = await holdsBudgetGrant(actor, { cycleId: scope.cycleId });

  if (!holder) {
    if (scope.cycleId === null) {
      throw new ForbiddenError("Only the community budget's owner records entries in it");
    }
    if (parsed.kind !== "expense") {
      throw new ForbiddenError("You can add an expense you paid for; income and opening balances are recorded by the budget's owner");
    }
  }

  if (parsed.kind === "opening_balance") {
    if (scope.cycleId !== null) {
      throw new AppError("An opening balance belongs to the community's own budget, not an event's");
    }
    const [existing] = await db
      .select({ id: budgetEntry.id })
      .from(budgetEntry)
      .where(and(scopeCondition(actor.communityId, null), eq(budgetEntry.kind, "opening_balance")));
    if (existing) {
      throw new ConflictError("The opening balance has already been entered — record income or an expense for anything since");
    }
  } else if (parsed.amount <= 0) {
    throw new AppError("Enter the amount as a positive number — whether it was spent or received is the kind of entry");
  }

  // Whose pocket an expense came out of. A member's own claim is about them;
  // the owner may name someone, or leave it as paid from the budget.
  let memberId: string | null = null;
  if (!holder) {
    memberId = actor.id;
  } else if (parsed.memberId) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.id, parsed.memberId), eq(member.communityId, actor.communityId)));
    if (!m) throw new NotFoundError("Member not found in your community");
    memberId = m.id;
  }
  if (parsed.kind !== "expense" && memberId !== null) {
    throw new AppError("Only an expense is paid out of a member's pocket");
  }

  if (parsed.proposalId) {
    if (parsed.kind !== "expense") {
      throw new AppError("Only an expense can be tied to a proposal");
    }
    const [proposal] = await db
      .select()
      .from(budgetProposal)
      .where(and(eq(budgetProposal.id, parsed.proposalId), eq(budgetProposal.communityId, actor.communityId)));
    if (!proposal) throw new NotFoundError("Proposal not found");
    if (proposal.status !== "approved") {
      throw new ConflictError("An expense can only be tied to an approved proposal");
    }
    if (proposal.cycleId !== scope.cycleId) {
      throw new AppError("That proposal belongs to a different budget");
    }
  }

  const signed = parsed.kind === "expense" ? -parsed.amount : parsed.amount;
  const [created] = await db
    .insert(budgetEntry)
    .values({
      communityId: actor.communityId,
      cycleId: scope.cycleId,
      kind: parsed.kind,
      amount: signed,
      status: holder ? "confirmed" : "pending",
      memberId,
      submittedBy: actor.id,
      confirmedBy: holder ? actor.id : null,
      confirmedAt: holder ? new Date() : null,
      description: parsed.description,
      occurredOn: parsed.occurredOn,
      receiptNote: parsed.receiptNote || null,
      proposalId: parsed.proposalId ?? null,
    })
    .returning();
  return created;
}

// ---------------------------------------------------------------------------
// Deciding, correcting, reimbursing
// ---------------------------------------------------------------------------

async function getEntry(actor: Member, entryId: string) {
  const [row] = await db
    .select()
    .from(budgetEntry)
    .where(and(eq(budgetEntry.id, entryId), eq(budgetEntry.communityId, actor.communityId)));
  if (!row) throw new NotFoundError("Entry not found");
  requireModuleEnabled(await getCommunity(actor), "budget");
  return row;
}

// A holder of the entry's own scope, and nobody else: an event's owner cannot
// touch the community's money, nor the community's owner an event's.
async function requireEntryHolder(actor: Member, entry: EntryRow) {
  if (!(await holdsBudgetGrant(actor, { cycleId: entry.cycleId }))) {
    throw new ForbiddenError("Only this budget's owner can do that");
  }
}

export async function confirmEntry(actor: Member, entryId: string) {
  const entry = await getEntry(actor, entryId);
  await requireEntryHolder(actor, entry);
  if (entry.status !== "pending") {
    throw new ConflictError("That entry has already been decided");
  }
  const [updated] = await db
    .update(budgetEntry)
    .set({ status: "confirmed", confirmedBy: actor.id, confirmedAt: new Date() })
    .where(eq(budgetEntry.id, entryId))
    .returning();
  return updated;
}

// Rejecting keeps the row, marked rejected, so there is a trail.
export async function rejectEntry(actor: Member, entryId: string, input: z.infer<typeof rejectEntryInput> = {}) {
  const entry = await getEntry(actor, entryId);
  await requireEntryHolder(actor, entry);
  if (entry.status !== "pending") {
    throw new ConflictError("That entry has already been decided");
  }
  const parsed = rejectEntryInput.parse(input);
  const [updated] = await db
    .update(budgetEntry)
    .set({ status: "rejected", confirmedBy: actor.id, confirmedAt: new Date(), decisionNote: parsed.note || null })
    .where(eq(budgetEntry.id, entryId))
    .returning();
  return updated;
}

// Entries are never edited or deleted. A correction is an adjustment for the
// opposite amount that points at the entry it undoes, carrying the same
// proposal and member so every total nets out; the original stays visible.
export async function reverseEntry(actor: Member, entryId: string, input: z.infer<typeof reverseEntryInput>) {
  const entry = await getEntry(actor, entryId);
  await requireEntryHolder(actor, entry);
  const parsed = reverseEntryInput.parse(input);

  if (entry.status !== "confirmed") {
    throw new ConflictError("Only a confirmed entry can be reversed — a pending one can be rejected instead");
  }
  if (entry.reversesEntryId) {
    throw new ConflictError("That is already a reversal — record a new entry for what is right");
  }
  if (entry.kind === "opening_balance") {
    throw new ConflictError("The opening balance can't be reversed — record income or an expense for the difference");
  }
  const [already] = await db.select({ id: budgetEntry.id }).from(budgetEntry).where(eq(budgetEntry.reversesEntryId, entryId));
  if (already) {
    throw new ConflictError("That entry has already been reversed");
  }

  const today = new Date().toISOString().slice(0, 10);
  const [created] = await db
    .insert(budgetEntry)
    .values({
      communityId: actor.communityId,
      cycleId: entry.cycleId,
      kind: "adjustment",
      amount: -entry.amount,
      status: "confirmed",
      memberId: entry.memberId,
      submittedBy: actor.id,
      confirmedBy: actor.id,
      confirmedAt: new Date(),
      decisionNote: parsed.note,
      description: `Reversal of: ${entry.description}`,
      occurredOn: today,
      proposalId: entry.proposalId,
      reversesEntryId: entryId,
    })
    .returning();
  return created;
}

// "Who is still owed": an expense a member paid out of their own pocket, once
// the owner has paid them back.
export async function markEntryReimbursed(actor: Member, entryId: string) {
  const entry = await getEntry(actor, entryId);
  await requireEntryHolder(actor, entry);
  if (entry.kind !== "expense" || entry.status !== "confirmed" || entry.memberId === null) {
    throw new ConflictError("Only a confirmed expense that a member paid out of pocket can be marked reimbursed");
  }
  if (entry.reimbursedAt) {
    throw new ConflictError("That has already been marked reimbursed");
  }
  const [updated] = await db
    .update(budgetEntry)
    .set({ reimbursedAt: new Date() })
    .where(eq(budgetEntry.id, entryId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface BudgetEntryView {
  entry: EntryRow;
  /** Who paid it out of pocket, or paid it in. */
  memberName: string | null;
  submitterName: string;
  /** The id of the reversal that undoes it, if one does. */
  reversedBy: string | null;
}

// The entries the actor may see: all of them for the scope's holder, and for
// anyone else only the ones they put in or that are about them — "a member sees
// their own expenses and what became of them" (D8). Nobody else's amounts, and
// not an Admin's by virtue of being one.
export async function listBudgetEntries(
  actor: Member,
  budgetCycleId: string | null,
): Promise<{ entries: BudgetEntryView[]; asHolder: boolean }> {
  const scope = await resolveScope(actor, budgetCycleId);
  const asHolder = await holdsBudgetGrant(actor, { cycleId: scope.cycleId });

  const rows = await db
    .select()
    .from(budgetEntry)
    .where(scopeCondition(actor.communityId, scope.cycleId))
    .orderBy(desc(budgetEntry.occurredOn), desc(budgetEntry.createdAt));

  const visible = asHolder ? rows : rows.filter((r) => r.submittedBy === actor.id || r.memberId === actor.id);
  if (visible.length === 0) return { entries: [], asHolder };

  const members = await db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, actor.communityId));
  const nameOf = new Map(members.map((m) => [m.id, m.name] as const));
  const reversedBy = new Map(rows.filter((r) => r.reversesEntryId).map((r) => [r.reversesEntryId!, r.id] as const));

  return {
    asHolder,
    entries: visible.map((entry) => ({
      entry,
      memberName: entry.memberId ? (nameOf.get(entry.memberId) ?? null) : null,
      submitterName: nameOf.get(entry.submittedBy) ?? "—",
      reversedBy: reversedBy.get(entry.id) ?? null,
    })),
  };
}

// What an entry counts as once reversals are looked through: an adjustment that
// undoes an expense is still, for totals, part of what was spent.
function effectiveKind(row: EntryRow, byId: Map<string, EntryRow>) {
  return row.reversesEntryId ? (byId.get(row.reversesEntryId)?.kind ?? row.kind) : row.kind;
}

export interface BudgetMoney {
  /** The sum of confirmed entries. */
  balance: number;
  /** Money recorded as income. */
  income: number;
  /** Money recorded as spent, net of anything reversed. */
  spent: number;
  /** Entries waiting for the holder, or null for anyone who isn't one. */
  pendingCount: number | null;
  /** Per approved proposal: what was approved and what has been spent against it. */
  proposals: { proposalId: string; approved: number; spent: number }[];
  /** Approved and not yet spent, over the approved proposals still open. */
  committed: number;
  /** balance less committed. */
  available: number;
}

// The totals, open to every member (D8). `budgetCycleId` is an event's budget,
// or null for the community's own. None of it names a member or an entry.
export async function getBudgetMoney(actor: Member, budgetCycleId: string | null): Promise<BudgetMoney> {
  const scope = await resolveScope(actor, budgetCycleId);
  const rows = await db.select().from(budgetEntry).where(scopeCondition(actor.communityId, scope.cycleId));
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const confirmed = rows.filter((r) => r.status === "confirmed");

  const balance = confirmed.reduce((sum, r) => sum + r.amount, 0);
  const income = confirmed.filter((r) => effectiveKind(r, byId) === "income").reduce((sum, r) => sum + r.amount, 0);
  // `0 -` rather than a leading minus: negating a sum of zero gives -0, which
  // reads as "-0" on the page.
  const spent = 0 - confirmed.filter((r) => effectiveKind(r, byId) === "expense").reduce((sum, r) => sum + r.amount, 0);

  const approved = await db
    .select()
    .from(budgetProposal)
    .where(
      and(
        eq(budgetProposal.communityId, actor.communityId),
        eq(budgetProposal.status, "approved"),
        scope.cycleId === null ? isNull(budgetProposal.cycleId) : eq(budgetProposal.cycleId, scope.cycleId),
      ),
    );
  const proposals = approved.map((p) => ({
    proposalId: p.id,
    approved: p.approvedAmount ?? 0,
    // Net of reversals, which carry the proposal of the entry they undo.
    spent: 0 - confirmed.filter((r) => r.proposalId === p.id).reduce((sum, r) => sum + r.amount, 0),
  }));
  const committed = proposals.reduce((sum, p) => sum + Math.max(0, p.approved - p.spent), 0);

  const holder = await holdsBudgetGrant(actor, { cycleId: scope.cycleId });
  return {
    balance,
    income,
    spent,
    pendingCount: holder ? rows.filter((r) => r.status === "pending").length : null,
    proposals,
    committed,
    available: balance - committed,
  };
}

// The balance alone: the sum of confirmed entries. Open to every member, like
// the rest of the totals.
export async function getScopeBalance(actor: Member, budgetCycleId: string | null): Promise<number> {
  return (await getBudgetMoney(actor, budgetCycleId)).balance;
}

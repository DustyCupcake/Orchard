import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, budgetProposal, budgetProposalSupport, cycle, member } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { requireCycleOpen } from "../cycles/lifecycle";
import { getBudgetCycle, getBudgetCycleAttendeeCount, lineItemInput, requireValidLineItems, sumLineItems } from "./cycles";
import type { BudgetLineItem } from "./cycles";
import { isBudgetOwner } from "./owner";

type Member = typeof memberTable.$inferSelect;
type ProposalRow = typeof budgetProposal.$inferSelect;
type BudgetCycleRow = Awaited<ReturnType<typeof getBudgetCycle>>;

// Proposals are always open, in an event's budget and in the community's own,
// and members back them; the holder of the scope approves up to what the
// backers cover. There are no rounds, no ranking and no confirmation. See
// docs/plans/budget-funds-plan.md D4, D12 and D15.

export const submitBudgetProposalInput = z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  lineItems: z.array(lineItemInput).min(1),
  branchId: z.string().uuid().nullable().optional(),
  phaseId: z.string().uuid().nullable().optional(),
});
export type SubmitBudgetProposalInput = z.infer<typeof submitBudgetProposalInput>;

export const updateBudgetProposalInput = submitBudgetProposalInput.partial();
export type UpdateBudgetProposalInput = z.infer<typeof updateBudgetProposalInput>;

export const approveBudgetProposalInput = z.object({
  // Defaults to everything the backers cover, up to what was asked.
  amount: z.number().int().positive().optional(),
  note: z.string().nullable().optional(),
});
export type ApproveBudgetProposalInput = z.infer<typeof approveBudgetProposalInput>;

export const declineBudgetProposalInput = z.object({ note: z.string() });
export type DeclineBudgetProposalInput = z.infer<typeof declineBudgetProposalInput>;

// Re-checked here, not just in the zod schema's .min(1), so a direct
// lib caller is protected too — same defense-in-depth precedent Forms'
// own requireValidFields established (see src/lib/forms.ts).
function requireLineItems(items: BudgetLineItem[]) {
  if (items.length === 0) {
    throw new AppError("An itemized proposal needs at least one line item");
  }
}

// ---------------------------------------------------------------------------
// Backing
// ---------------------------------------------------------------------------

export interface Backing {
  /** The proposer, plus everyone who supports it. */
  backers: number;
  /** What each backer stands behind; null when the community asks for no backing. */
  perBacker: number | null;
  /** backers × perBacker, or null when nothing is required. */
  backedUpTo: number | null;
  /** The most the holder can approve right now: what was asked, capped by what is backed. */
  approvable: number;
}

// A proposal is backed up to its backers times the amount each stands behind,
// and the holder can approve it only up to that (D12). The proposer is the
// first backer without needing a row of their own. Unset or zero means no
// backing is required and the holder decides alone.
export function backingFor(
  proposal: Pick<ProposalRow, "totalAmount">,
  supporterCount: number,
  perBacker: number | null | undefined,
): Backing {
  const backers = 1 + supporterCount;
  const required = perBacker && perBacker > 0 ? perBacker : null;
  const backedUpTo = required === null ? null : backers * required;
  return {
    backers,
    perBacker: required,
    backedUpTo,
    approvable: backedUpTo === null ? proposal.totalAmount : Math.min(proposal.totalAmount, backedUpTo),
  };
}

async function perBackerFor(actor: Member): Promise<number | null> {
  return (await getCommunity(actor)).fundSupportPerBacker ?? null;
}

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

// A proposal belongs to an event's budget or to the community's own. This
// resolves the scope a write is aimed at and refuses it when it is not taking
// part: Budget off, the event closed, or the event's budget finished.
type Scope = { cycleId: string | null; budgetCycle: BudgetCycleRow | null };

async function resolveWriteScope(actor: Member, budgetCycleId: string | null): Promise<Scope> {
  requireModuleEnabled(await getCommunity(actor), "budget");
  if (budgetCycleId === null) return { cycleId: null, budgetCycle: null };

  const budgetCycle = await getBudgetCycle(actor, budgetCycleId);
  if (budgetCycle.cycleId === null) {
    throw new ConflictError("The community's own budget no longer runs in rounds — propose in it directly");
  }
  await requireEventTakingPart(actor, budgetCycle);
  return { cycleId: budgetCycle.cycleId, budgetCycle };
}

// The event must be open and its budget not finished. Deliberately not the
// deadline: that stops *new* proposals (requireAcceptingProposals), while a
// holder can still decide, and members still back, what is already there.
export async function requireEventTakingPart(actor: Member, budgetCycle: BudgetCycleRow) {
  if (budgetCycle.status !== "proposals_open") {
    throw new ConflictError("This budget is finished — it isn't taking part any more");
  }
  const [eventRow] = await db
    .select({ closedAt: cycle.closedAt })
    .from(cycle)
    .where(and(eq(cycle.id, budgetCycle.cycleId!), eq(cycle.communityId, actor.communityId)));
  if (!eventRow) throw new NotFoundError("Event not found");
  requireCycleOpen(eventRow);
}

// A set deadline stops new proposals after it. No deadline means they stay
// open until the owner finishes the budget.
function requireAcceptingProposals(budgetCycle: BudgetCycleRow | null) {
  if (budgetCycle?.proposalDeadline && new Date() > new Date(budgetCycle.proposalDeadline)) {
    throw new ConflictError("The proposal deadline has passed");
  }
}

async function scopeOf(actor: Member, proposal: ProposalRow): Promise<Scope> {
  if (proposal.cycleId === null) {
    requireModuleEnabled(await getCommunity(actor), "budget");
    return { cycleId: null, budgetCycle: null };
  }
  // An event's proposal always names its budget row.
  const budgetCycle = await getBudgetCycle(actor, proposal.budgetCycleId!);
  await requireEventTakingPart(actor, budgetCycle);
  return { cycleId: proposal.cycleId, budgetCycle };
}

async function requireBranchInCommunity(actor: Member, branchId: string | null | undefined) {
  if (!branchId) return;
  const [branchRow] = await db
    .select({ id: branch.id })
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!branchRow) {
    throw new NotFoundError("Branch not found in your community");
  }
}

// A fund has no attendees, so a "× attendees" item there would silently count
// as nothing.
function requireNoPerAttendee(scope: Scope, items: BudgetLineItem[]) {
  if (scope.cycleId === null && items.some((i) => i.perAttendee)) {
    throw new AppError("A per-attendee item needs an event — the community's budget has no attendees to count");
  }
}

// ---------------------------------------------------------------------------
// Writing proposals
// ---------------------------------------------------------------------------

// Open to any member. `budgetCycleId` is an event's budget, or null for the
// community's own.
export async function submitBudgetProposal(
  actor: Member,
  budgetCycleId: string | null,
  input: SubmitBudgetProposalInput,
) {
  const scope = await resolveWriteScope(actor, budgetCycleId);
  requireAcceptingProposals(scope.budgetCycle);
  requireLineItems(input.lineItems);
  requireNoPerAttendee(scope, input.lineItems);
  await requireBranchInCommunity(actor, input.branchId);
  await requireValidLineItems(actor.communityId, input.lineItems);

  // A perAttendee line item's contribution to totalAmount is only a snapshot as
  // of this write — an event's plan recomputes against the current attendee
  // count rather than trusting this stored figure once heads actually get
  // counted.
  const attendeeCount = scope.budgetCycle ? await getBudgetCycleAttendeeCount(actor, scope.budgetCycle) : null;
  const [created] = await db
    .insert(budgetProposal)
    .values({
      communityId: actor.communityId,
      cycleId: scope.cycleId,
      budgetCycleId: scope.budgetCycle?.id ?? null,
      submittedBy: actor.id,
      title: input.title,
      description: input.description ?? null,
      lineItems: input.lineItems,
      totalAmount: sumLineItems(input.lineItems, attendeeCount),
      branchId: input.branchId ?? null,
      phaseId: input.phaseId ?? null,
    })
    .returning();
  return created;
}

export async function getBudgetProposal(actor: Member, proposalId: string) {
  const [row] = await db
    .select()
    .from(budgetProposal)
    .where(and(eq(budgetProposal.id, proposalId), eq(budgetProposal.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Proposal not found");
  }
  return row;
}

function requireOpen(proposal: ProposalRow) {
  if (proposal.status !== "open") {
    throw new ConflictError("This proposal has already been decided or withdrawn");
  }
}

// "Editable by the submitter until it is decided" — nobody else can rewrite
// someone's itemization, the holder included; the holder approves or declines
// what was proposed.
export async function updateBudgetProposal(actor: Member, proposalId: string, input: UpdateBudgetProposalInput) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  if (proposalRow.submittedBy !== actor.id) {
    throw new ForbiddenError("Only the submitter can edit this proposal");
  }
  requireOpen(proposalRow);
  const scope = await scopeOf(actor, proposalRow);

  if (input.lineItems !== undefined) {
    requireLineItems(input.lineItems);
    requireNoPerAttendee(scope, input.lineItems);
    await requireValidLineItems(actor.communityId, input.lineItems);
  }
  await requireBranchInCommunity(actor, input.branchId);

  const attendeeCount =
    input.lineItems !== undefined && scope.budgetCycle ? await getBudgetCycleAttendeeCount(actor, scope.budgetCycle) : null;
  const [updated] = await db
    .update(budgetProposal)
    .set({
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.lineItems !== undefined && {
        lineItems: input.lineItems,
        totalAmount: sumLineItems(input.lineItems, attendeeCount),
      }),
      ...(input.branchId !== undefined && { branchId: input.branchId }),
      ...(input.phaseId !== undefined && { phaseId: input.phaseId }),
    })
    .where(eq(budgetProposal.id, proposalId))
    .returning();
  return updated;
}

// The submitter takes it back. Its supporters are kept: the row is history,
// and they are never told "no".
export async function withdrawBudgetProposal(actor: Member, proposalId: string) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  if (proposalRow.submittedBy !== actor.id) {
    throw new ForbiddenError("Only the submitter can withdraw this proposal");
  }
  requireOpen(proposalRow);
  await scopeOf(actor, proposalRow);

  const [updated] = await db
    .update(budgetProposal)
    .set({ status: "withdrawn", decidedAt: new Date() })
    .where(eq(budgetProposal.id, proposalId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

// One per member per proposal, withdrawable. The proposer cannot back their
// own: they are already the first backer, and counting them twice would
// inflate it — the same reason programme interest refuses a host's own.
export async function setBudgetProposalSupport(actor: Member, proposalId: string, supporting: boolean) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  if (proposalRow.submittedBy === actor.id) {
    throw new AppError("That's your own proposal — you're already behind it");
  }
  requireOpen(proposalRow);
  await scopeOf(actor, proposalRow);

  if (!supporting) {
    await db
      .delete(budgetProposalSupport)
      .where(and(eq(budgetProposalSupport.proposalId, proposalId), eq(budgetProposalSupport.memberId, actor.id)));
    return false;
  }
  await db
    .insert(budgetProposalSupport)
    .values({ proposalId, memberId: actor.id })
    .onConflictDoNothing();
  return true;
}

// ---------------------------------------------------------------------------
// Deciding
// ---------------------------------------------------------------------------

async function requireHolder(actor: Member, proposal: ProposalRow) {
  if (!(await isBudgetOwner(actor, { cycleId: proposal.cycleId }))) {
    throw new ForbiddenError("Only this budget's owner can decide proposals");
  }
}

async function countSupporters(proposalId: string) {
  const rows = await db
    .select({ memberId: budgetProposalSupport.memberId })
    .from(budgetProposalSupport)
    .where(eq(budgetProposalSupport.proposalId, proposalId));
  return rows.length;
}

// Approves for any amount up to what the backers cover, which is also the
// default. Backing never approves by itself: this is the holder's act, and the
// holder can approve less than was asked, or decline. A direct caller is held
// to the same limit as the page.
export async function approveBudgetProposal(actor: Member, proposalId: string, input: ApproveBudgetProposalInput = {}) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  await requireHolder(actor, proposalRow);
  requireOpen(proposalRow);
  await scopeOf(actor, proposalRow);

  const backing = backingFor(proposalRow, await countSupporters(proposalId), await perBackerFor(actor));
  const amount = input.amount ?? backing.approvable;
  if (amount > proposalRow.totalAmount) {
    throw new AppError(`That is more than was asked (${proposalRow.totalAmount})`);
  }
  if (backing.backedUpTo !== null && amount > backing.backedUpTo) {
    throw new AppError(
      `Only ${backing.backedUpTo} is backed so far (${backing.backers} ${backing.backers === 1 ? "person" : "people"} × ${backing.perBacker}) — approve up to that, or wait for more support`,
    );
  }
  if (amount <= 0) {
    throw new AppError("There is nothing to approve — the proposal has no amount");
  }

  const [updated] = await db
    .update(budgetProposal)
    .set({
      status: "approved",
      approvedAmount: amount,
      decidedBy: actor.id,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    })
    .where(eq(budgetProposal.id, proposalId))
    .returning();
  return updated;
}

// A decline needs a note: the holder's reasoning is the one thing that stands
// in for the rationale a confirmed funded set used to carry.
export async function declineBudgetProposal(actor: Member, proposalId: string, input: DeclineBudgetProposalInput) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  await requireHolder(actor, proposalRow);
  requireOpen(proposalRow);
  await scopeOf(actor, proposalRow);

  const note = input.note.trim();
  if (!note) {
    throw new AppError("Say why you're declining it — the person who proposed it will read this");
  }

  const [updated] = await db
    .update(budgetProposal)
    .set({ status: "declined", decidedBy: actor.id, decidedAt: new Date(), decisionNote: note })
    .where(eq(budgetProposal.id, proposalId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface BudgetProposalView {
  proposal: ProposalRow;
  backing: Backing;
  supporterCount: number;
  iSupport: boolean;
  /** Who is behind it. Only the proposer and the scope's holder get names; everyone else null. */
  supporters: string[] | null;
}

// Every proposal in one scope, oldest first, with its backing worked out.
// `scopeCycleId` is an event, or null for the community's own budget. Counts
// are open to every member; *who* is behind them is not, and that rule lives
// here so no page can show names by forgetting to check, as
// getProposalInterest does for programme proposals.
export async function listBudgetProposalViews(actor: Member, scopeCycleId: string | null): Promise<BudgetProposalView[]> {
  const proposals = await db
    .select()
    .from(budgetProposal)
    .where(
      and(
        eq(budgetProposal.communityId, actor.communityId),
        scopeCycleId === null ? isNull(budgetProposal.cycleId) : eq(budgetProposal.cycleId, scopeCycleId),
      ),
    )
    .orderBy(asc(budgetProposal.submittedAt));
  if (proposals.length === 0) return [];

  const perBacker = await perBackerFor(actor);
  const holder = await isBudgetOwner(actor, { cycleId: scopeCycleId });
  const support = await db
    .select({
      proposalId: budgetProposalSupport.proposalId,
      memberId: budgetProposalSupport.memberId,
      name: member.name,
    })
    .from(budgetProposalSupport)
    .innerJoin(member, eq(member.id, budgetProposalSupport.memberId))
    .where(inArray(budgetProposalSupport.proposalId, proposals.map((p) => p.id)))
    .orderBy(asc(budgetProposalSupport.createdAt));

  return proposals.map((proposal) => {
    const rows = support.filter((s) => s.proposalId === proposal.id);
    const mayNameThem = holder || proposal.submittedBy === actor.id;
    return {
      proposal,
      backing: backingFor(proposal, rows.length, perBacker),
      supporterCount: rows.length,
      iSupport: rows.some((r) => r.memberId === actor.id),
      supporters: mayNameThem ? rows.map((r) => r.name) : null,
    };
  });
}

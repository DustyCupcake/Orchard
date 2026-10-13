import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, budgetCycle, budgetProposal, budgetProposalSupport, cycle, member, participation } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import { getCommunity } from "../settings";
import { requireCycleOpen } from "../cycles/lifecycle";
import {
  getBudgetCycle,
  getBudgetCycleAttendeeCount,
  getBudgetCycleForScope,
  lineItemInput,
  requireValidLineItems,
  sumLineItems,
} from "./cycles";
import type { BudgetLineItem } from "./cycles";
import { isBudgetOwner } from "./owner";
import { postTransfer } from "./transfers";

type Member = typeof memberTable.$inferSelect;
type ProposalRow = typeof budgetProposal.$inferSelect;
type BudgetCycleRow = Awaited<ReturnType<typeof getBudgetCycle>>;

// Proposals are always open, in an event's budget and in the community's own,
// and members back them; the holder of the scope approves up to what the
// backers cover. There are no rounds, no ranking and no confirmation. See
// docs/plans/archive/budget-funds-plan.md D4, D12 and D15.

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

// `strict` is whether the proposal's event has to still be taking part. An
// allocation request is about an event, and backing or approving it for an event
// that has since closed or finished would move money into a budget that no
// longer takes any; declining or withdrawing it is always possible.
async function scopeOf(actor: Member, proposal: ProposalRow, strict = true): Promise<Scope> {
  if (proposal.cycleId === null) {
    requireModuleEnabled(await getCommunity(actor), "budget");
    if (strict && proposal.kind === "event_allocation") {
      const eventBudget = await getBudgetCycleForScope(actor, proposal.eventCycleId!);
      if (!eventBudget) throw new ConflictError("That event has no budget any more");
      await requireEventTakingPart(actor, eventBudget);
    }
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
  if (proposalRow.kind !== "spending") {
    throw new ConflictError("A request for funding is made from the event's budget — withdraw it and make a new one instead of editing");
  }
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
  await scopeOf(actor, proposalRow, false);

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

// Who stands behind a proposal besides its proposer. Explicit supporters, and,
// for a request about an event, the members who have declared Participation
// `coming` to it: going to an event whose plan you can read is a form of backing
// its request (D12). Each person is counted once however they arrive at it, and
// the proposer is never counted twice. `comingOnly` is the people who are backing
// it *only* by coming, so a page can say "N coming + M supporting" and the
// numbers add up with the proposer.
async function backersBesides(proposal: ProposalRow) {
  const support = await db
    .select({ memberId: budgetProposalSupport.memberId })
    .from(budgetProposalSupport)
    .where(eq(budgetProposalSupport.proposalId, proposal.id));
  const explicit = support.map((r) => r.memberId).filter((id) => id !== proposal.submittedBy);

  let comingOnly: string[] = [];
  if (proposal.kind !== "spending" && proposal.eventCycleId) {
    const coming = await db
      .select({ memberId: participation.memberId })
      .from(participation)
      .where(and(eq(participation.cycleId, proposal.eventCycleId), eq(participation.status, "coming")));
    const known = new Set([...explicit, proposal.submittedBy]);
    comingOnly = [...new Set(coming.map((r) => r.memberId))].filter((id) => !known.has(id));
  }
  return { explicit, comingOnly, count: explicit.length + comingOnly.length };
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

  const backing = backingFor(proposalRow, (await backersBesides(proposalRow)).count, await perBackerFor(actor));
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

  // A request about an event moves money the moment it is approved, where an
  // ordinary approval only sets it aside: the event is going to spend this itself.
  // Approving more than the community budget has free is not blocked (it warns on
  // the page and goes through), like every other check in this module.
  const eventBudget =
    proposalRow.kind !== "spending" && proposalRow.eventCycleId
      ? await getBudgetCycleForScope(actor, proposalRow.eventCycleId)
      : null;
  const eventRow =
    proposalRow.kind !== "spending" && proposalRow.eventCycleId
      ? (await db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, proposalRow.eventCycleId)))[0]
      : null;

  return db.transaction(async (tx) => {
    const [updated] = await tx
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

    if (proposalRow.kind !== "spending" && proposalRow.eventCycleId) {
      const name = eventRow?.name ?? "the event";
      await postTransfer(tx, {
        communityId: actor.communityId,
        fromCycleId: null,
        toCycleId: proposalRow.eventCycleId,
        amount,
        kind: proposalRow.kind === "event_allocation" ? "allocation" : "settlement",
        transferId: proposalRow.id,
        actorId: actor.id,
        fromDescription:
          proposalRow.kind === "event_allocation" ? `Funding for ${name}` : `Covering ${name}'s overspend`,
        toDescription:
          proposalRow.kind === "event_allocation"
            ? "Funding from the community's budget"
            : "Overspend covered by the community's budget",
      });
      // Deciding the overspend is what closes the event's books, whether it was
      // covered in full or only in part: what is left stays visible as uncovered.
      if (proposalRow.kind === "event_deficit" && eventBudget) {
        await tx.update(budgetCycle).set({ settledAt: new Date() }).where(eq(budgetCycle.id, eventBudget.id));
      }
    }
    return updated;
  });
}

// A decline needs a note: the holder's reasoning is the one thing that stands
// in for the rationale a confirmed funded set used to carry.
export async function declineBudgetProposal(actor: Member, proposalId: string, input: DeclineBudgetProposalInput) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  await requireHolder(actor, proposalRow);
  requireOpen(proposalRow);
  await scopeOf(actor, proposalRow, false);

  const note = input.note.trim();
  if (!note) {
    throw new AppError("Say why you're declining it — the person who proposed it will read this");
  }

  const eventBudget =
    proposalRow.kind === "event_deficit" && proposalRow.eventCycleId
      ? await getBudgetCycleForScope(actor, proposalRow.eventCycleId)
      : null;

  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(budgetProposal)
      .set({ status: "declined", decidedBy: actor.id, decidedAt: new Date(), decisionNote: note })
      .where(eq(budgetProposal.id, proposalId))
      .returning();
    // A declined overspend is not forgiven or hidden: it stays on the event's
    // books as unrecovered. But the decision is made, so the books are closed.
    if (eventBudget) {
      await tx.update(budgetCycle).set({ settledAt: new Date() }).where(eq(budgetCycle.id, eventBudget.id));
    }
    return updated;
  });
}

// The holder marks an approved proposal closed once it has been spent or
// abandoned. What was approved and not spent is then no longer committed, so the
// balance it was holding back is released. A closed proposal takes no more
// expenses.
export async function closeBudgetProposal(actor: Member, proposalId: string) {
  const proposalRow = await getBudgetProposal(actor, proposalId);
  await requireHolder(actor, proposalRow);
  if (proposalRow.status !== "approved") {
    throw new ConflictError("Only an approved proposal can be closed");
  }
  if (proposalRow.kind !== "spending") {
    throw new ConflictError("Only a spending proposal can be closed — a funding request has already moved its money");
  }
  if (proposalRow.cycleId !== null) {
    // An event's budget can be finished already; closing is still the owner's call.
    await getBudgetCycle(actor, proposalRow.budgetCycleId!);
  } else {
    requireModuleEnabled(await getCommunity(actor), "budget");
  }

  const [updated] = await db
    .update(budgetProposal)
    .set({ status: "closed" })
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
  /**
   * For a request about an event: the people backing it only by coming to the
   * event, not counted in `supporterCount`. "N coming + M supporting".
   */
  comingCount: number;
  /** The event a request is about, else null. */
  eventName: string | null;
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

  const eventIds = [...new Set(proposals.map((p) => p.eventCycleId).filter((id): id is string => id !== null))];
  const eventNames = new Map<string, string>();
  const comingByEvent = new Map<string, Set<string>>();
  if (eventIds.length > 0) {
    for (const e of await db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(inArray(cycle.id, eventIds))) {
      eventNames.set(e.id, e.name);
    }
    for (const r of await db
      .select({ cycleId: participation.cycleId, memberId: participation.memberId })
      .from(participation)
      .where(and(inArray(participation.cycleId, eventIds), eq(participation.status, "coming")))) {
      (comingByEvent.get(r.cycleId) ?? comingByEvent.set(r.cycleId, new Set()).get(r.cycleId)!).add(r.memberId);
    }
  }

  return proposals.map((proposal) => {
    const rows = support.filter((s) => s.proposalId === proposal.id);
    const mayNameThem = holder || proposal.submittedBy === actor.id;
    // A request about an event is also backed by the people coming to it, each
    // counted once and never on top of the proposer or an explicit supporter.
    const known = new Set([...rows.map((r) => r.memberId), proposal.submittedBy]);
    const comingOnly =
      proposal.kind !== "spending" && proposal.eventCycleId
        ? [...(comingByEvent.get(proposal.eventCycleId) ?? [])].filter((id) => !known.has(id)).length
        : 0;
    return {
      proposal,
      backing: backingFor(proposal, rows.length + comingOnly, perBacker),
      supporterCount: rows.length,
      iSupport: rows.some((r) => r.memberId === actor.id),
      supporters: mayNameThem ? rows.map((r) => r.name) : null,
      comingCount: comingOnly,
      eventName: proposal.eventCycleId ? (eventNames.get(proposal.eventCycleId) ?? null) : null,
    };
  });
}

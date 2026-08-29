import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { eventProposal, eventProposalConflictPing } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError } from "../errors";
import { cycleScopeCondition, getEventProposal } from "./crud";
import { recomputeEventConflicts, requireEventSchedulingOwner } from "./conflicts";

type Member = typeof memberTable.$inferSelect;

// Owner-only. Always recomputes conflicts fresh first — "flags
// proposals ... on owner review" (spec), so the review list never
// shows a stale flag left over from before a host fixed their slots.
export async function listEventProposalsForReview(actor: Member, cycleId?: string | null) {
  await requireEventSchedulingOwner(actor);
  await recomputeEventConflicts(actor, cycleId);

  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(eventProposal)
    .where(and(...conditions))
    .orderBy(desc(eventProposal.createdAt));
}

export const confirmEventProposalSlotInput = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type ConfirmEventProposalSlotInput = z.infer<typeof confirmEventProposalSlotInput>;

// Owner-only. Deliberately not constrained to one of the proposal's
// own preferredSlots — see event-scheduling.ts's schema comment on
// confirmedSlot for why a compromise slot has to be allowed.
export async function confirmEventProposalSlot(
  actor: Member,
  proposalId: string,
  input: ConfirmEventProposalSlotInput,
) {
  await requireEventSchedulingOwner(actor);
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.publishedAt) {
    throw new ConflictError("This proposal has already been published");
  }
  if (proposal.status === "declined") {
    throw new ConflictError("This proposal was declined");
  }

  const [updated] = await db
    .update(eventProposal)
    .set({ status: "confirmed", confirmedSlot: input })
    .where(eq(eventProposal.id, proposalId))
    .returning();
  return updated;
}

export async function declineEventProposal(actor: Member, proposalId: string) {
  await requireEventSchedulingOwner(actor);
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.publishedAt) {
    throw new ConflictError("This proposal has already been published");
  }

  const [updated] = await db
    .update(eventProposal)
    .set({ status: "declined" })
    .where(eq(eventProposal.id, proposalId))
    .returning();
  return updated;
}

// "Flagged proposals' hosts get pinged" — owner-only, one row per
// nudge, no dedup guard (matches coordinatorPing's own precedent of
// allowing repeat pings without one).
export async function pingConflictHost(actor: Member, proposalId: string) {
  await requireEventSchedulingOwner(actor);
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.status !== "conflict") {
    throw new ConflictError("This proposal isn't currently flagged as conflicting");
  }

  const [created] = await db
    .insert(eventProposalConflictPing)
    .values({ proposalId, createdBy: actor.id })
    .returning();
  return created;
}

// The submitter's own view — "you've been pinged about this" on their
// proposal, without needing scheduling-owner access.
export async function listMyEventProposalPings(actor: Member, proposalId: string) {
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.submittedBy !== actor.id) {
    throw new ForbiddenError("Only the submitter can see pings on this proposal");
  }
  return db
    .select()
    .from(eventProposalConflictPing)
    .where(eq(eventProposalConflictPing.proposalId, proposalId))
    .orderBy(desc(eventProposalConflictPing.createdAt));
}

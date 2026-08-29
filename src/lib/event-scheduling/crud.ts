import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, cycle, eventProposal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";

type Member = typeof memberTable.$inferSelect;
type EventProposalRow = typeof eventProposal.$inferSelect;

const slotInput = z
  .object({
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  })
  .refine((s) => new Date(s.endsAt) > new Date(s.startsAt), {
    message: "endsAt must be after startsAt",
    path: ["endsAt"],
  });
export type EventSlot = { startsAt: string; endsAt: string };

export const createEventProposalInput = z.object({
  cycleId: z.string().uuid().nullable().optional(),
  host: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  durationMinutes: z.number().int().positive(),
  spaceNeeds: z.string().nullable().optional(),
  preferredSlots: z.array(slotInput).min(1),
});
export type CreateEventProposalInput = z.infer<typeof createEventProposalInput>;

export const updateEventProposalInput = createEventProposalInput.partial();
export type UpdateEventProposalInput = z.infer<typeof updateEventProposalInput>;

// Shared by conflicts.ts/schedule.ts too — `cycleId === undefined`
// means "don't filter by cycle at all," `null` means "cycle-less
// proposals only" (isNull, since eq(..., null) would generate an
// always-false `= NULL` in SQL).
export function cycleScopeCondition(cycleId: string | null | undefined) {
  if (cycleId === undefined) return undefined;
  return cycleId === null ? isNull(eventProposal.cycleId) : eq(eventProposal.cycleId, cycleId);
}

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// "Any member submits a proposal" — no owner gate; the scheduling-
// owner task only governs review/confirm/publish (see review.ts).
export async function createEventProposal(actor: Member, input: CreateEventProposalInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "event_scheduling");

  if (input.cycleId) {
    const [cycleRow] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, input.cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
  }

  const [created] = await db
    .insert(eventProposal)
    .values({
      communityId: actor.communityId,
      cycleId: input.cycleId ?? null,
      submittedBy: actor.id,
      host: input.host,
      title: input.title,
      description: input.description ?? null,
      durationMinutes: input.durationMinutes,
      spaceNeeds: input.spaceNeeds ?? null,
      preferredSlots: input.preferredSlots,
    })
    .returning();
  return created;
}

export async function getEventProposal(actor: Member, proposalId: string) {
  const [row] = await db
    .select()
    .from(eventProposal)
    .where(and(eq(eventProposal.id, proposalId), eq(eventProposal.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Proposal not found");
  }
  return row;
}

// Editable while still open to change hands — `proposed` (nothing to
// resolve yet) or `conflict` (this is exactly how a host resolves one:
// "can each propose a different slot," per spec). Locked once the
// owner confirms or declines it, and again once the batch publishes.
function requireEditable(proposal: EventProposalRow) {
  if (proposal.publishedAt) {
    throw new AppError("This proposal has already been published");
  }
  if (proposal.status !== "proposed" && proposal.status !== "conflict") {
    throw new AppError(`This proposal is already ${proposal.status} and can't be edited`);
  }
}

// Submitter-only. Doesn't touch `status` on its own — a `conflict`
// flag only clears on the owner's next review (recomputeEventConflicts
// in conflicts.ts), the single source of truth for whether an edit
// actually resolved the overlap.
export async function updateEventProposal(
  actor: Member,
  proposalId: string,
  input: UpdateEventProposalInput,
) {
  const proposal = await getEventProposal(actor, proposalId);
  if (proposal.submittedBy !== actor.id) {
    throw new ForbiddenError("Only the submitter can edit this proposal");
  }
  requireEditable(proposal);

  if (input.cycleId) {
    const [cycleRow] = await db
      .select({ id: cycle.id })
      .from(cycle)
      .where(and(eq(cycle.id, input.cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
  }

  const [updated] = await db
    .update(eventProposal)
    .set({
      ...(input.cycleId !== undefined && { cycleId: input.cycleId }),
      ...(input.host !== undefined && { host: input.host }),
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.durationMinutes !== undefined && { durationMinutes: input.durationMinutes }),
      ...(input.spaceNeeds !== undefined && { spaceNeeds: input.spaceNeeds }),
      ...(input.preferredSlots !== undefined && { preferredSlots: input.preferredSlots }),
    })
    .where(eq(eventProposal.id, proposalId))
    .returning();
  return updated;
}

export async function listMyEventProposals(actor: Member, cycleId?: string | null) {
  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    eq(eventProposal.submittedBy, actor.id),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(eventProposal)
    .where(and(...conditions))
    .orderBy(desc(eventProposal.createdAt));
}

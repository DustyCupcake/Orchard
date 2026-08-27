import { and, count, desc, eq, inArray, lt } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { browseInterest, community, endorsement, member, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { getUnmetRequirements, describeRequirement } from "./requirements";
import { assignmentCount, loadTaskForUpdate, performClaimInTx } from "./lifecycle";
import { requireTaskInCommunity } from "./shared";

type Member = typeof memberTable.$inferSelect;

// `community_endorsed`'s candidacy/endorsement mechanism — see
// docs/spec.md's "Endorsement-gated tasks". Generic on purpose: Admins
// (see admins.ts) is just the flagship instance, not a special case
// this module knows about.

export async function expressCandidacy(actor: Member, taskId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.openness !== "community_endorsed") {
      throw new ConflictError("This task doesn't use community-endorsed openness");
    }
    if (!current.browsePeriodEnd || current.browsePeriodEnd.getTime() <= Date.now()) {
      throw new ConflictError("There's no open browse window for this task");
    }

    const [existingAssignment] = await tx
      .select()
      .from(taskAssignment)
      .where(and(eq(taskAssignment.taskId, taskId), eq(taskAssignment.memberId, actor.id)));
    if (existingAssignment) {
      throw new ConflictError("You already hold this task");
    }

    const [existingCandidacy] = await tx
      .select()
      .from(browseInterest)
      .where(
        and(
          eq(browseInterest.taskId, taskId),
          eq(browseInterest.memberId, actor.id),
          eq(browseInterest.status, "open"),
        ),
      );
    if (existingCandidacy) {
      throw new ConflictError("You already have an open candidacy for this task");
    }

    // "The pool of people who can even attempt a candidacy is bounded
    // by ordinary Requirement logic" — see docs/spec.md's "Admins".
    const unmet = await getUnmetRequirements(tx, actor, taskId);
    if (unmet.length > 0) {
      const summary = unmet.map((r) => describeRequirement(r)).join("; ");
      throw new ForbiddenError(`You don't meet this task's requirements: ${summary}`);
    }

    const [created] = await tx
      .insert(browseInterest)
      .values({ taskId, memberId: actor.id })
      .returning();
    return created;
  });
}

async function requireOpenCandidacyForUpdate(tx: Tx, taskId: string, browseInterestId: string) {
  const [candidacy] = await tx
    .select()
    .from(browseInterest)
    .where(and(eq(browseInterest.id, browseInterestId), eq(browseInterest.taskId, taskId)))
    .for("update");
  if (!candidacy) {
    throw new NotFoundError("Candidacy not found");
  }
  if (candidacy.status !== "open") {
    throw new ConflictError(`This candidacy is already ${candidacy.status}`);
  }
  return candidacy;
}

export async function endorseCandidacy(actor: Member, taskId: string, browseInterestId: string) {
  return db.transaction(async (tx) => {
    const current = await loadTaskForUpdate(tx, taskId, actor.communityId);

    if (current.openness !== "community_endorsed") {
      throw new ConflictError("This task doesn't use community-endorsed openness");
    }
    if (!current.browsePeriodEnd || current.browsePeriodEnd.getTime() <= Date.now()) {
      throw new ConflictError("The browse window for this task has closed");
    }

    const candidacy = await requireOpenCandidacyForUpdate(tx, taskId, browseInterestId);
    if (candidacy.memberId === actor.id) {
      throw new ForbiddenError("You can't endorse your own candidacy");
    }

    const [existingEndorsement] = await tx
      .select()
      .from(endorsement)
      .where(
        and(eq(endorsement.browseInterestId, browseInterestId), eq(endorsement.endorsedBy, actor.id)),
      );
    if (existingEndorsement) {
      throw new ConflictError("You've already endorsed this candidacy");
    }

    await tx.insert(endorsement).values({ browseInterestId, endorsedBy: actor.id });

    const [{ value: endorsementCount }] = await tx
      .select({ value: count() })
      .from(endorsement)
      .where(eq(endorsement.browseInterestId, browseInterestId));

    const threshold = current.endorsementThreshold ?? Infinity;
    const holderCount = await assignmentCount(tx, taskId);
    const capacityAllows = current.capacity === null || holderCount < current.capacity;

    if (endorsementCount < threshold || !capacityAllows) {
      const [stillOpen] = await tx
        .select()
        .from(browseInterest)
        .where(eq(browseInterest.id, browseInterestId));
      return { status: "open" as const, candidacy: stillOpen, endorsementCount };
    }

    const [confirmed] = await tx
      .update(browseInterest)
      .set({ status: "confirmed" })
      .where(eq(browseInterest.id, browseInterestId))
      .returning();

    // performClaimInTx re-loads and re-locks the task row — fine within
    // the same transaction, and it's what actually creates the
    // TaskAssignment for the confirmed candidate.
    const [candidateMember] = await tx.select().from(member).where(eq(member.id, candidacy.memberId));
    await performClaimInTx(tx, candidateMember, taskId);

    // Admins' gate latches permanently open once any task carrying the
    // Community's admins tag is actually claimed — see
    // src/lib/settings/admins.ts and community.ts's adminsEverClaimed.
    const [communityRow] = await tx
      .select()
      .from(community)
      .where(eq(community.id, actor.communityId));
    if (
      communityRow &&
      !communityRow.adminsEverClaimed &&
      current.tags.includes(communityRow.adminsTag)
    ) {
      await tx
        .update(community)
        .set({ adminsEverClaimed: true })
        .where(eq(community.id, actor.communityId));
    }

    return { status: "confirmed" as const, candidacy: confirmed, endorsementCount };
  });
}

export async function withdrawCandidacy(actor: Member, taskId: string, browseInterestId: string) {
  return db.transaction(async (tx) => {
    const [candidacy] = await tx
      .select()
      .from(browseInterest)
      .where(and(eq(browseInterest.id, browseInterestId), eq(browseInterest.taskId, taskId)))
      .for("update");
    if (!candidacy) {
      throw new NotFoundError("Candidacy not found");
    }
    if (candidacy.memberId !== actor.id) {
      throw new ForbiddenError("Only the candidate can withdraw their own candidacy");
    }
    if (candidacy.status !== "open") {
      throw new ConflictError(`Cannot withdraw a candidacy that is already ${candidacy.status}`);
    }

    await tx.delete(endorsement).where(eq(endorsement.browseInterestId, browseInterestId));
    await tx.delete(browseInterest).where(eq(browseInterest.id, browseInterestId));
  });
}

export async function listCandidacies(actor: Member, taskId: string) {
  await requireTaskInCommunity(actor, taskId);

  const candidacies = await db
    .select()
    .from(browseInterest)
    .where(eq(browseInterest.taskId, taskId))
    .orderBy(desc(browseInterest.expressedAt));
  if (candidacies.length === 0) {
    return [];
  }

  const counts = await db
    .select({ browseInterestId: endorsement.browseInterestId, value: count() })
    .from(endorsement)
    .where(
      inArray(
        endorsement.browseInterestId,
        candidacies.map((c) => c.id),
      ),
    )
    .groupBy(endorsement.browseInterestId);
  const countById = new Map(counts.map((c) => [c.browseInterestId, c.value]));

  return candidacies.map((c) => ({ ...c, endorsementCount: countById.get(c.id) ?? 0 }));
}

// Which of the given candidacies has the actor already endorsed — for
// the detail view to show "Endorsed" instead of an Endorse button.
export async function listMyEndorsements(actor: Member, browseInterestIds: string[]) {
  if (browseInterestIds.length === 0) {
    return new Set<string>();
  }
  const rows = await db
    .select({ browseInterestId: endorsement.browseInterestId })
    .from(endorsement)
    .where(
      and(eq(endorsement.endorsedBy, actor.id), inArray(endorsement.browseInterestId, browseInterestIds)),
    );
  return new Set(rows.map((r) => r.browseInterestId));
}

// The scheduled counterpart to the eager confirm-on-endorsement check
// above: a candidacy that never cleared its threshold before the
// browse window closed is a real gap, not a silent nothing — see
// docs/spec.md's "one that doesn't [clear the threshold], doesn't
// [convert] — the same honest treatment any other unfilled critical
// task already gets." Reuses src/lib/scheduler (see src/instrumentation.ts),
// same as the attention-level job.
export async function resolveBrowsePeriods() {
  const expired = await db
    .select({ id: browseInterest.id })
    .from(browseInterest)
    .innerJoin(task, eq(browseInterest.taskId, task.id))
    .where(and(eq(browseInterest.status, "open"), lt(task.browsePeriodEnd, new Date())));

  if (expired.length === 0) {
    return { checked: 0, failed: 0 };
  }

  await db
    .update(browseInterest)
    .set({ status: "failed" })
    .where(
      inArray(
        browseInterest.id,
        expired.map((e) => e.id),
      ),
    );

  return { checked: expired.length, failed: expired.length };
}

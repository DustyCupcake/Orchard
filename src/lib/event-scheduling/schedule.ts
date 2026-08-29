import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { eventProposal } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError } from "../errors";
import { cycleScopeCondition } from "./crud";
import { requireEventSchedulingOwner } from "./conflicts";

type Member = typeof memberTable.$inferSelect;

// Owner-only. "Once every proposal in the cycle is confirmed or
// declined, the owner publishes — locks every proposal from further
// edits and makes the schedule visible to all members." A single
// `publishedAt` timestamp, set in bulk, is both the lock and the
// /schedule visibility gate — no separate "the schedule" entity (see
// event-scheduling.ts's schema comment).
export async function publishEventSchedule(actor: Member, cycleId?: string | null) {
  await requireEventSchedulingOwner(actor);

  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    isNull(eventProposal.publishedAt),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);
  const pending = await db
    .select()
    .from(eventProposal)
    .where(and(...conditions));

  if (pending.length === 0) {
    return { publishedCount: 0, publishedAt: null };
  }

  const unresolved = pending.filter((p) => p.status === "proposed" || p.status === "conflict");
  if (unresolved.length > 0) {
    throw new ConflictError(
      `${unresolved.length} proposal(s) still need a confirmed slot or a decline before publishing`,
    );
  }

  const publishedAt = new Date();
  await db
    .update(eventProposal)
    .set({ publishedAt })
    .where(and(...conditions));
  return { publishedCount: pending.length, publishedAt };
}

// Open to any member, no owner gate — "readable by all members" once
// published.
export async function listPublishedSchedule(actor: Member, cycleId?: string | null) {
  const conditions = [
    eq(eventProposal.communityId, actor.communityId),
    isNotNull(eventProposal.publishedAt),
    cycleScopeCondition(cycleId),
  ].filter((c) => c !== undefined);
  return db
    .select()
    .from(eventProposal)
    .where(and(...conditions));
}

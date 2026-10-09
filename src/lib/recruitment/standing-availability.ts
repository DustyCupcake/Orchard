import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db";
import { member, recruitmentStandingAvailability } from "@/db/schema";

// docs/admission-flow.md §2: "the recruitment holders offer their own availability".
// Standing availability is one grid a holder fills in and edits whenever they like,
// covering a rolling window of the next few weeks. Every incoming interview is
// matched against it *as it stands* — it is read, never copied onto a poll, so
// there is nothing to re-paint for each person and a holder who was away can come
// back and fill in their week. (It is what the recruitment-mode subscription, an
// on/off alert flag, grows into.)
export const STANDING_WINDOW_DAYS = 14;

/** A member's own grid, or null if they have never set one. */
export async function getStandingAvailability(memberId: string) {
  const [row] = await db
    .select()
    .from(recruitmentStandingAvailability)
    .where(eq(recruitmentStandingAvailability.memberId, memberId));
  return row ?? null;
}

/**
 * Replace a member's standing grid. The window is always [now, now + 14 days]: it
 * is rolling, so what was offered for dates that have passed simply drops out, and
 * anything outside the window is not kept (a slot is only ever worth offering where
 * an interview could actually be scheduled).
 */
export async function setStandingAvailability(memberId: string, slots: string[], now: Date = new Date()) {
  const windowStart = now;
  const windowEnd = new Date(now.getTime() + STANDING_WINDOW_DAYS * 86_400_000);
  const kept = [...new Set(slots)].filter((slot) => {
    const t = new Date(slot).getTime();
    return Number.isFinite(t) && t >= windowStart.getTime() && t <= windowEnd.getTime();
  });

  const [row] = await db
    .insert(recruitmentStandingAvailability)
    .values({ memberId, availableSlots: kept, windowStart, windowEnd, updatedAt: now })
    .onConflictDoUpdate({
      target: recruitmentStandingAvailability.memberId,
      set: { availableSlots: kept, windowStart, windowEnd, updatedAt: now },
    })
    .returning();
  return row;
}

/**
 * Everybody's standing slots in a community, keyed by member — only grids that
 * haven't lapsed (a grid nobody has touched for longer than its window offers
 * nothing: a member who has gone quiet is not "available" for next month), and only
 * slots still in the future.
 */
export async function loadStandingSlots(communityId: string, memberIds?: string[], now: Date = new Date()) {
  const rows = await db
    .select({ memberId: recruitmentStandingAvailability.memberId, slots: recruitmentStandingAvailability.availableSlots })
    .from(recruitmentStandingAvailability)
    .innerJoin(member, eq(member.id, recruitmentStandingAvailability.memberId))
    .where(
      and(
        eq(member.communityId, communityId),
        gt(recruitmentStandingAvailability.windowEnd, now),
        ...(memberIds ? [inArray(recruitmentStandingAvailability.memberId, memberIds)] : []),
      ),
    );
  const nowIso = now.getTime();
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    out.set(r.memberId, new Set((r.slots as string[]).filter((s) => new Date(s).getTime() >= nowIso)));
  }
  return out;
}

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { recruitmentStandingAvailability } from "@/db/schema";

/**
 * Get a member's standing availability. Returns null if not set.
 */
export async function getStandingAvailability(memberId: string) {
  const [row] = await db
    .select()
    .from(recruitmentStandingAvailability)
    .where(eq(recruitmentStandingAvailability.memberId, memberId));
  return row ?? null;
}

/**
 * Upsert a member's standing availability. The grid covers a rolling window.
 * The window is automatically set to [now, now + 14 days] if not provided.
 */
export async function upsertStandingAvailability(input: {
  memberId: string;
  availableSlots: string[]; // ISO datetime strings, 30-min granularity
  windowStart?: Date;
  windowEnd?: Date;
}) {
  const now = new Date();
  const windowStart = input.windowStart ?? now;
  const windowEnd = input.windowEnd ?? new Date(now.getTime() + 14 * 86_400_000);

  const [row] = await db
    .insert(recruitmentStandingAvailability)
    .values({
      memberId: input.memberId,
      availableSlots: input.availableSlots,
      windowStart,
      windowEnd,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: recruitmentStandingAvailability.memberId,
      set: {
        availableSlots: input.availableSlots,
        windowStart,
        windowEnd,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}

/**
 * Get all recruitment holders' standing availability for a community.
 * Used when matching holders against an incoming applicant.
 */
export async function getAllHoldersStandingAvailability(
  communityId: string,
  holderIds: string[],
) {
  const rows = await db
    .select({
      memberId: recruitmentStandingAvailability.memberId,
      availableSlots: recruitmentStandingAvailability.availableSlots,
      windowStart: recruitmentStandingAvailability.windowStart,
      windowEnd: recruitmentStandingAvailability.windowEnd,
    })
    .from(recruitmentStandingAvailability)
    .where(
      and(
        eq(recruitmentStandingAvailability.memberId, communityId),
        inArray(recruitmentStandingAvailability.memberId, holderIds),
      ),
    );
  return rows;
}

/**
 * Check which holders have availability matching a given applicant's slots.
 * Returns the member IDs of holders whose standing availability overlaps
 * with the applicant's submitted availability.
 */
export function findHoldersMatchingApplicant(
  holders: { memberId: string; availableSlots: string[] }[],
  applicantSlots: string[],
): string[] {
  const applicantSet = new Set(applicantSlots);
  return holders
    .filter((h) => h.availableSlots.some((slot) => applicantSet.has(slot)))
    .map((h) => h.memberId);
}
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { shiftOccurrence, shiftSeries, shiftSignup } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireShiftCoordinator } from "./series";
import { effectiveCapacity, getShiftOccurrence } from "./occurrences";

type Member = typeof memberTable.$inferSelect;

// "Any member can sign up for an occurrence up to its capacity (first-
// come ... no waitlist for v1)."
export async function signUpForShift(actor: Member, occurrenceId: string) {
  const { occurrence, series } = await getShiftOccurrence(actor, occurrenceId);
  if (series.archivedAt) {
    throw new ConflictError("This shift series is archived");
  }
  if (new Date() >= new Date(occurrence.startsAt)) {
    throw new ConflictError("This occurrence has already started");
  }

  const [existing] = await db
    .select({ id: shiftSignup.id })
    .from(shiftSignup)
    .where(and(eq(shiftSignup.occurrenceId, occurrenceId), eq(shiftSignup.memberId, actor.id)));
  if (existing) {
    throw new ConflictError("You're already signed up for this occurrence");
  }

  const currentSignups = await db
    .select({ id: shiftSignup.id })
    .from(shiftSignup)
    .where(eq(shiftSignup.occurrenceId, occurrenceId));
  if (currentSignups.length >= effectiveCapacity(occurrence, series)) {
    throw new ConflictError("This shift is full");
  }

  const [created] = await db.insert(shiftSignup).values({ occurrenceId, memberId: actor.id }).returning();
  return created;
}

// "Can withdraw before it starts" — a real delete, freeing the slot;
// there's no "withdrawn" status in the shift_signup_status enum.
export async function withdrawFromShift(actor: Member, occurrenceId: string) {
  const { occurrence } = await getShiftOccurrence(actor, occurrenceId);
  if (new Date() >= new Date(occurrence.startsAt)) {
    throw new ConflictError("This occurrence has already started");
  }

  const deleted = await db
    .delete(shiftSignup)
    .where(and(eq(shiftSignup.occurrenceId, occurrenceId), eq(shiftSignup.memberId, actor.id)))
    .returning();
  if (deleted.length === 0) {
    throw new NotFoundError("You're not signed up for this occurrence");
  }
  return deleted[0];
}

// Safe without an explicit community filter — a member's own signups
// can only ever point at occurrences from their own community, since
// signUpForShift already validated that at creation time.
export async function listMySignups(actor: Member) {
  return db
    .select()
    .from(shiftSignup)
    .where(eq(shiftSignup.memberId, actor.id))
    .orderBy(desc(shiftSignup.signedUpAt));
}

// "A coordinator view ... listing each occurrence's current signups."
export async function listSignupsForOccurrence(actor: Member, occurrenceId: string) {
  const { series } = await getShiftOccurrence(actor, occurrenceId);
  await requireShiftCoordinator(actor, series);

  return db
    .select()
    .from(shiftSignup)
    .where(eq(shiftSignup.occurrenceId, occurrenceId))
    .orderBy(asc(shiftSignup.signedUpAt));
}

// Joined with occurrence/series info — the shape the /shifts page needs
// to show "your past shifts" alongside a mark-completed prompt, without
// a second round of per-occurrence lookups. Same community-scoping
// argument as listMySignups above (a member's own signups can only
// ever point at their own community's occurrences).
export async function listMySignupsWithOccurrence(actor: Member) {
  return db
    .select({ signup: shiftSignup, occurrence: shiftOccurrence, series: shiftSeries })
    .from(shiftSignup)
    .innerJoin(shiftOccurrence, eq(shiftSignup.occurrenceId, shiftOccurrence.id))
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(eq(shiftSignup.memberId, actor.id))
    .orderBy(desc(shiftOccurrence.startsAt));
}

async function getSignupWithContext(actor: Member, signupId: string) {
  const [row] = await db
    .select({ signup: shiftSignup, occurrence: shiftOccurrence, series: shiftSeries })
    .from(shiftSignup)
    .innerJoin(shiftOccurrence, eq(shiftSignup.occurrenceId, shiftOccurrence.id))
    .innerJoin(shiftSeries, eq(shiftOccurrence.seriesId, shiftSeries.id))
    .where(and(eq(shiftSignup.id, signupId), eq(shiftSeries.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Signup not found");
  }
  return row;
}

function requireOccurrenceEnded(occurrence: { endsAt: Date | string }) {
  if (new Date() < new Date(occurrence.endsAt)) {
    throw new ConflictError("This occurrence hasn't ended yet");
  }
}

// "Self-reported by the signed-up member once the occurrence's endsAt
// has passed" — the same trust posture (access follows the task, not a
// verification chain) everything else in this codebase already uses.
export async function markShiftSignupCompleted(actor: Member, signupId: string) {
  const { signup, occurrence } = await getSignupWithContext(actor, signupId);
  if (signup.memberId !== actor.id) {
    throw new ForbiddenError("Only the signed-up member can mark their own completion");
  }
  requireOccurrenceEnded(occurrence);
  if (signup.status !== "signed_up") {
    throw new ConflictError(`This signup is already ${signup.status}`);
  }

  const [updated] = await db
    .update(shiftSignup)
    .set({ status: "completed" })
    .where(eq(shiftSignup.id, signupId))
    .returning();
  return updated;
}

// "A series coordinator can also mark a signup no_show — a real,
// visible, logged call, not automatic, the same posture Requirement
// waiving already established."
export async function markShiftSignupNoShow(actor: Member, signupId: string) {
  const { signup, occurrence, series } = await getSignupWithContext(actor, signupId);
  await requireShiftCoordinator(actor, series);
  requireOccurrenceEnded(occurrence);
  if (signup.status !== "signed_up") {
    throw new ConflictError(`This signup is already ${signup.status}`);
  }

  const [updated] = await db
    .update(shiftSignup)
    .set({ status: "no_show" })
    .where(eq(shiftSignup.id, signupId))
    .returning();
  return updated;
}

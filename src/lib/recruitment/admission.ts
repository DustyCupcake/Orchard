import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/db";
import type { DbOrTx } from "@/db";
import {
  admission,
  admissionLane,
  communityInvite,
  community,
  cycle,
  evaluation,
  form,
  formResponse,
  member,
  memberIdentity,
  memberLanguage,
  participation,
  profileQuestion,
  recruitmentApplicationInvite,
  recruitmentDecision,
} from "@/db/schema";
import type { AdmissionArrivalRoute, AdmissionOrigin } from "@/db/schema";
import type { FormField } from "../forms";
import { ConflictError, NotFoundError } from "../errors";
import { findExistingMemberByLoginEmail } from "../member";
import { seedCycleParticipation } from "../participation";
import { seedPrimaryContactMethod } from "../contact-methods";
import { answerProfileQuestion } from "../profile-questions";
import { sendAdmissionAcceptedEmail, sendAdmissionReceivedEmail } from "../mailer";
import { publicAppUrl } from "../public-url";
import { countCapacityHolds } from "./joining";
import { requireCycleInitiationEligibility } from "../cycles/crud";
import type { member as memberTable } from "@/db/schema";
import type { AdmissionLane, AdmissionLaneSnapshot } from "./admission-lanes";
import { computeAdmissionStage, describeAdmissionStage } from "./admission-stage";
import { declarationFromInvite, laneSnapshot, resolveInviteLane, resolvePublicLane } from "./admission-lanes";

// docs/admission-flow.md §4 and §6. The arrival row is created here and
// nowhere else, and a person becomes a Member here and nowhere else. Every
// route into the community — a direct invite, a decided application, the
// end of a community check, the support shortcut — ends in `admitArrival`,
// so what a new member gets (an identity, a way to be reached, a place in
// the event, the answers they already gave) is the same whichever way they
// arrived, and cannot drift between four copies of it.

type Arrival = typeof admission.$inferSelect;
type Member = typeof memberTable.$inferSelect;

export type ArrivalInput = {
  communityId: string;
  cycleId: string | null;
  email: string;
  name: string;
  lane: AdmissionLane;
  route: AdmissionArrivalRoute;
  origin?: AdmissionOrigin;
  inviteId?: string | null;
  formResponseId?: string | null;
  /** The person has already submitted their application, as they have if the arrival comes from one. */
  applicationSubmitted?: boolean;
  /** The person agreed to the community check's disclosure at the door. */
  consentGiven?: boolean;
};

/**
 * Refuse an address that is already somebody — a member, or a person already
 * in the funnel — with a sentence saying which. Exposed so a caller can ask
 * *before* it stores anything (an application's answers, say), rather than
 * leaving an orphan behind when the arrival can't be made.
 */
export async function assertEmailFreeToArrive(communityId: string, rawEmail: string): Promise<void> {
  const email = rawEmail.trim().toLowerCase();
  if (await findExistingMemberByLoginEmail(email)) {
    throw new ConflictError("This email already belongs to a member — log in instead");
  }
  const [existing] = await db
    .select()
    .from(admission)
    .where(and(eq(admission.communityId, communityId), eq(admission.email, email)));
  if (existing) {
    throw new ConflictError(
      existing.declinedAt || existing.withdrawnAt
        ? "A request to join with this email has already been closed. Contact the community if you'd like it looked at again."
        : "There is already a request to join with this email in progress — use the private link you were sent to follow it.",
    );
  }
}

/**
 * Create the arrival, with the lane's path copied onto it (§1 principle 2:
 * the path is fixed at entry, so editing the lane afterwards changes the next
 * arrival and never somebody in flight). The caller has already checked the
 * doors and capacity; this checks the one thing only it can see — that this
 * address isn't already someone, or already in the funnel — and tells the
 * person we have them.
 */
export async function createAdmissionArrival(input: ArrivalInput): Promise<{ arrival: Arrival; token: string }> {
  const email = input.email.trim().toLowerCase();
  await assertEmailFreeToArrive(input.communityId, email);

  const snapshot: AdmissionLaneSnapshot = laneSnapshot(input.lane);
  const token = randomBytes(24).toString("base64url");
  const now = new Date();
  const [arrival] = await db
    .insert(admission)
    .values({
      communityId: input.communityId,
      cycleId: input.cycleId,
      email,
      name: input.name.trim(),
      laneId: input.lane.id,
      route: input.route,
      origin: input.origin ?? "funnel",
      inviteId: input.inviteId ?? null,
      formResponseId: input.formResponseId ?? null,
      ...snapshot,
      token,
      supportToken: randomBytes(24).toString("base64url"),
      consentGivenAt: input.consentGiven ? now : null,
      applicationSubmittedAt: input.applicationSubmitted ? now : null,
    })
    .returning();

  // A lane with an interview makes the arrival's interview poll as they enter —
  // the interview comes before the decision (§2). If the interviews door is shut it
  // is made when the door reopens: the arrival waits at this step, never skips it.
  // Best-effort: a failure here must not turn someone's application into an error.
  if (snapshot.requiredInterview && snapshot.requiredVerification === "none") {
    try {
      const { ensureInterviewPoll } = await import("./interviews");
      await ensureInterviewPoll(arrival.id);
    } catch (err) {
      console.error("[admission] could not make the interview poll", err);
    }
  }

  // Direct arrivals are signed in on the spot and told in the same breath;
  // everyone else is going to wait, and a link they can come back to is what
  // makes the wait bearable (§6).
  if (!(snapshot.requiredVerification === "none" && !snapshot.requiredApplication && !snapshot.requiredInterview)) {
    await notifyReceived(arrival);
  }
  return { arrival, token };
}

async function communityNameOf(communityId: string): Promise<string> {
  const [row] = await db.select({ name: community.name }).from(community).where(eq(community.id, communityId));
  return row?.name ?? "the community";
}

export function admissionLink(token: string): string {
  return `${publicAppUrl()}/admission/${token}`;
}

// Best-effort by design: an unreachable mail relay must not turn a person's
// application into an error page, and the private link is on the page they
// land on whether or not the email left.
async function notifyReceived(arrival: Arrival) {
  try {
    await sendAdmissionReceivedEmail(arrival.email, {
      name: arrival.name,
      communityName: await communityNameOf(arrival.communityId),
      statusUrl: admissionLink(arrival.token),
    });
  } catch (err) {
    console.error("[admission] could not send the received email", err);
  }
}

export async function getArrivalByToken(token: string): Promise<Arrival | null> {
  const [row] = await db.select().from(admission).where(eq(admission.token, token));
  return row ?? null;
}

export async function getArrivalForInvite(inviteId: string): Promise<Arrival | null> {
  const [row] = await db.select().from(admission).where(eq(admission.inviteId, inviteId));
  return row ?? null;
}

/** Close an arrival without admitting it. Nothing is deleted: the record of
 *  who arrived and what happened is the community's history (§4). */
export async function closeArrival(arrivalId: string, how: "declined" | "withdrawn"): Promise<void> {
  const now = new Date();
  await db
    .update(admission)
    .set(how === "declined" ? { declinedAt: now } : { withdrawnAt: now })
    .where(and(eq(admission.id, arrivalId), isNull(admission.admittedMemberId)));
}

/**
 * Write what a decision did to the arrival it is about: that one was recorded,
 * and, for a decline, that the arrival is closed. The decision itself stays
 * the evaluated path's own record (§4); this is the arrival's copy of the one
 * fact every screen needs, so the stage never has to go and read it. An
 * acceptance writes nothing more — admission is the admission function's.
 */
export async function recordArrivalDecision(formResponseId: string, resolution: "accepted" | "declined" | null): Promise<void> {
  if (!resolution) return;
  const arrival = await ensureArrivalForApplication(formResponseId);
  if (!arrival) return;
  const now = new Date();
  await db
    .update(admission)
    .set(resolution === "declined" ? { decisionRecordedAt: now, declinedAt: now } : { decisionRecordedAt: now, declinedAt: null })
    .where(and(eq(admission.id, arrival.id), isNull(admission.admittedMemberId)));
}

export async function getArrivalForFormResponse(formResponseId: string): Promise<Arrival | null> {
  const [row] = await db.select().from(admission).where(eq(admission.formResponseId, formResponseId));
  return row ?? null;
}

// ---------------------------------------------------------------------------
// The one admission function
// ---------------------------------------------------------------------------

export type AdmitOptions = {
  /** Send the "you're in" email. Off for a person who was signed in on the spot. */
  notify?: boolean;
  /** Admit even though the event is full. An administrator's decision, never a default. */
  overrideCapacity?: boolean;
};

export type AdmitResult =
  | { waitlisted: false; memberId: string; created: boolean }
  // Approved, but the event has no room: the arrival waits, and is admitted when
  // room appears (releaseWaitlist) or an administrator overrides.
  | { waitlisted: true; memberId: null; created: false };

/**
 * Admit an arrival: the only place a person becomes a Member of the
 * community through the funnel (§6).
 *
 * Idempotent — a second call for an admitted arrival returns the same member
 * rather than making another, because several triggers can fire close
 * together (the decision, the end of a check, a late support). An address
 * that already belongs to a member is linked to them rather than refused or
 * duplicated: somebody who applied, and separately already had an account, is
 * a real if rare case worth handling gracefully rather than crashing the
 * decision that let them in.
 *
 * What it does not do is decide. Whether someone *should* be admitted is the
 * funnel's question; by the time this runs the answer is yes.
 */
export async function admitArrival(arrivalId: string, opts: AdmitOptions = {}): Promise<AdmitResult> {
  const result = await db.transaction(async (tx) => {
    const [arrival] = await tx.select().from(admission).where(eq(admission.id, arrivalId)).for("update");
    if (!arrival) throw new NotFoundError("Arrival not found");
    if (arrival.admittedMemberId) return { arrival, memberId: arrival.admittedMemberId, created: false, already: true, waitlisted: false };
    if (arrival.declinedAt) throw new ConflictError("This request to join was declined");
    if (arrival.withdrawnAt) throw new ConflictError("This request to join was withdrawn");

    const [invite] = arrival.inviteId
      ? await tx.select().from(communityInvite).where(eq(communityInvite.id, arrival.inviteId))
      : [];
    // An application that came in through an invite carries the vouch on the
    // application itself rather than on the arrival.
    const [linked] = arrival.formResponseId
      ? await tx
          .select({ createdBy: communityInvite.createdBy, id: communityInvite.id })
          .from(recruitmentApplicationInvite)
          .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
          .where(eq(recruitmentApplicationInvite.formResponseId, arrival.formResponseId))
      : [];
    const inviterId = invite?.createdBy ?? linked?.createdBy ?? null;
    const viaInviteId = invite?.id ?? linked?.id ?? null;

    const existing = await findExistingMemberByLoginEmailIn(tx, arrival.email);

    // Capacity is checked here, at admission, because this is the moment someone
    // actually takes a place (§6). The event row is locked so two admissions into
    // the same event are decided one after the other, each seeing the other's
    // place, rather than both seeing the one remaining seat. Someone who already
    // has a place needs no new one, and an outstanding invite that admits at once
    // is counted as a place held — this arrival's own invite was spent when it
    // was redeemed, so it isn't counted against itself.
    if (arrival.cycleId && !opts.overrideCapacity) {
      const [event] = await tx.select({ capacity: cycle.capacity }).from(cycle).where(eq(cycle.id, arrival.cycleId)).for("update");
      if (event && event.capacity !== null) {
        const [hasPlace] = existing
          ? await tx
              .select({ id: participation.id })
              .from(participation)
              .where(and(eq(participation.cycleId, arrival.cycleId), eq(participation.memberId, existing.id), eq(participation.status, "coming")))
          : [];
        if (!hasPlace) {
          const [{ coming }] = await tx
            .select({ coming: sql<number>`count(*)::int` })
            .from(participation)
            .where(and(eq(participation.cycleId, arrival.cycleId), eq(participation.status, "coming")));
          const holds = await countCapacityHolds(arrival.communityId, arrival.cycleId);
          if (coming + holds >= event.capacity) {
            await tx
              .update(admission)
              .set({ waitlistedAt: arrival.waitlistedAt ?? new Date() })
              .where(eq(admission.id, arrival.id));
            return { arrival, memberId: null, created: false, already: false, waitlisted: true as const };
          }
        }
      }
    }

    let memberId: string;
    let created = false;
    if (existing) {
      memberId = existing.id;
    } else {
      const [newMember] = await tx
        .insert(member)
        .values({
          communityId: arrival.communityId,
          name: arrival.name,
          referredByMemberId: inviterId,
          joinedViaInviteId: viaInviteId,
        })
        .returning();
      await tx.insert(memberIdentity).values({ memberId: newMember.id, provider: "magic_link", loginEmail: arrival.email });
      // Unverified: the address came from the person at the door and nobody
      // has received anything at it yet. The row exists so they have
      // somewhere to be reached, not as a claim they own the inbox.
      await seedPrimaryContactMethod(tx, newMember.id, arrival.email, { verified: false });
      memberId = newMember.id;
      created = true;
    }

    // Admission is what makes someone count against an event's capacity and
    // appear in its roster, so the participation row is seeded here and
    // nowhere earlier (§6). Idempotent.
    if (arrival.cycleId) await seedCycleParticipation(tx, arrival.cycleId, memberId);

    const now = new Date();
    await tx
      .update(admission)
      .set({ admittedAt: now, admittedMemberId: memberId, waitlistedAt: null })
      .where(eq(admission.id, arrival.id));
    if (invite) {
      await tx
        .update(communityInvite)
        .set({ redeemedByMemberId: memberId })
        .where(and(eq(communityInvite.id, invite.id), isNull(communityInvite.redeemedByMemberId)));
    }
    if (arrival.formResponseId) {
      await tx
        .update(recruitmentDecision)
        .set({ convertedMemberId: memberId })
        .where(and(eq(recruitmentDecision.formResponseId, arrival.formResponseId), isNull(recruitmentDecision.convertedMemberId)));
    }
    return { arrival, memberId, created, already: false, waitlisted: false as const };
  });

  if (result.waitlisted) return { waitlisted: true, memberId: null, created: false };
  if (result.already) return { waitlisted: false, memberId: result.memberId, created: false };

  // After commit, and best-effort: these only save the member retyping what
  // they already told us, and a failure in one must never undo an admission
  // the funnel has already decided. For an existing member who is linked
  // rather than created it still applies — a language they hadn't listed is
  // still news, and what they have is never overwritten (see below).
  if (result.arrival.formResponseId) {
    try {
      await seedFromApplication(result.memberId, result.arrival.formResponseId);
    } catch (err) {
      console.error("[admission] could not seed answers from the application", err);
    }
  }
  if (opts.notify !== false && result.arrival.origin === "funnel") {
    try {
      await sendAdmissionAcceptedEmail(result.arrival.email, {
        name: result.arrival.name,
        communityName: await communityNameOf(result.arrival.communityId),
        statusUrl: admissionLink(result.arrival.token),
        loginUrl: `${publicAppUrl()}/login`,
      });
    } catch (err) {
      console.error("[admission] could not send the accepted email", err);
    }
  }
  return { waitlisted: false, memberId: result.memberId, created: result.created };
}

/**
 * Admit the people waiting for room in an event, oldest first, for as long as
 * there is room (§6). Called wherever room can appear — capacity raised,
 * somebody no longer coming, an invite revoked — and never by a timer (no new
 * scheduled job is added by this plan); an invite that simply expires frees
 * its place silently and is picked up by the next of those, or by an
 * administrator's override.
 */
export async function releaseWaitlist(cycleId: string): Promise<number> {
  const waiting = await db
    .select({ id: admission.id })
    .from(admission)
    .where(and(eq(admission.cycleId, cycleId), isNotNull(admission.waitlistedAt), isNull(admission.admittedMemberId), isNull(admission.declinedAt), isNull(admission.withdrawnAt)))
    .orderBy(asc(admission.waitlistedAt));
  let admitted = 0;
  for (const row of waiting) {
    const result = await admitArrival(row.id);
    if (result.waitlisted) break; // no room for this one, so none for those behind it
    admitted++;
  }
  return admitted;
}

/**
 * An administrator admits someone who is waiting although the event is full —
 * the override §6 promises. The authority is the one that configures the rest of
 * an event (whoever may start one), and the arrival has to be waiting in an
 * event of the actor's own community.
 */
export async function admitWaitlistedAnyway(actor: Member, arrivalId: string): Promise<AdmitResult> {
  await requireCycleInitiationEligibility(actor);
  const [row] = await db.select().from(admission).where(and(eq(admission.id, arrivalId), eq(admission.communityId, actor.communityId)));
  if (!row || !row.cycleId || !row.waitlistedAt || row.admittedMemberId) {
    throw new NotFoundError("Nobody is waiting under that name");
  }
  return admitArrival(row.id, { overrideCapacity: true });
}

export async function listWaitlisted(cycleId: string) {
  return db
    .select({ id: admission.id, name: admission.name, email: admission.email, waitlistedAt: admission.waitlistedAt })
    .from(admission)
    .where(and(eq(admission.cycleId, cycleId), isNotNull(admission.waitlistedAt), isNull(admission.admittedMemberId), isNull(admission.declinedAt), isNull(admission.withdrawnAt)))
    .orderBy(asc(admission.waitlistedAt));
}

// Same lookup as findExistingMemberByLoginEmail, inside the admission
// transaction, so an identity made a moment ago by a concurrent admission is
// seen rather than raced.
async function findExistingMemberByLoginEmailIn(tx: DbOrTx, email: string) {
  const [row] = await tx
    .select({ member })
    .from(memberIdentity)
    .innerJoin(member, eq(memberIdentity.memberId, member.id))
    .where(eq(memberIdentity.loginEmail, email))
    .limit(1);
  return row?.member ?? null;
}

// Fields tagged mapsToProfileQuestionId (src/lib/forms.ts) seed a real
// ProfileAnswer from the application answer, so the new member isn't asked to
// retype a fact they already gave; a field tagged isLanguageField seeds real
// `member_language` rows. Both best-effort: a blank answer, a shape mismatch
// (the text no longer matches one of a since-changed single_choice's
// options) or a since-archived question just doesn't prefill, and the member
// can always answer it directly afterwards. Sensitive questions are never
// prefilled — a form saved before they were refused as mapping targets may
// still point at one, and answerProfileQuestion would share the answer with
// the question's whole audience, which the applicant was never shown.
async function seedFromApplication(memberId: string, formResponseId: string) {
  const [response] = await db.select().from(formResponse).where(eq(formResponse.id, formResponseId));
  if (!response) return;
  const [formRow] = await db.select().from(form).where(eq(form.id, response.formId));
  if (!formRow) return;
  const fields = formRow.fields as FormField[];
  const values = response.values as Record<string, unknown>;

  const mapped = fields.filter((f) => f.mapsToProfileQuestionId);
  if (mapped.length > 0) {
    const [memberRow] = await db.select().from(member).where(eq(member.id, memberId));
    if (memberRow) {
      for (const field of mapped) {
        const raw = values[field.key];
        if (raw === undefined || raw === null || raw === "") continue;
        const [question] = await db
          .select({ sensitive: profileQuestion.sensitive })
          .from(profileQuestion)
          .where(eq(profileQuestion.id, field.mapsToProfileQuestionId!));
        if (question?.sensitive) continue;
        try {
          await answerProfileQuestion(memberRow, field.mapsToProfileQuestionId!, { status: "answered", value: raw });
        } catch {
          // best-effort, as above
        }
      }
    }
  }

  const languageField = fields.find((f) => f.isLanguageField);
  const rawLanguages = languageField ? values[languageField.key] : undefined;
  if (typeof rawLanguages === "string") {
    const spoken = rawLanguages
      .split(/[,\n]/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (spoken.length > 0) {
      // `member_language` is repeatable where a ProfileQuestion holds one
      // value, which is why this has its own tag. Every row lands at
      // `conversational` because the form asked one question, not five: the
      // level is a claim about someone's ability, and a community that wants
      // to distinguish fluent from native needs a form that asks.
      const have = await db.select({ language: memberLanguage.language }).from(memberLanguage).where(eq(memberLanguage.memberId, memberId));
      const seen = new Set(have.map((l) => l.language.trim().toLowerCase()));
      for (const language of spoken) {
        const key = language.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        await db.insert(memberLanguage).values({ memberId, language, level: "conversational" });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/**
 * The name and email an application form gives a person (§4: the arrival
 * holds them, because the Member they become does not exist yet). A form can
 * only produce a person if it asks for both, so one that doesn't is refused
 * when an application is submitted, rather than accepting it and never being
 * able to admit anyone.
 */
export function personFromApplication(
  fields: FormField[],
  values: Record<string, unknown>,
): { name: string; email: string } | null {
  const nameField = fields.find((f) => f.isNameField);
  const emailField = fields.find((f) => f.isEmailField);
  if (!nameField || !emailField) return null;
  const name = typeof values[nameField.key] === "string" ? (values[nameField.key] as string).trim() : "";
  const email = typeof values[emailField.key] === "string" ? (values[emailField.key] as string).trim().toLowerCase() : "";
  if (!name || !z.string().email().safeParse(email).success) return null;
  return { name, email };
}

/**
 * The arrival an application belongs to. Applications submitted before
 * arrivals existed have none, and are still in flight, so one is made for
 * them the first time something needs it — on the public lane they entered
 * by, or the invite's lane if they came with one — with the path that lane
 * has *now*, since there is no snapshot of what it said then. Returns null
 * only for a form that can't identify a person at all.
 */
export async function ensureArrivalForApplication(formResponseId: string): Promise<Arrival | null> {
  const existing = await getArrivalForFormResponse(formResponseId);
  if (existing) return existing;

  const [response] = await db.select().from(formResponse).where(eq(formResponse.id, formResponseId));
  if (!response) return null;
  const [formRow] = await db.select().from(form).where(eq(form.id, response.formId));
  if (!formRow) return null;
  const person = personFromApplication(formRow.fields as FormField[], response.values as Record<string, unknown>);
  if (!person) return null;

  const [vouch] = await db
    .select({ invite: communityInvite })
    .from(recruitmentApplicationInvite)
    .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
    .where(eq(recruitmentApplicationInvite.formResponseId, formResponseId));
  const lane = vouch
    ? await resolveInviteLane(formRow.communityId, response.cycleId, declarationFromInvite(vouch.invite))
    : await resolvePublicLane(formRow.communityId, response.cycleId);
  // The lane may have been closed since; any lane that exists will do for
  // an application already made, so fall back to the community's own.
  const fallback = lane ?? (await resolvePublicLane(formRow.communityId, null)) ?? null;
  if (!fallback) return null;

  const [claimed] = await db
    .select()
    .from(admission)
    .where(and(eq(admission.communityId, formRow.communityId), eq(admission.email, person.email)));
  if (claimed) return claimed;

  const snapshot = laneSnapshot(fallback);
  const [created] = await db
    .insert(admission)
    .values({
      communityId: formRow.communityId,
      cycleId: response.cycleId,
      email: person.email,
      name: person.name,
      laneId: fallback.id,
      route: vouch ? "invite" : "application",
      inviteId: vouch?.invite.id ?? null,
      formResponseId,
      ...snapshot,
      // An application that predates arrivals was made on a path with no interview
      // before its decision (the old call came *after* a decision, and is still
      // handled for those), so it isn't made to wait for one now.
      requiredInterview: false,
      token: randomBytes(24).toString("base64url"),
      supportToken: randomBytes(24).toString("base64url"),
      applicationSubmittedAt: response.submittedAt,
    })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getArrivalForFormResponse(formResponseId));
}

// ---------------------------------------------------------------------------
// What a person sees (§4)
// ---------------------------------------------------------------------------

/**
 * Where an arrival is, in the plain words of §4 — the one place the facts the
 * funnel has written are turned into a stage, so the person's own page, the
 * holders' lists and any email read the same answer. Reads the evaluations
 * count rather than keeping a second opinion of it.
 */
export async function loadArrivalReadout(arrival: Arrival, options: { waitingOnThePerson?: boolean } = {}) {
  const [filed] = arrival.formResponseId
    ? await db
        .select({ count: sql<number>`count(*)::int` })
        .from(evaluation)
        .where(eq(evaluation.formResponseId, arrival.formResponseId))
    : [{ count: 0 }];
  const [lane] = await db.select({ name: admissionLane.name }).from(admissionLane).where(eq(admissionLane.id, arrival.laneId));  const [decisionRow] = arrival.formResponseId
    ? await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, arrival.formResponseId))
    : [];
  const widerDiscussionOpen = Boolean(decisionRow && decisionRow.ruleOutcome === "wider_discussion" && decisionRow.resolution === null);
  const readout = computeAdmissionStage(
    {
      verification: arrival.requiredVerification,
      applicationRequired: arrival.requiredApplication,
      interviewRequired: arrival.requiredInterview,
      evaluationRequired: arrival.requiredEvaluation,
      reportsNeeded: arrival.reportsNeeded,
      supportShortcutCount: arrival.supportShortcutCount,
    },
    {
      enteredAt: arrival.createdAt,
      consentGiven: Boolean(arrival.consentGivenAt),
      checkPassed: Boolean(arrival.checkPassedAt),
      applicationSubmitted: Boolean(arrival.applicationSubmittedAt),
      interviewScheduled: Boolean(arrival.interviewScheduledAt),
      interviewHeld: Boolean(arrival.interviewHeldAt),
      evaluationsFiled: filed?.count ?? 0,
      decisionRecorded: Boolean(arrival.decisionRecordedAt),
      widerDiscussionOpen,
      supportShortcutReached: Boolean(arrival.supportShortcutReachedAt),
      admitted: Boolean(arrival.admittedMemberId),
      declined: Boolean(arrival.declinedAt),
      withdrawn: Boolean(arrival.withdrawnAt),
      waitlisted: Boolean(arrival.waitlistedAt),
      origin: arrival.origin,
      applicationSubmittedAt: arrival.applicationSubmittedAt,
      interviewScheduledAt: arrival.interviewScheduledAt,
      interviewHeldAt: arrival.interviewHeldAt,
      checkPassedAt: arrival.checkPassedAt,
      supportShortcutReachedAt: arrival.supportShortcutReachedAt,
      admittedAt: arrival.admittedAt,
      waitlistedAt: arrival.waitlistedAt,
      declinedAt: arrival.declinedAt,
      withdrawnAt: arrival.withdrawnAt,
    },
    options,
  );
  return { readout, sentence: describeAdmissionStage(readout), laneName: lane?.name ?? null };
}

/**
 * The person stops. The disclosure for a community check promises "you can
 * ask us to stop at any time, and you do not have to give a reason", and an
 * application or interview is no different. Nothing is deleted. An invite
 * that was spent stays spent; a check that was running is marked withheld so
 * its window can't admit someone who has asked to stop.
 */
export async function withdrawArrival(token: string): Promise<boolean> {
  const arrival = await getArrivalByToken(token);
  if (!arrival || arrival.admittedMemberId || arrival.withdrawnAt || arrival.declinedAt) return false;
  await closeArrival(arrival.id, "withdrawn");
  if (arrival.inviteId) {
    await db
      .update(communityInvite)
      .set({ consensusState: "withheld" })
      .where(and(eq(communityInvite.id, arrival.inviteId), eq(communityInvite.consensusState, "announced")));
  }
  return true;
}

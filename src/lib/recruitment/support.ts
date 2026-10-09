import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  admission,
  admissionSupport,
  community,
  communityInvite,
  member,
  memberIdentity,
  objection,
  recruitmentApplicationInvite,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { sendSupportRequestEmail } from "../mailer";
import { publicAppUrl } from "../public-url";
import { admitArrival, type AdmitResult } from "./admission";
import { acceptArrivalByShortcut } from "./decisions";
import { requireRecruitmentTaskHolder } from "./access";

type Member = typeof memberTable.$inferSelect;
type Arrival = typeof admission.$inferSelect;

// docs/admission-flow.md §2, "The support shortcut". N supports from members
// skip whatever is left of a lane's path and admit. It runs *alongside* the
// path — the person starts the lane's normal path at once, and if support never
// reaches N nothing happens to them: there is no window, no wait, no skip button
// and nothing to lapse. It replaces the nomination model, which made people wait.
//
// A support is one member's word, once, saying how they know the person. Not the
// person themselves, and not whoever invited them (an inviter has already said
// their piece, and counting it twice is how a shortcut becomes a rubber stamp).
// Every support is shown to the evaluators whether or not the shortcut is
// reached. And it never skips past a standing concern: concerns are only ever
// resolved by mediation (§5).

export function supportLink(supportToken: string): string {
  return `${publicAppUrl()}/support/${supportToken}`;
}

export async function getArrivalBySupportToken(supportToken: string): Promise<Arrival | null> {
  const [row] = await db.select().from(admission).where(eq(admission.supportToken, supportToken));
  return row ?? null;
}

const inFlight = (arrival: Arrival) => !arrival.admittedMemberId && !arrival.declinedAt && !arrival.withdrawnAt;

/** The inviter, wherever the invite is recorded: on the arrival, or behind its application. */
async function inviterOf(arrival: Arrival): Promise<string | null> {
  if (arrival.inviteId) {
    const [row] = await db.select({ createdBy: communityInvite.createdBy }).from(communityInvite).where(eq(communityInvite.id, arrival.inviteId));
    if (row) return row.createdBy;
  }
  if (arrival.formResponseId) {
    const [row] = await db
      .select({ createdBy: communityInvite.createdBy })
      .from(recruitmentApplicationInvite)
      .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
      .where(eq(recruitmentApplicationInvite.formResponseId, arrival.formResponseId));
    if (row) return row.createdBy;
  }
  return null;
}

/** Is a concern standing on this arrival? Then nothing may skip past it. */
export async function hasStandingConcern(arrival: Arrival): Promise<boolean> {
  const subjects = [
    arrival.formResponseId ? eq(objection.formResponseId, arrival.formResponseId) : undefined,
    arrival.inviteId ? eq(objection.inviteId, arrival.inviteId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  if (subjects.length === 0) return false;
  const [row] = await db
    .select({ id: objection.id })
    .from(objection)
    .where(and(eq(objection.resolution, "standing"), subjects.length === 1 ? subjects[0] : sql`(${subjects[0]} or ${subjects[1]})`))
    .limit(1);
  return Boolean(row);
}

export type SupportRow = { memberId: string; name: string; knowsPersonally: boolean; thinksGoodFit: boolean; at: Date };

export async function listSupports(arrivalId: string): Promise<SupportRow[]> {
  const rows = await db
    .select({
      memberId: admissionSupport.supporterId,
      name: member.name,
      knowsPersonally: admissionSupport.knowsPersonally,
      thinksGoodFit: admissionSupport.thinksGoodFit,
      at: admissionSupport.createdAt,
    })
    .from(admissionSupport)
    .innerJoin(member, eq(admissionSupport.supporterId, member.id))
    .where(eq(admissionSupport.arrivalId, arrivalId))
    .orderBy(asc(admissionSupport.createdAt));
  return rows;
}

/** Supports for an application, for the people evaluating it (§2: "their vouches are shown to the evaluators"). */
export async function listSupportsForApplication(formResponseId: string): Promise<SupportRow[]> {
  const [arrival] = await db.select({ id: admission.id }).from(admission).where(eq(admission.formResponseId, formResponseId));
  return arrival ? listSupports(arrival.id) : [];
}

export type SupportView = {
  arrivalId: string;
  communityName: string;
  /** What the viewer is shown of who this is: only a member is told their name. */
  personName: string | null;
  supports: SupportRow[];
  mine: { knowsPersonally: boolean; thinksGoodFit: boolean } | null;
  /** Null when the lane has no shortcut — supports are still recorded and shown to evaluators. */
  needed: number | null;
  open: boolean;
  /** Why this viewer can't add a support right now, in a sentence, or null. */
  cannotBecause: string | null;
};

export async function getSupportView(supportToken: string, viewer: Member | null): Promise<SupportView | null> {
  const arrival = await getArrivalBySupportToken(supportToken);
  if (!arrival) return null;
  const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, arrival.communityId));
  const supports = await listSupports(arrival.id);
  const mine = viewer ? supports.find((s) => s.memberId === viewer.id) : undefined;

  let cannotBecause: string | null = null;
  if (!viewer) cannotBecause = "Sign in as a member to add your word.";
  else if (viewer.communityId !== arrival.communityId) cannotBecause = "This request belongs to another community.";
  else if (!inFlight(arrival)) cannotBecause = "This request has already been settled.";
  else if ((await inviterOf(arrival)) === viewer.id) cannotBecause = "You invited them, so your word is already part of this.";
  else if (await isThePerson(viewer, arrival)) cannotBecause = "This is your own request.";

  return {
    arrivalId: arrival.id,
    communityName: communityRow?.name ?? "the community",
    personName: viewer && viewer.communityId === arrival.communityId ? arrival.name : null,
    supports,
    mine: mine ? { knowsPersonally: mine.knowsPersonally, thinksGoodFit: mine.thinksGoodFit } : null,
    needed: arrival.supportShortcutCount,
    open: inFlight(arrival),
    cannotBecause,
  };
}

async function isThePerson(actor: Member, arrival: Arrival): Promise<boolean> {
  const [identity] = await db
    .select({ id: memberIdentity.id })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.memberId, actor.id), sql`lower(${memberIdentity.loginEmail}) = ${arrival.email.toLowerCase()}`));
  return Boolean(identity);
}

export const recordSupportInput = z.object({
  // Either the support link the person handed over, or — for somebody who can
  // already see the arrival, as a holder looking at the applications — the
  // arrival itself, with no link needed (§2).
  supportToken: z.string().min(1).optional(),
  arrivalId: z.string().uuid().optional(),
  // The supporter's own marks, which is what makes a second a real second and
  // not a rubber stamp of the first. At least one: a support with neither
  // records nothing at all.
  knowsPersonally: z.boolean().default(false),
  thinksGoodFit: z.boolean().default(false),
});
export type RecordSupportInput = z.input<typeof recordSupportInput>;

export type RecordSupportResult = {
  reached: boolean;
  /** Reached, but a concern stands, so the rest was not skipped. */
  heldByConcern: boolean;
  admitted: AdmitResult | null;
};

/**
 * Record (or strengthen, in place) one member's support, then see whether that
 * reaches the shortcut. Resubmittable: someone correcting their own marks
 * updates their row rather than adding a second one.
 */
export async function recordSupport(actor: Member, rawInput: RecordSupportInput): Promise<RecordSupportResult> {
  const input = recordSupportInput.parse(rawInput);
  if (!input.knowsPersonally && !input.thinksGoodFit) {
    throw new ConflictError("Say how you know this person — personally, or that you'd expect them to fit");
  }

  let arrival: Arrival | null = null;
  if (input.supportToken) {
    arrival = await getArrivalBySupportToken(input.supportToken);
  } else if (input.arrivalId) {
    // Seeing the arrival is what lets someone support it without the link.
    await requireRecruitmentTaskHolder(actor);
    const [row] = await db.select().from(admission).where(eq(admission.id, input.arrivalId));
    arrival = row ?? null;
  }
  if (!arrival) throw new NotFoundError("That support link isn't valid any more");
  if (arrival.communityId !== actor.communityId) throw new ForbiddenError("That request belongs to another community");
  if (!inFlight(arrival)) throw new ConflictError("This request has already been settled");
  if ((await inviterOf(arrival)) === actor.id) {
    throw new ForbiddenError("You invited them, so your word is already part of this");
  }
  if (await isThePerson(actor, arrival)) throw new ForbiddenError("You can't support your own request");

  await db
    .insert(admissionSupport)
    .values({ arrivalId: arrival.id, supporterId: actor.id, knowsPersonally: input.knowsPersonally, thinksGoodFit: input.thinksGoodFit })
    .onConflictDoUpdate({
      target: [admissionSupport.arrivalId, admissionSupport.supporterId],
      set: { knowsPersonally: input.knowsPersonally, thinksGoodFit: input.thinksGoodFit, updatedAt: new Date() },
    });

  return trySupportShortcut(arrival.id);
}

/**
 * Has support reached the lane's number? If so, and no concern stands, skip the
 * rest of the path and admit. Idempotent, and safe to call whenever something
 * that could change the answer happens.
 */
export async function trySupportShortcut(arrivalId: string): Promise<RecordSupportResult> {
  const [arrival] = await db.select().from(admission).where(eq(admission.id, arrivalId));
  const nothing: RecordSupportResult = { reached: false, heldByConcern: false, admitted: null };
  if (!arrival || !inFlight(arrival) || !arrival.supportShortcutCount) return nothing;

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(admissionSupport)
    .where(eq(admissionSupport.arrivalId, arrival.id));
  if (count < arrival.supportShortcutCount) return nothing;

  // Never past a concern. It isn't marked reached either, so it counts again the
  // moment mediation has settled it — and a settled concern admits or declines
  // by its own outcome, which is the only way it ever ends.
  if (await hasStandingConcern(arrival)) return { reached: true, heldByConcern: true, admitted: null };

  await db
    .update(admission)
    .set({ supportShortcutReachedAt: new Date() })
    .where(and(eq(admission.id, arrival.id), isNull(admission.supportShortcutReachedAt)));

  // An application is accepted the way a `proceed` decision accepts it, so the
  // member's accompaniment and the record agree; anything else is admitted directly.
  const admitted = arrival.formResponseId
    ? await acceptArrivalByShortcut(arrival)
    : await admitArrival(arrival.id);
  return { reached: true, heldByConcern: false, admitted };
}

/**
 * Ask members, by name, to look at somebody's support link: one message each,
 * never a broadcast — nothing announces the person's existence beyond who was
 * asked. Best-effort: a member with no address on file, or a mailer that isn't
 * configured, must never fail the thing it was sent alongside, and the asker
 * always has the link to hand over by hand. It implies no deadline, blocks
 * nothing, and counts toward nothing on its own — only a recorded support counts.
 *
 * Open to the person who invited them and to anyone holding the recruitment task.
 */
export async function pokeForSupport(
  actor: Member,
  arrivalId: string,
  memberIds: string[],
): Promise<{ poked: string[]; undeliverable: string[]; link: string }> {
  const [arrival] = await db.select().from(admission).where(and(eq(admission.id, arrivalId), eq(admission.communityId, actor.communityId)));
  if (!arrival) throw new NotFoundError("Request not found");
  if ((await inviterOf(arrival)) !== actor.id) await requireRecruitmentTaskHolder(actor);
  if (!inFlight(arrival)) throw new ConflictError("This request has already been settled");
  const link = supportLink(arrival.supportToken);
  if (memberIds.length === 0) return { poked: [], undeliverable: [], link };

  const [communityRow] = await db.select({ name: community.name }).from(community).where(eq(community.id, arrival.communityId));
  const recipients = await db
    .select({ id: member.id, name: member.name, email: memberIdentity.loginEmail })
    .from(member)
    .leftJoin(memberIdentity, eq(memberIdentity.memberId, member.id))
    .where(and(eq(member.communityId, arrival.communityId), inArray(member.id, memberIds), ne(member.id, actor.id)));
  // One per member: the join can repeat a member with two identities, and being
  // asked twice is worse than being asked once.
  const byMember = new Map<string, string | null>();
  for (const r of recipients) if (!byMember.has(r.id)) byMember.set(r.id, r.email);

  const poked: string[] = [];
  const undeliverable: string[] = [];
  for (const [memberId, email] of byMember) {
    if (!email) {
      undeliverable.push(memberId);
      continue;
    }
    try {
      await sendSupportRequestEmail(email, { askerName: actor.name, communityName: communityRow?.name ?? "the community", supportUrl: link });
      poked.push(memberId);
    } catch {
      undeliverable.push(memberId);
    }
  }
  return { poked, undeliverable, link };
}

/**
 * The people this member invited who are still on their way in, with the link to
 * hand to members who might know them and how many have vouched. This is how the
 * inviter asks (§2): the arrival doesn't exist until the invitee has used the
 * invite, so the support link can't be made at the moment the invite is created.
 */
export async function listMyInviteesInFlight(actor: Member) {
  const viaInvite = db
    .select({ id: admission.id })
    .from(admission)
    .innerJoin(communityInvite, eq(admission.inviteId, communityInvite.id))
    .where(and(eq(communityInvite.createdBy, actor.id), eq(admission.communityId, actor.communityId)));
  const viaApplication = db
    .select({ id: admission.id })
    .from(admission)
    .innerJoin(recruitmentApplicationInvite, eq(admission.formResponseId, recruitmentApplicationInvite.formResponseId))
    .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
    .where(and(eq(communityInvite.createdBy, actor.id), eq(admission.communityId, actor.communityId)));
  const ids = [...(await viaInvite), ...(await viaApplication)].map((r) => r.id);
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(admission)
    .where(and(inArray(admission.id, [...new Set(ids)]), isNull(admission.admittedMemberId), isNull(admission.declinedAt), isNull(admission.withdrawnAt)))
    .orderBy(asc(admission.createdAt));
  return Promise.all(
    rows.map(async (arrival) => ({
      id: arrival.id,
      name: arrival.name,
      link: supportLink(arrival.supportToken),
      needed: arrival.supportShortcutCount,
      supports: await listSupports(arrival.id),
    })),
  );
}

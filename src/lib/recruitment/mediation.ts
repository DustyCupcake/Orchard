import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  admission,
  community,
  communityCheck,
  communityCheckConcern,
  communityCheckConcernConsent,
  communityCheckConcernExclusion,
  communityCheckOverruleSupport,
  member,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable, communityCheckConcern as concernTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { isModuleOpenToEveryone, listGrantingTaskIds } from "../permissions";
import type { PermissionModuleKey } from "../permissions";
import { isSharedByOpenness, type NeedsAction } from "../needs-action";
import { assertCanAskForMore, reconcileCheck } from "./check-outcome";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
// A concern raised in a community check. The body's own word for it is still
// "objection" in a few names below (the shield functions, the queue), which are
// the ones the rest of the app calls; what is stored is the unified check's
// concern, and `raisedById` is the shield at rest.
type ObjectionRow = typeof concernTable.$inferSelect;

// §2.7/J8 — the mediation body is its own grant, and the community
// chooses which task(s) carry it. The resolver here is deliberately the
// same shape as every other module's (isModuleOpenToEveryone →
// listGrantingTaskIds → a non-shadow assignment on a granting task), so
// opening the module, granting it to several tasks, and having no
// current holder all behave exactly the way they do for `conflict_team`.
// What is *not* the same is what happens next: a body that doesn't
// exist does not silently fall back to the evaluators, because the whole
// point of the shield is that the person who evaluates never learns who
// objected. An unconfigured community therefore has nobody who can see
// an objection, and its objections are visible to nobody but still
// stand — see describeMediationAuthority for how that gap is reported
// rather than papered over.
const MEDIATION_MODULE: PermissionModuleKey = "recruitment_mediation";

export type MediationMember = { memberId: string; name: string; taskTitle: string };

// Who is in the body right now. Distinct across every granting task, so
// one person holding two mediation tasks is one vote and one pair of
// eyes — the same "a shadow assignment is a placeholder, not someone
// doing the work" filter the recruitment resolver uses, and for the same
// reason: counting a placeholder as a voter overstates the body's
// strength and makes an overrule reachable that isn't.
export async function listMediationMembers(communityId: string): Promise<MediationMember[]> {
  if (await isModuleOpenToEveryone(communityId, MEDIATION_MODULE)) {
    const rows = await db
      .select({ memberId: member.id, name: member.name })
      .from(member)
      .where(eq(member.communityId, communityId));
    return rows.map((m) => ({ ...m, taskTitle: "every member" }));
  }
  const grantingTaskIds = await listGrantingTaskIds(communityId, MEDIATION_MODULE);
  if (grantingTaskIds.length === 0) return [];
  const rows = await db
    .select({ memberId: member.id, name: member.name, taskTitle: task.title })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .where(and(inArray(task.id, grantingTaskIds), eq(taskAssignment.isShadow, false)));
  const byMember = new Map<string, MediationMember>();
  for (const row of rows) {
    if (!byMember.has(row.memberId)) byMember.set(row.memberId, row);
  }
  return [...byMember.values()];
}

export async function isMediationMember(actor: Member): Promise<boolean> {
  if (await isModuleOpenToEveryone(actor.communityId, MEDIATION_MODULE)) {
    return true;
  }
  return (await listMediationMembers(actor.communityId)).some((m) => m.memberId === actor.id);
}

export async function requireMediationMember(actor: Member) {
  if (!(await isMediationMember(actor))) {
    throw new ForbiddenError("Only a member of the recruitment mediation body can do this");
  }
}

// The gap report, for the mediation queue's own empty state. Returns
// null when there is somebody in the body; otherwise says exactly which
// half of the configuration is missing, because "nothing shows up" and
// "the wrong task is granted" look identical from the outside and are
// fixed in completely different places.
export async function describeMediationAuthority(communityId: string): Promise<
  { open: boolean; grantingTaskCount: number; memberCount: number } | null
> {
  const open = await isModuleOpenToEveryone(communityId, MEDIATION_MODULE);
  const grantingTaskIds = await listGrantingTaskIds(communityId, MEDIATION_MODULE);
  const members = await listMediationMembers(communityId);
  if (members.length > 0) return null;
  return { open, grantingTaskCount: grantingTaskIds.length, memberCount: 0 };
}

// ---------------------------------------------------------------------------
// The threshold (§2.6/J7)
// ---------------------------------------------------------------------------

// How many of the body's members have to agree before an objection can
// be overruled. "Majority" is strictly more than half of the people who
// hold it *right now*, and it is clamped: a body of one is 1, not 0
// (half of one, rounded down, would let one person overrule themselves
// out of their own veto), and a body of zero has no threshold at all
// because there is nobody to overrule — see overruleIsAvailable.
export function overruleThreshold(communityRow: CommunityRow, bodySize: number): number {
  if (communityRow.recruitmentObjectionOverrule === "quorum") {
    return Math.max(1, Math.min(communityRow.recruitmentObjectionQuorum, Math.max(1, bodySize)));
  }
  return Math.max(1, Math.floor(bodySize / 2) + 1);
}

// Whether the overrule is even on the table, and for whom. The community
// can turn the exception off entirely by setting a quorum the body
// cannot reach; that is a real configuration (a community that has
// decided objections are never voted away), and it is reported as
// unavailable rather than silently allowing a one-person overrule.
export type OverruleAvailability = { available: boolean; threshold: number; bodySize: number; reason?: string };

export function overruleAvailability(communityRow: CommunityRow, bodySize: number): OverruleAvailability {
  const threshold = overruleThreshold(communityRow, bodySize);
  if (bodySize === 0) {
    return {
      available: false,
      threshold,
      bodySize,
      reason: "Nobody holds Recruitment mediation right now, so there is nobody who can overrule an objection.",
    };
  }
  if (communityRow.recruitmentObjectionOverrule === "quorum" && communityRow.recruitmentObjectionQuorum > bodySize) {
    return {
      available: false,
      threshold,
      bodySize,
      reason: `The community's quorum is ${communityRow.recruitmentObjectionQuorum} people and only ${bodySize} hold the role, so the exception can't be exercised until the body is bigger.`,
    };
  }
  return { available: true, threshold, bodySize };
}

// ---------------------------------------------------------------------------
// The shield (§2.6)
// ---------------------------------------------------------------------------

// Who may see `objection.raisedBy`. The rule, in order:
//   1. the objector themselves, always — they need to be able to recuse
//      and withdraw, and neither action makes sense if they can't find
//      their own objection;
//   2. a member of the mediation body, unless the objector has excluded
//      them (reporter-excludes-at-creation, self-recusal or peer-
//      recusal all land in the same table, exactly as
//      conflict_report_exclusion does);
//   3. nobody else. Not the evaluators, not the person being objected
//      to, not the inviter, and — the leak the plan calls out by name
//      (§2.6) — not the inviter *either*, because the shield leaks
//      through the invitee's friend.
//
// The evaluators' view is a strictly smaller thing and lives in
// listObjections: the note, the timestamp, the count. They are not
// shown an identity, so they cannot accidentally learn one.
export async function canSeeObjectorIdentity(actor: Member, row: ObjectionRow): Promise<boolean> {
  if (row.raisedById === actor.id) return true;
  if (!(await isMediationMember(actor))) return false;
  const excluded = await db
    .select({ id: communityCheckConcernExclusion.id })
    .from(communityCheckConcernExclusion)
    .where(and(eq(communityCheckConcernExclusion.concernId, row.id), eq(communityCheckConcernExclusion.memberId, actor.id)))
    .limit(1);
  return excluded.length === 0;
}

// Whether *anyone* in the body may see it — what the queue uses to sort
// "needs the body" from "nobody can see this at all".
export async function objectionIsVisibleToBody(row: ObjectionRow): Promise<boolean> {
  const excluded = await db
    .select({ memberId: communityCheckConcernExclusion.memberId })
    .from(communityCheckConcernExclusion)
    .where(eq(communityCheckConcernExclusion.concernId, row.id));
  const body = await listMediationMembers(row.communityId);
  if (body.length === 0) return false;
  const excludedIds = new Set(excluded.map((e) => e.memberId));
  return body.some((m) => !excludedIds.has(m.memberId));
}

export const recuseFromObjectionInput = z.object({
  objectionId: z.string().uuid(),
  memberId: z.string().uuid(),
});
export type RecuseFromObjectionInput = z.infer<typeof recuseFromObjectionInput>;

// The objector's own recusal controls, and — because §2.6 lets the
// objector "consent to named parties knowing" — the one and only way an
// identity leaves the shield. Both actions are the objector's alone.
// Anyone already excluded may be consented-to, and the exclusion still
// wins: being told who objected is a different thing from being able to
// see it on the queue, and granting the first must never quietly grant
// the second.
export async function recuseFromObjection(actor: Member, input: RecuseFromObjectionInput) {
  const row = await getObjectionForShield(actor, input.objectionId);
  if (row.raisedById !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can recuse anyone from it");
  }
  const [existing] = await db
    .select({ id: communityCheckConcernExclusion.id })
    .from(communityCheckConcernExclusion)
    .where(
      and(
        eq(communityCheckConcernExclusion.concernId, row.id),
        eq(communityCheckConcernExclusion.memberId, input.memberId),
      ),
    );
  if (existing) return existing;
  const [created] = await db
    .insert(communityCheckConcernExclusion)
    .values({ concernId: row.id, memberId: input.memberId, addedById: actor.id })
    .returning();
  return created;
}

export async function consentPartyToObjection(
  actor: Member,
  input: { objectionId: string; memberId: string; note?: string | null },
) {
  const row = await getObjectionForShield(actor, input.objectionId);
  if (row.raisedById !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can consent to anyone being told");
  }
  const [existing] = await db
    .select()
    .from(communityCheckConcernConsent)
    .where(
      and(
        eq(communityCheckConcernConsent.concernId, row.id),
        eq(communityCheckConcernConsent.memberId, input.memberId),
      ),
    );
  if (existing) {
    const [updated] = await db
      .update(communityCheckConcernConsent)
      .set({ withdrawnAt: null, note: input.note ?? null, grantedAt: new Date() })
      .where(eq(communityCheckConcernConsent.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(communityCheckConcernConsent)
    .values({ concernId: row.id, memberId: input.memberId, note: input.note ?? null })
    .returning();
  return created;
}

export async function withdrawConsentToObjection(actor: Member, objectionId: string, memberId: string) {
  const row = await getObjectionForShield(actor, objectionId);
  if (row.raisedById !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can withdraw a consent");
  }
  const [updated] = await db
    .update(communityCheckConcernConsent)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(communityCheckConcernConsent.concernId, row.id),
        eq(communityCheckConcernConsent.memberId, memberId),
        isNull(communityCheckConcernConsent.withdrawnAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function listObjectionParties(objectionId: string) {
  const [excluded, consented] = await Promise.all([
    db.select().from(communityCheckConcernExclusion).where(eq(communityCheckConcernExclusion.concernId, objectionId)),
    db
      .select()
      .from(communityCheckConcernConsent)
      .where(and(eq(communityCheckConcernConsent.concernId, objectionId), isNull(communityCheckConcernConsent.withdrawnAt))),
  ]);
  return { excluded, consented };
}

async function getObjectionForShield(actor: Member, objectionId: string): Promise<ObjectionRow> {
  const [row] = await db.select().from(communityCheckConcern).where(eq(communityCheckConcern.id, objectionId));
  if (!row || row.communityId !== actor.communityId) {
    throw new NotFoundError("Concern not found");
  }
  return row;
}

// ---------------------------------------------------------------------------
// The queue (§5.4)
// ---------------------------------------------------------------------------

// What a concern is about: the arrival, and how its window came to be open. The body
// is told who the person is — talking with the objector, the person and whoever
// invited them separately is the work, and it can't start without a name.
export type MediationSubject = {
  arrivalId: string;
  name: string;
  route: "invite" | "application";
  checkKind: "entry" | "evaluation";
  cycleId: string | null;
  enteredAt: Date;
  /** The application, when there is one — so the body can read what the evaluators read. */
  formResponseId: string | null;
  /** When the person agreed to being announced, if their lane announces arrivals. */
  consentAt: Date | null;
  /** Whether this window is still running, so the queue can say "closes" or "closed". */
  deadline: Date;
  /** What "ask for more" could still ask for on this arrival, so the form offers only what makes sense. */
  mayAskFor: { application: boolean; interview: boolean } | null;
};

export type MediationItem = {
  id: string;
  note: string;
  raisedAt: Date;
  resolution: ObjectionRow["resolution"];
  resolvedAt: Date | null;
  resolutionNote: string | null;
  subject: MediationSubject;
  // Null unless this member is the objector *and* is allowed to see the
  // identity — which is always. Carried on the row so the queue can
  // render "you raised this" without a second permissioned read.
  objectorName: string | null;
  recusedCount: number;
  consentCount: number;
  // Body members who have said they would overrule this, so the body can
  // see how far an overrule is from the threshold. Visible to the body
  // only — the queue itself is — and never includes the objector's identity.
  overruleSupporters: { memberId: string; name: string }[];
};

export type MediationQueue = {
  body: MediationMember[];
  community: CommunityRow;
  overrule: OverruleAvailability;
  authority: Awaited<ReturnType<typeof describeMediationAuthority>>;
  items: MediationItem[];
  standing: MediationItem[];
  settled: MediationItem[];
};

// §2.6 — an objection is never thrown out by a timer, so "standing" is a
// queue with a real owner, not a countdown. Every standing objection in
// the community is a duty item for the body, and the reason the plan
// insists on that is worth restating here because it is the one place
// this codebase is fixing a bug rather than adding a feature: the old
// behaviour held an outcome *pending* until a holder happened to act,
// which in a passive team is veto-by-inaction — the objection never
// fails and the person never arrives.
export async function getMediationQueue(actor: Member): Promise<MediationQueue> {
  await requireMediationMember(actor);
  const [communityRow] = await db
    .select()
    .from(community)
    .where(eq(community.id, actor.communityId));
  if (!communityRow) {
    throw new NotFoundError("Community not found");
  }
  const [rows, body, authority] = await Promise.all([
    db
      .select()
      .from(communityCheckConcern)
      .where(eq(communityCheckConcern.communityId, actor.communityId))
      .orderBy(desc(communityCheckConcern.raisedAt)),
    listMediationMembers(actor.communityId),
    describeMediationAuthority(actor.communityId),
  ]);

  const items: MediationItem[] = [];
  for (const row of rows) {
    const subject = await describeObjectionSubject(row);
    if (!subject) continue;
    const [excluded, consented, objector] = await Promise.all([
      db
        .select({ id: communityCheckConcernExclusion.id })
        .from(communityCheckConcernExclusion)
        .where(eq(communityCheckConcernExclusion.concernId, row.id)),
      db
        .select({ id: communityCheckConcernConsent.id })
        .from(communityCheckConcernConsent)
        .where(and(eq(communityCheckConcernConsent.concernId, row.id), isNull(communityCheckConcernConsent.withdrawnAt))),
      db.select({ name: member.name }).from(member).where(eq(member.id, row.raisedById)),
    ]);
    // The identity is filled in only for the objector themselves; every
    // other reader of this queue gets a shielded objection, which is the
    // whole point (§2.6) and the reason this is a per-row read rather
    // than one shared object.
    const maySee = row.raisedById === actor.id;
    items.push({
      id: row.id,
      note: row.note,
      raisedAt: row.raisedAt,
      resolution: row.resolution,
      resolvedAt: row.resolvedAt,
      resolutionNote: row.resolutionNote,
      subject,
      objectorName: maySee ? (objector[0]?.name ?? null) : null,
      recusedCount: excluded.length,
      consentCount: consented.length,
      overruleSupporters:
        row.resolution === "standing"
          ? (await countedOverruleSupporters(row.id, body)).map(({ memberId, name }) => ({ memberId, name }))
          : [],
    });
  }

  return {
    body,
    community: communityRow,
    overrule: overruleAvailability(communityRow, body.length),
    authority,
    items,
    standing: items.filter((i) => i.resolution === "standing"),
    settled: items.filter((i) => i.resolution !== "standing"),
  };
}

// §2.6 — "a pattern of failing to persuade is visible to the body on its
// own records." The chronic-objector question is answerable without
// anyone having to keep a private tally, and without it becoming a
// blacklist: these are *objections and their outcomes*, never a score.
// A member with four upheld objections is not a problem the community has
// a word for here; a member whose objections get overruled four times in
// a row is a signal the body should see while it is deciding the fifth.
export type ObjectorRecord = {
  memberId: string;
  name: string;
  raised: number;
  cleared: number;
  upheld: number;
  overruled: number;
  withdrawn: number;
};

export async function describeObjectorRecord(communityId: string, memberId: string): Promise<ObjectorRecord | null> {
  await requireMediationMemberId(communityId);
  const rows = await db
    .select({ resolution: communityCheckConcern.resolution })
    .from(communityCheckConcern)
    .where(and(eq(communityCheckConcern.communityId, communityId), eq(communityCheckConcern.raisedById, memberId)));
  if (rows.length === 0) return null;
  const [person] = await db.select({ name: member.name }).from(member).where(eq(member.id, memberId));
  const count = (r: ObjectionRow["resolution"]) => rows.filter((x) => x.resolution === r).length;
  return {
    memberId,
    name: person?.name ?? "A member",
    raised: rows.length,
    cleared: count("cleared"),
    upheld: count("upheld"),
    overruled: count("overruled"),
    withdrawn: count("withdrawn"),
  };
}

// The record read is body-only; this takes a resolved body membership
// check so callers that already hold `MediationMember` don't re-resolve
// per row.
async function requireMediationMemberId(communityId: string) {
  const body = await listMediationMembers(communityId);
  if (body.length === 0) {
    throw new ForbiddenError("Nobody holds Recruitment mediation in this community");
  }
}

async function describeObjectionSubject(row: ObjectionRow): Promise<MediationSubject | null> {
  const [found] = await db
    .select({ check: communityCheck, arrival: admission })
    .from(communityCheck)
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(eq(communityCheck.id, row.checkId));
  if (!found) return null;
  const { check, arrival } = found;
  // Only an entry window can still be asked for more (check-outcome.ts), and only the
  // steps the arrival doesn't already have.
  const askable =
    check.kind === "entry" && !check.endedAt
      ? {
          application: !arrival.requiredApplication,
          interview: !arrival.requiredInterview,
        }
      : null;
  return {
    arrivalId: arrival.id,
    name: arrival.name,
    route: arrival.route,
    checkKind: check.kind,
    cycleId: arrival.cycleId,
    enteredAt: arrival.createdAt,
    formResponseId: arrival.formResponseId,
    consentAt: arrival.consentGivenAt,
    deadline: check.deadline,
    mayAskFor: askable && (askable.application || askable.interview) ? askable : null,
  };
}

// ---------------------------------------------------------------------------
// Resolving (§2.6, §4.3)
// ---------------------------------------------------------------------------

export const resolveObjectionInput = z.object({
  objectionId: z.string().uuid(),
  // `cleared` and `upheld` are mediation succeeding and mediation
  // concluding the concern holds; `overruled` is the exception the
  // threshold guards; `asked_for_more` sends the person back to give more (an
  // application, a conversation) before anything is decided. `withdrawn` is
  // deliberately absent here — that one belongs to the objector and goes through
  // withdrawObjection, so it can never be recorded as something the body did.
  outcome: z.enum(["cleared", "upheld", "overruled", "asked_for_more"]),
  note: z.string().min(1),
  // Only for `asked_for_more`: what to ask for.
  askApplication: z.boolean().optional(),
  askInterview: z.boolean().optional(),
});
export type ResolveObjectionInput = z.infer<typeof resolveObjectionInput>;

export async function resolveObjection(actor: Member, input: ResolveObjectionInput) {
  // The objectionor check comes *before* the body-membership check, and
  // that ordering is deliberate. Somebody who raised a concern and then
  // tries to settle it is asking a real question — "can I do this?" —
  // and "you're not in the body" is a confusing answer to it, because
  // they were, thirty seconds ago, on the other side of the same screen.
  // "You raised this, so you can't also settle it" answers the question
  // they actually asked, and is true regardless of what else they hold.
  const row = await getObjectionForShield(actor, input.objectionId);
  if (row.raisedById === actor.id) {
    throw new ConflictError("You raised this objection — you can't also settle it");
  }
  await requireMediationMember(actor);
  if (row.resolution !== "standing") {
    throw new ConflictError("This objection has already been settled");
  }
  // The objector may have recused this very member since the queue was
  // built, so the check is re-read here rather than trusted from the
  // render. A recused member is not merely unable to see the row: they
  // have no business settling it either.
  if (await isRecusedFrom(row.id, actor.id)) {
    throw new ForbiddenError("The person who raised this objection has recused you from it");
  }

  const communityRow = (await db.select().from(community).where(eq(community.id, actor.communityId)))[0];
  if (!communityRow) {
    throw new NotFoundError("Community not found");
  }

  // Asking for more changes the person's path, so what is being asked is checked
  // against the arrival *before* the concern is marked settled — a refusal here
  // leaves it standing rather than settled with nothing done.
  if (input.outcome === "asked_for_more") {
    const [found] = await db
      .select({ check: communityCheck, arrival: admission })
      .from(communityCheck)
      .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
      .where(eq(communityCheck.id, row.checkId));
    if (!found) throw new NotFoundError("Concern not found");
    assertCanAskForMore(found.arrival, found.check, {
      application: Boolean(input.askApplication),
      interview: Boolean(input.askInterview),
    });
    await db
      .update(communityCheck)
      .set({ askedApplication: Boolean(input.askApplication), askedInterview: Boolean(input.askInterview) })
      .where(eq(communityCheck.id, found.check.id));
  }

  // The note that is written onto the record. For every outcome but a
  // multi-person overrule it is simply what the resolver wrote.
  let resolutionNote = input.note;

  if (input.outcome === "overruled") {
    const body = await listMediationMembers(actor.communityId);
    const availability = overruleAvailability(communityRow, body.length);
    if (!availability.available) {
      throw new AppError(availability.reason ?? "The overrule isn't available here");
    }
    // The overrule is the one outcome that is not one person's call. It
    // takes the community's threshold of the body *agreeing*, so what
    // this action does for an overrule is record that this holder agrees
    // and then check whether that is now enough. Before this, the only
    // thing checked was that the body was big enough to reach the
    // threshold in principle (overruleAvailability), so any single
    // holder's click settled it — which is the "lone objector must win
    // the room" protection turned inside out for the other side.
    //
    // Open-to-everyone mediation lets any member see and clear an
    // objection, but the threshold is defined over the people who hold
    // the role, so only those can add to an overrule.
    if (!body.some((m) => m.memberId === actor.id)) {
      throw new ForbiddenError("Only someone who currently holds the mediation role can support an overrule");
    }
    await db
      .insert(communityCheckOverruleSupport)
      .values({ concernId: row.id, memberId: actor.id, note: input.note })
      .onConflictDoUpdate({
        target: [communityCheckOverruleSupport.concernId, communityCheckOverruleSupport.memberId],
        set: { note: input.note, supportedAt: new Date() },
      });

    const supporters = await countedOverruleSupporters(row.id, body);
    if (supporters.length < availability.threshold) {
      // Support recorded, objection still standing. Returned as the row
      // it was rather than thrown: nothing went wrong, the queue just has
      // more to show (`overruleSupporters`).
      return row;
    }
    resolutionNote = composeOverruleRecord(supporters, body.length);
  }

  const [updated] = await db
    .update(communityCheckConcern)
    .set({
      resolution: input.outcome,
      resolvedAt: new Date(),
      resolvedById: actor.id,
      // The audit note §5.4 asks for is the resolutionNote itself, and
      // it is required (not optional) for all three outcomes: "we talked
      // and we're fine" and "we talked and we're not" are both things
      // the next person to read this record needs, and an overrule
      // without a stated reason is the one that most obviously does.
      resolutionNote,
    })
    .where(and(eq(communityCheckConcern.id, row.id), eq(communityCheckConcern.resolution, "standing")))
    .returning();
  if (!updated) {
    throw new ConflictError("This objection has already been settled");
  }

  // The outcome is the funnel's to apply (check-outcome.ts), from what is now on the
  // record — not this function's, and not a holder-only function's. If applying it
  // fails, the next look at the window (the job's, or the next settlement's) finishes
  // it, because the answer is already written.
  await reconcileCheck(updated.checkId);
  return updated;
}

export type OverruleSupporter = { memberId: string; name: string; note: string };

// Who has said they would overrule this objection *and still counts*.
// Support is recorded against a person, but the threshold is defined over
// the body as it stands now, so a supporter who has since left the role,
// or whom the objector has since recused, no longer counts towards it —
// the same "right now" reading overruleThreshold uses for the denominator.
async function countedOverruleSupporters(objectionId: string, body: MediationMember[]): Promise<OverruleSupporter[]> {
  const [rows, recused] = await Promise.all([
    db
      .select({ memberId: communityCheckOverruleSupport.memberId, note: communityCheckOverruleSupport.note })
      .from(communityCheckOverruleSupport)
      .where(eq(communityCheckOverruleSupport.concernId, objectionId))
      .orderBy(communityCheckOverruleSupport.supportedAt),
    db
      .select({ memberId: communityCheckConcernExclusion.memberId })
      .from(communityCheckConcernExclusion)
      .where(eq(communityCheckConcernExclusion.concernId, objectionId)),
  ]);
  const recusedIds = new Set(recused.map((r) => r.memberId));
  const nameById = new Map(body.map((m) => [m.memberId, m.name]));
  return rows
    .filter((r) => nameById.has(r.memberId) && !recusedIds.has(r.memberId))
    .map((r) => ({ memberId: r.memberId, name: nameById.get(r.memberId)!, note: r.note }));
}

// The permanent record of an exception. One supporter is just their note;
// more than one names each of them and what they said, because "the body
// overruled this" with no names is exactly the unaccountable exception
// §2.6 says must stay visible on the body's own records.
function composeOverruleRecord(supporters: OverruleSupporter[], bodySize: number): string {
  if (supporters.length === 1) return supporters[0].note;
  return [
    `Overruled with ${supporters.length} of ${bodySize} in support.`,
    ...supporters.map((s) => `${s.name}: ${s.note}`),
  ].join("\n\n");
}

async function isRecusedFrom(objectionId: string, memberId: string) {
  const rows = await db
    .select({ id: communityCheckConcernExclusion.id })
    .from(communityCheckConcernExclusion)
    .where(and(eq(communityCheckConcernExclusion.concernId, objectionId), eq(communityCheckConcernExclusion.memberId, memberId)));
  return rows.length > 0;
}

// §2.6 — the objector may withdraw their own objection, which lets the
// arrival carry on exactly as a clearance does. Kept separate from
// resolveObjection so the "the body did this" and "they changed their
// mind" records can never be confused by a later reader.
export async function withdrawObjection(actor: Member, objectionId: string) {
  const row = await getObjectionForShield(actor, objectionId);
  if (row.raisedById !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can withdraw it");
  }
  if (row.resolution !== "standing") {
    throw new ConflictError("This objection has already been settled");
  }
  const [updated] = await db
    .update(communityCheckConcern)
    .set({ resolution: "withdrawn", resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: null })
    .where(and(eq(communityCheckConcern.id, row.id), eq(communityCheckConcern.resolution, "standing")))
    .returning();
  if (!updated) {
    throw new ConflictError("This objection has already been settled");
  }
  // Withdrawing lets the arrival carry on exactly as a clearance does: nothing is
  // standing, so the window passes.
  await reconcileCheck(updated.checkId);
  return updated;
}

// The duty item itself (§2.6's "becomes a duty item handled by the
// mediation body", §5.4's "the objection state at a glance"). Same
// personal/shared split every other needs-action list uses, so an open
// module doesn't put the same item in everybody's feed: a member who
// holds a mediation task owns it personally, and when the module is open
// with no granting task the outstanding work is the community's, shown
// once in the shared pass.
export type MediationActionItem = {
  id: string;
  raisedAt: Date;
  subject: "application" | "invite";
  subjectLabel: string;
};

export async function listMediationActionItems(actor: Member): Promise<NeedsAction<MediationActionItem>> {
  const empty = { personal: [], shared: [] };
  if (!(await isMediationMember(actor))) return empty;
  const rows = await db
    .select({
      id: communityCheckConcern.id,
      raisedAt: communityCheckConcern.raisedAt,
      route: admission.route,
      kind: communityCheck.kind,
    })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(and(eq(communityCheckConcern.communityId, actor.communityId), eq(communityCheckConcern.resolution, "standing")))
    .orderBy(communityCheckConcern.raisedAt);

  const items: MediationActionItem[] = rows.map((row) => ({
    id: row.id,
    raisedAt: row.raisedAt,
    // Where the window came from: after the reports ("an application") or at the door
    // ("an announced arrival"). Not who or what — the duty is the same either way.
    subject: row.kind === "evaluation" ? "application" : "invite",
    subjectLabel: row.kind === "evaluation" ? "an application" : "an announced arrival",
  }));
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, MEDIATION_MODULE);
  const shared = await isSharedByOpenness(actor.communityId, MEDIATION_MODULE, actor.id, grantingTaskIds);
  return shared ? { personal: [], shared: items } : { personal: items, shared: [] };
}

// Whether *this* application has a concern the body still owes an answer to, used
// by the applications pipeline's at-a-glance badge (§5.4). Counts only — the
// pipeline has no business holding a note, let alone an identity, and a count is
// enough to say "the body has this".
export async function standingObjectionCount(communityId: string, formResponseId: string): Promise<number> {
  const rows = await db
    .select({ id: communityCheckConcern.id })
    .from(communityCheckConcern)
    .innerJoin(communityCheck, eq(communityCheck.id, communityCheckConcern.checkId))
    .innerJoin(admission, eq(admission.id, communityCheck.arrivalId))
    .where(
      and(
        eq(communityCheckConcern.communityId, communityId),
        eq(admission.formResponseId, formResponseId),
        eq(communityCheckConcern.resolution, "standing"),
      ),
    );
  return rows.length;
}

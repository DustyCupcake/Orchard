import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  community,
  communityInvite,
  formResponse,
  member,
  objection,
  objectionPartyConsent,
  objectionPartyExclusion,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable, objection as objectionTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { seedCycleParticipation } from "../participation";
import { isModuleOpenToEveryone, listGrantingTaskIds } from "../permissions";
import type { PermissionModuleKey } from "../permissions";
import { isSharedByOpenness, type NeedsAction } from "../needs-action";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type ObjectionRow = typeof objectionTable.$inferSelect;

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
  if (row.raisedBy === actor.id) return true;
  if (!(await isMediationMember(actor))) return false;
  const excluded = await db
    .select({ id: objectionPartyExclusion.id })
    .from(objectionPartyExclusion)
    .where(and(eq(objectionPartyExclusion.objectionId, row.id), eq(objectionPartyExclusion.memberId, actor.id)))
    .limit(1);
  return excluded.length === 0;
}

// Whether *anyone* in the body may see it — what the queue uses to sort
// "needs the body" from "nobody can see this at all".
export async function objectionIsVisibleToBody(row: ObjectionRow): Promise<boolean> {
  const excluded = await db
    .select({ memberId: objectionPartyExclusion.memberId })
    .from(objectionPartyExclusion)
    .where(eq(objectionPartyExclusion.objectionId, row.id));
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
  if (row.raisedBy !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can recuse anyone from it");
  }
  const [existing] = await db
    .select({ id: objectionPartyExclusion.id })
    .from(objectionPartyExclusion)
    .where(
      and(
        eq(objectionPartyExclusion.objectionId, row.id),
        eq(objectionPartyExclusion.memberId, input.memberId),
      ),
    );
  if (existing) return existing;
  const [created] = await db
    .insert(objectionPartyExclusion)
    .values({ objectionId: row.id, memberId: input.memberId, addedBy: actor.id })
    .returning();
  return created;
}

export async function consentPartyToObjection(
  actor: Member,
  input: { objectionId: string; memberId: string; note?: string | null },
) {
  const row = await getObjectionForShield(actor, input.objectionId);
  if (row.raisedBy !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can consent to anyone being told");
  }
  const [existing] = await db
    .select()
    .from(objectionPartyConsent)
    .where(
      and(
        eq(objectionPartyConsent.objectionId, row.id),
        eq(objectionPartyConsent.memberId, input.memberId),
      ),
    );
  if (existing) {
    const [updated] = await db
      .update(objectionPartyConsent)
      .set({ withdrawnAt: null, note: input.note ?? null, grantedAt: new Date() })
      .where(eq(objectionPartyConsent.id, existing.id))
      .returning();
    return updated;
  }
  const [created] = await db
    .insert(objectionPartyConsent)
    .values({ objectionId: row.id, memberId: input.memberId, note: input.note ?? null })
    .returning();
  return created;
}

export async function withdrawConsentToObjection(actor: Member, objectionId: string, memberId: string) {
  const row = await getObjectionForShield(actor, objectionId);
  if (row.raisedBy !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can withdraw a consent");
  }
  const [updated] = await db
    .update(objectionPartyConsent)
    .set({ withdrawnAt: new Date() })
    .where(
      and(
        eq(objectionPartyConsent.objectionId, row.id),
        eq(objectionPartyConsent.memberId, memberId),
        isNull(objectionPartyConsent.withdrawnAt),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function listObjectionParties(objectionId: string) {
  const [excluded, consented] = await Promise.all([
    db.select().from(objectionPartyExclusion).where(eq(objectionPartyExclusion.objectionId, objectionId)),
    db
      .select()
      .from(objectionPartyConsent)
      .where(and(eq(objectionPartyConsent.objectionId, objectionId), isNull(objectionPartyConsent.withdrawnAt))),
  ]);
  return { excluded, consented };
}

async function getObjectionForShield(actor: Member, objectionId: string): Promise<ObjectionRow> {
  const [row] = await db.select().from(objection).where(eq(objection.id, objectionId));
  if (!row || row.communityId !== actor.communityId) {
    throw new NotFoundError("Objection not found");
  }
  return row;
}

// ---------------------------------------------------------------------------
// The queue (§5.4)
// ---------------------------------------------------------------------------

export type MediationSubject =
  | { kind: "application"; formResponseId: string; cycleId: string | null; submittedAt: Date }
  | { kind: "invite"; inviteId: string; cycleId: string | null; createdAt: Date; consentAt: Date | null };

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
      .from(objection)
      .where(eq(objection.communityId, actor.communityId))
      .orderBy(desc(objection.raisedAt)),
    listMediationMembers(actor.communityId),
    describeMediationAuthority(actor.communityId),
  ]);

  const items: MediationItem[] = [];
  for (const row of rows) {
    const subject = await describeObjectionSubject(row);
    if (!subject) continue;
    const [excluded, consented, objector] = await Promise.all([
      db
        .select({ id: objectionPartyExclusion.id })
        .from(objectionPartyExclusion)
        .where(eq(objectionPartyExclusion.objectionId, row.id)),
      db
        .select({ id: objectionPartyConsent.id })
        .from(objectionPartyConsent)
        .where(and(eq(objectionPartyConsent.objectionId, row.id), isNull(objectionPartyConsent.withdrawnAt))),
      db.select({ name: member.name }).from(member).where(eq(member.id, row.raisedBy)),
    ]);
    // The identity is filled in only for the objector themselves; every
    // other reader of this queue gets a shielded objection, which is the
    // whole point (§2.6) and the reason this is a per-row read rather
    // than one shared object.
    const maySee = row.raisedBy === actor.id;
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
    .select({ resolution: objection.resolution })
    .from(objection)
    .where(and(eq(objection.communityId, communityId), eq(objection.raisedBy, memberId)));
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
  if (row.formResponseId) {
    const [response] = await db
      .select({ cycleId: formResponse.cycleId, submittedAt: formResponse.submittedAt })
      .from(formResponse)
      .where(eq(formResponse.id, row.formResponseId));
    if (!response) return null;
    return { kind: "application", formResponseId: row.formResponseId, cycleId: response.cycleId, submittedAt: response.submittedAt };
  }
  if (row.inviteId) {
    const [invite] = await db
      .select({
        cycleId: communityInvite.cycleId,
        createdAt: communityInvite.createdAt,
        consentAt: communityInvite.consentAt,
      })
      .from(communityInvite)
      .where(eq(communityInvite.id, row.inviteId));
    if (!invite) return null;
    return { kind: "invite", inviteId: row.inviteId, cycleId: invite.cycleId, createdAt: invite.createdAt, consentAt: invite.consentAt };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolving (§2.6, §4.3)
// ---------------------------------------------------------------------------

export const resolveObjectionInput = z.object({
  objectionId: z.string().uuid(),
  // `cleared` and `upheld` are mediation succeeding and mediation
  // concluding the objection holds; `overruled` is the exception the
  // threshold guards. `withdrawn` is deliberately absent here — that one
  // belongs to the objector and goes through withdrawObjection, so it
  // can never be recorded as something the body did.
  outcome: z.enum(["cleared", "upheld", "overruled"]),
  note: z.string().min(1),
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
  if (row.raisedBy === actor.id) {
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

  if (input.outcome === "overruled") {
    const body = await listMediationMembers(actor.communityId);
    const availability = overruleAvailability(communityRow, body.length);
    if (!availability.available) {
      throw new AppError(availability.reason ?? "The overrule isn't available here");
    }
  }

  const [updated] = await db
    .update(objection)
    .set({
      resolution: input.outcome,
      resolvedAt: new Date(),
      resolvedById: actor.id,
      // The audit note §5.4 asks for is the resolutionNote itself, and
      // it is required (not optional) for all three outcomes: "we talked
      // and we're fine" and "we talked and we're not" are both things
      // the next person to read this record needs, and an overrule
      // without a stated reason is the one that most obviously does.
      resolutionNote: input.note,
    })
    .where(and(eq(objection.id, row.id), eq(objection.resolution, "standing")))
    .returning();
  if (!updated) {
    throw new ConflictError("This objection has already been settled");
  }

  await applyObjectionOutcomeToSubject(updated, input.outcome, actor);
  return updated;
}

async function isRecusedFrom(objectionId: string, memberId: string) {
  const rows = await db
    .select({ id: objectionPartyExclusion.id })
    .from(objectionPartyExclusion)
    .where(and(eq(objectionPartyExclusion.objectionId, objectionId), eq(objectionPartyExclusion.memberId, memberId)));
  return rows.length > 0;
}

// The single place an objection's outcome turns into an admission
// decision. Both subject shapes resolve to the same three meanings:
//
//   cleared   — mediation resolved the concern; the arrival carries on.
//   upheld    — the objection stands; the arrival is refused. This is
//               the *default* the plan insists on (§2.6): the burden of
//               persuasion is on the community, not on the newcomer.
//   overruled — the exception; the body voted the concern down and the
//               arrival carries on anyway, over it.
//
// For the evaluated path the arrival is the recruitment decision, so
// this reuses decisions.ts's own resolution path (conversion +
// accompaniment) rather than re-implementing either. For a consensus
// invite it is the invite's own consensus state, and "admission
// completes" means the *arrival* is seeded — the participation row the
// roster and the capacity count are built from. A consensus invitee's
// Member row already exists by the time a window can object, because
// consent is what they had to give to be told any of this; what has not
// happened yet is their place in the event, and that is what an upheld
// objection holds back. Withholding it is not a punishment — it is the
// body declining to complete an admission they have not agreed to, and
// what happens to the account afterwards is a conversation the
// mediation record is there to support.
async function applyObjectionOutcomeToSubject(
  row: ObjectionRow,
  outcome: "cleared" | "upheld" | "overruled",
  actor: Member,
) {
  const admits = outcome === "cleared" || outcome === "overruled";
  if (row.formResponseId) {
    const [decision] = await db
      .select()
      .from(recruitmentDecision)
      .where(eq(recruitmentDecision.formResponseId, row.formResponseId));
    if (decision) {
      if (decision.resolution === null) {
        const { resolveWiderDiscussionManually } = await import("./decisions");
        await resolveWiderDiscussionManually(actor, row.formResponseId, {
          resolution: admits ? "accepted" : "declined",
        });
      } else if (decision.resolution !== (admits ? "accepted" : "declined")) {
        const [patched] = await db
          .update(recruitmentDecision)
          .set({ resolution: admits ? "accepted" : "declined" })
          .where(eq(recruitmentDecision.id, decision.id))
          .returning();
        if (admits && patched) {
          const { applyAcceptanceSideEffects } = await import("./decisions");
          const [communityRow] = await db
            .select()
            .from(community)
            .where(eq(community.id, row.communityId));
          if (communityRow) {
            await applyAcceptanceSideEffects(actor, communityRow, patched);
          }
        }
      }
    }
  }
  if (row.inviteId) {
    const [invite] = await db.select().from(communityInvite).where(eq(communityInvite.id, row.inviteId));
    if (invite) {
      await db
        .update(communityInvite)
        .set({ consensusState: admits ? "admitted" : "withheld" })
        .where(eq(communityInvite.id, invite.id));
      if (admits && invite.cycleId && invite.redeemedByMemberId) {
        await seedCycleParticipation(db, invite.cycleId, invite.redeemedByMemberId);
      }
    }
  }
}

// §2.6 — the objector may withdraw their own objection, which admits the
// arrival exactly as a clearance does. Kept separate from
// resolveObjection so the "the body did this" and "they changed their
// mind" records can never be confused by a later reader.
export async function withdrawObjection(actor: Member, objectionId: string) {
  const row = await getObjectionForShield(actor, objectionId);
  if (row.raisedBy !== actor.id) {
    throw new ForbiddenError("Only the person who raised this objection can withdraw it");
  }
  if (row.resolution !== "standing") {
    throw new ConflictError("This objection has already been settled");
  }
  const [updated] = await db
    .update(objection)
    .set({ resolution: "withdrawn", resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: null })
    .where(and(eq(objection.id, row.id), eq(objection.resolution, "standing")))
    .returning();
  if (!updated) {
    throw new ConflictError("This objection has already been settled");
  }
  await applyObjectionOutcomeToSubject(updated, "cleared", actor);
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
    .select({ id: objection.id, formResponseId: objection.formResponseId, inviteId: objection.inviteId, raisedAt: objection.raisedAt })
    .from(objection)
    .where(and(eq(objection.communityId, actor.communityId), eq(objection.resolution, "standing")))
    .orderBy(objection.raisedAt);

  const items: MediationActionItem[] = [];
  for (const row of rows) {
    if (row.formResponseId) {
      items.push({
        id: row.id,
        raisedAt: row.raisedAt,
        subject: "application",
        subjectLabel: "an application",
      });
    } else if (row.inviteId) {
      items.push({
        id: row.id,
        raisedAt: row.raisedAt,
        subject: "invite",
        subjectLabel: "an announced arrival",
      });
    }
  }
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, MEDIATION_MODULE);
  const shared = await isSharedByOpenness(actor.communityId, MEDIATION_MODULE, actor.id, grantingTaskIds);
  return shared ? { personal: [], shared: items } : { personal: items, shared: [] };
}

// Whether *this* application has an objection the body still owes an
// answer to, used by the applications pipeline's at-a-glance badge
// (§5.4). Counts only — the pipeline has no business holding a note, let
// alone an identity, and a count is enough to say "the body has this".
export async function standingObjectionCount(communityId: string, formResponseId: string): Promise<number> {
  const rows = await db
    .select({ id: objection.id })
    .from(objection)
    .where(
      and(
        eq(objection.communityId, communityId),
        eq(objection.formResponseId, formResponseId),
        eq(objection.resolution, "standing"),
      ),
    );
  return rows.length;
}

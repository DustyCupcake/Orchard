import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { communityInvite, formResponse, objection, recruitmentSubscription } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import {
  getCommunityRow,
  listHeldRecruitmentScopes,
  requireRecruitmentScopeForCycle,
  requireRecruitmentTaskHolder,
} from "./access";
import { computeWiderDiscussionStatus, getRecruitmentDecision } from "./decisions";
import { canSeeObjectorIdentity } from "./mediation";

type Member = typeof memberTable.$inferSelect;

export const raiseObjectionInput = z.object({
  note: z.string().min(1),
});
export type RaiseObjectionInput = z.infer<typeof raiseObjectionInput>;

// "Subscribed members can raise an anonymous-to-the-community... but
// visible-to-the-evaluators objection" — see docs/spec.md's
// Recruitment. Open only to a member with an active
// RecruitmentSubscription (Phase 33's own mechanism), and only while the
// wider-discussion window is genuinely still open.
export async function raiseObjection(actor: Member, formResponseId: string, input: RaiseObjectionInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [subscription] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  if (!subscription?.active) {
    throw new ForbiddenError("Only a subscribed member can raise an objection");
  }

  const decision = await getRecruitmentDecision(formResponseId);
  if (!decision) {
    throw new NotFoundError("No decision has been reached for this application yet");
  }
  if (computeWiderDiscussionStatus(decision) !== "open") {
    throw new ConflictError("The wider-discussion window for this application isn't open");
  }

  const [created] = await db
    .insert(objection)
    .values({ communityId: actor.communityId, formResponseId, raisedBy: actor.id, note: input.note })
    .returning();
  return created;
}

// The consensus-lane twin (docs/plans/archive/joining-admission-plan.md §2.6): a
// subscribed member objects to an announced arrival. Same eligibility as
// the evaluated path — an active subscription, i.e. somebody who opted
// into being told about arrivals — and, unlike the evaluated path, no
// deadline pressure: the window is real, and an objection inside it
// stands until the body acts (§4.3). The objector cannot be the
// invitee's inviter, because §2.6 is explicit that the shield does not
// leak through the invitee's friend, and the cheapest way to keep that
// promise is not to let the inviter raise the objection at all.
export async function raiseInviteObjection(actor: Member, inviteId: string, note: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "recruitment");

  const [subscription] = await db
    .select({ active: recruitmentSubscription.active })
    .from(recruitmentSubscription)
    .where(eq(recruitmentSubscription.memberId, actor.id));
  if (!subscription?.active) {
    throw new ForbiddenError("Only a subscribed member can raise an objection");
  }

  const [invite] = await db
    .select()
    .from(communityInvite)
    .where(and(eq(communityInvite.id, inviteId), eq(communityInvite.communityId, actor.communityId)));
  if (!invite) {
    throw new NotFoundError("That arrival isn't in your community");
  }
  if (invite.consensusState !== "announced") {
    throw new ConflictError("This arrival isn't open for a community check right now");
  }
  if (invite.createdBy === actor.id) {
    throw new ForbiddenError("You invited this person, so you can't object to their arrival");
  }
  if (invite.redeemedByMemberId === actor.id) {
    throw new ForbiddenError("This is your own arrival");
  }

  const [existing] = await db
    .select({ id: objection.id })
    .from(objection)
    .where(and(eq(objection.inviteId, inviteId), eq(objection.raisedBy, actor.id)));
  if (existing) {
    throw new ConflictError("You've already raised a concern about this arrival");
  }

  const [created] = await db
    .insert(objection)
    .values({ communityId: actor.communityId, inviteId, raisedBy: actor.id, note: note.trim() })
    .returning();
  return created;
}

// Evaluator-visible, identity-shielded (docs/plans/archive/joining-admission-plan.md
// §2.6/§4.3). The list itself is unchanged in *shape* from what
// evaluators saw before — a note and a timestamp, no name — but the
// reason is now stronger than "anonymous to the community": the
// identity exists on the row and is readable only by the mediation body
// and the objector. So a later reader of this function should not be
// tempted to "helpfully" add `raisedBy` back: that column is the shield,
// and canSeeObjectorIdentity is the only thing allowed to decide who
// sees it.
//
// Scoped like every other holder read (§4.3): a cycle-placed holder
// only sees objections on their own cycle's applications.
export async function listObjections(actor: Member, formResponseId: string) {
  await requireRecruitmentTaskHolder(actor);
  const [responseRow] = await db
    .select({ cycleId: formResponse.cycleId })
    .from(formResponse)
    .where(eq(formResponse.id, formResponseId));
  if (!responseRow) {
    throw new NotFoundError("Application not found");
  }
  await requireRecruitmentScopeForCycle(actor, responseRow.cycleId);
  const rows = await db
    .select({
      id: objection.id,
      note: objection.note,
      raisedAt: objection.raisedAt,
      resolution: objection.resolution,
      resolvedAt: objection.resolvedAt,
      resolutionNote: objection.resolutionNote,
    })
    .from(objection)
    .where(eq(objection.formResponseId, formResponseId));
  return rows;
}

// The same list for the body rather than the evaluators: identical rows,
// plus whether *this* member is allowed to see who raised each one. Used
// by the mediation queue, which is where the shielded identity actually
// becomes visible.
export async function listObjectionsForMediation(actor: Member, objectionIds: string[]) {
  if (objectionIds.length === 0) return [];
  const rows = await db.select().from(objection).where(inArray(objection.id, objectionIds));
  const out = [];
  for (const row of rows) {
    out.push({
      ...row,
      maySeeIdentity: await canSeeObjectorIdentity(actor, row),
    });
  }
  return out;
}

// The recruitment team's own view: told a concern exists and has to go
// and talk to somebody, and nothing else — no note, no date, no name.
// The team is the audience §2.6's "talking with the objector, the
// inviter/applicant, and the invitee separately" is written for, and
// the separation only works if they start without the note in front of
// them.
export async function listStandingObjectionSummaries(actor: Member) {
  await requireRecruitmentTaskHolder(actor);
  const held = await listHeldRecruitmentScopes(actor);
  const rows = await db
    .select({
      id: objection.id,
      formResponseId: objection.formResponseId,
      inviteId: objection.inviteId,
      raisedAt: objection.raisedAt,
      resolution: objection.resolution,
    })
    .from(objection)
    .where(and(eq(objection.communityId, actor.communityId), eq(objection.resolution, "standing")));

  const out: typeof rows = [];
  for (const row of rows) {
    if (row.formResponseId) {
      const [response] = await db
        .select({ cycleId: formResponse.cycleId })
        .from(formResponse)
        .where(eq(formResponse.id, row.formResponseId));
      if (!response || !(held.has(null) || (response.cycleId !== null && held.has(response.cycleId)))) continue;
    } else if (row.inviteId) {
      const [invite] = await db
        .select({ cycleId: communityInvite.cycleId })
        .from(communityInvite)
        .where(eq(communityInvite.id, row.inviteId));
      if (!invite || !(held.has(null) || (invite.cycleId !== null && held.has(invite.cycleId)))) continue;
    } else {
      continue;
    }
    out.push(row);
  }
  return out;
}

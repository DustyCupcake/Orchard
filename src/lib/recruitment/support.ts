import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  communityInvite,
  formResponse,
  joiningNomination,
  joiningSupport,
  member,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { generateToken } from "../token";
import { getCommunityRow } from "./access";
import { getJoinLaneRule } from "./joining-lanes";
import type { JoiningLaneRule } from "./lanes";

type Member = typeof memberTable.$inferSelect;

const MS_PER_HOUR = 3600_000;

// Nomination, the second of the three verification modes
// (docs/plans/archive/joining-admission-plan.md §2.2/§2.4/§2.5, work-plan step 4).
// The whole design rests on one asymmetry with the rest of this codebase:
// a task candidacy's endorsements auto-fail an unsupported nominee, and
// an *invite* must never do that. A person who has been invited and
// cannot find anybody to second them has not done anything wrong, and
// the plan's answer is that the decision belongs to them (J6) — they can
// skip the window and do the application instead, and if they do
// nothing at all the window lapses and they fall through to the lane's
// process path anyway. There is deliberately no code path here that
// refuses an arrival.

// The support token's public half. `/support/[token]` and
// `/api/support/[token]` need to resolve a token into "which
// community, which lane, which subject" without a session — the whole
// point of the link is that it can be opened by someone who isn't a
// member yet.
export async function getJoiningSupportByToken(token: string) {
  const [nomination] = await db
    .select()
    .from(joiningNomination)
    .where(eq(joiningNomination.supportToken, token));
  if (!nomination) {
    return null;
  }
  const [subject] = nomination.inviteId
    ? await db
        .select({
          kind: sql<"invite">`'invite'`,
          label: communityInvite.label,
          cycleId: communityInvite.cycleId,
          inviterKnowsPersonally: communityInvite.inviterKnowsPersonally,
          inviterThinksGoodFit: communityInvite.inviterThinksGoodFit,
          redeemedAt: communityInvite.redeemedAt,
          withdrawnAt: communityInvite.revokedAt,
        })
        .from(communityInvite)
        .where(eq(communityInvite.id, nomination.inviteId))
    : nomination.formResponseId
      ? await db
          .select({
            kind: sql<"application">`'application'`,
            label: sql<string | null>`NULL`,
            cycleId: formResponse.cycleId,
            inviterKnowsPersonally: sql<boolean>`false`,
            inviterThinksGoodFit: sql<boolean>`false`,
            redeemedAt: sql<Date | null>`NULL`,
            withdrawnAt: sql<Date | null>`NULL`,
          })
          .from(formResponse)
          .where(eq(formResponse.id, nomination.formResponseId))
      : [];
  return { nomination, subject: subject ?? null };
}

export type SupportSubject = {
  kind: "invite" | "application";
  label: string | null;
  cycleId: string | null;
  inviterKnowsPersonally: boolean;
  inviterThinksGoodFit: boolean;
  redeemedAt: Date | null;
  withdrawnAt: Date | null;
};

export type SupportView = {
  communityId: string;
  token: string;
  nominationId: string;
  state: JoiningNominationState;
  deadline: Date | null;
  lane: "invited_knows_personally" | "invited_good_fit" | "invited_neither" | "public_application";
  rule: JoiningLaneRule;
  supports: { memberId: string; name: string; knowsPersonally: boolean; thinksGoodFit: boolean }[];
  supportCount: number;
  supportedByMe: { knowsPersonally: boolean; thinksGoodFit: boolean } | null;
  applyInsteadAvailable: boolean;
  // Which kind of subject is waiting. The support *view* is identical for
  // both — same marks, same count, same deadline — but §2.5's "skip and
  // do the application instead" only means something for the invite
  // shape, because somebody who has already applied has nothing left to
  // go and do.
  subjectKind: "invite" | "application";
};

// The lane a subject sits in, resolved live. For an invite that is the
// lane its inviter's marks fixed at send; for a public application it is
// the public lane by definition.
async function laneForSubject(subject: SupportSubject) {
  if (subject.kind === "invite") {
    if (subject.inviterKnowsPersonally) return "invited_knows_personally" as const;
    if (subject.inviterThinksGoodFit) return "invited_good_fit" as const;
    return "invited_neither" as const;
  }
  return "public_application" as const;
}

// Everything the support page and the invitation email need, in one
// read. Read by members (to support) and by logged-out visitors (to be
// routed to the application), so no authorization here beyond holding a
// valid token — which is the same "the token is the proof" posture
// communityInvite's own public page takes.
export async function getSupportView(token: string, viewer: Member | null): Promise<SupportView | null> {
  const found = await getJoiningSupportByToken(token);
  if (!found || !found.subject) {
    return null;
  }
  const { nomination, subject } = found;
  const lane = await laneForSubject(subject);
  const rule = await getJoinLaneRule(nomination.communityId, subject.cycleId, lane);

  const supportRows = await db
    .select({
      memberId: joiningSupport.supporterId,
      knowsPersonally: joiningSupport.knowsPersonally,
      thinksGoodFit: joiningSupport.thinksGoodFit,
    })
    .from(joiningSupport)
    .where(eq(joiningSupport.nominationId, nomination.id))
    .orderBy(joiningSupport.createdAt);
  const names = new Map(
    supportRows.length === 0
      ? []
      : (
          await db
            .select({ id: member.id, name: member.name })
            .from(member)
            .where(inArray(member.id, supportRows.map((s) => s.memberId)))
        ).map((m) => [m.id, m.name]),
  );

  const mine = viewer ? supportRows.find((s) => s.memberId === viewer.id) : undefined;
  return {
    communityId: nomination.communityId,
    token,
    nominationId: nomination.id,
    state: nomination.state,
    deadline: nomination.deadline,
    lane,
    rule,
    supports: supportRows.map((s) => ({
      memberId: s.memberId,
      name: names.get(s.memberId) ?? "A member",
      knowsPersonally: s.knowsPersonally,
      thinksGoodFit: s.thinksGoodFit,
    })),
    supportCount: Math.max(1, rule.supportCount),
    supportedByMe: mine ? { knowsPersonally: mine.knowsPersonally, thinksGoodFit: mine.thinksGoodFit } : null,
    applyInsteadAvailable: rule.applyInsteadAvailable,
    subjectKind: subject.kind,
  };
}

// Opening a nomination is the *only* thing that puts someone into a
// support window, and it happens at the moment the subject is created:
// an invite whose lane resolved to nomination, or a public application
// on a nomination lane. Idempotent on the subject (the schema's unique
// index on invite_id / form_response_id), so a re-run of the funnel
// finds the window already open rather than resetting its deadline.
//
// Deliberately not told the lane's rule. How many supports are needed is
// read live (getSupportView) and the deadline comes from the community's
// current window setting, so a community that changes either mid-window
// sees the change on the page rather than in a value frozen at send —
// which is the same "mode-following, never snapshotted" rule the lane
// resolution itself keeps.
export async function openNominationForInvite(invite: typeof communityInvite.$inferSelect) {
  const [existing] = await db
    .select()
    .from(joiningNomination)
    .where(eq(joiningNomination.inviteId, invite.id));
  if (existing) {
    return existing;
  }
  const community = await getCommunityRow(invite.communityId);
  const [created] = await db
    .insert(joiningNomination)
    .values({
      communityId: invite.communityId,
      inviteId: invite.id,
      supportToken: generateToken(),
      deadline: new Date(Date.now() + community.recruitmentNominationWindowHours * MS_PER_HOUR),
    })
    .returning();
  return created;
}

export async function openNominationForApplication(formResponseId: string, communityId: string) {
  const [existing] = await db
    .select()
    .from(joiningNomination)
    .where(eq(joiningNomination.formResponseId, formResponseId));
  if (existing) {
    return existing;
  }
  const community = await getCommunityRow(communityId);
  const [created] = await db
    .insert(joiningNomination)
    .values({
      communityId,
      formResponseId,
      supportToken: generateToken(),
      deadline: new Date(Date.now() + community.recruitmentNominationWindowHours * MS_PER_HOUR),
    })
    .returning();
  return created;
}

export async function getNominationForInvite(inviteId: string) {
  const [row] = await db.select().from(joiningNomination).where(eq(joiningNomination.inviteId, inviteId));
  return row ?? null;
}

export async function getNominationForApplication(formResponseId: string) {
  const [row] = await db.select().from(joiningNomination).where(eq(joiningNomination.formResponseId, formResponseId));
  return row ?? null;
}

export const recordSupportInput = z.object({
  token: z.string().min(1),
  // §2.4 — the supporter records *their own* marks, which is what
  // makes the second a real second rather than a rubber stamp of the
  // first. At least one has to be ticked: a support row with neither
  // mark records no information at all, and "I clicked the button"
  // is not social proof.
  knowsPersonally: z.boolean().default(false),
  thinksGoodFit: z.boolean().default(false),
});
export type RecordSupportInput = z.infer<typeof recordSupportInput>;

// §2.4 — "a member who opens it can second the nomination, recording
// their own knowsPersonally/thinksGoodFit marks; the parties see
// 'supported by {name}'". Resubmittable in place: a supporter who
// strengthens (or corrects) their own mark before the window closes
// updates the row rather than adding a second one, the same posture
// src/db/schema/recruitment.ts's `evaluation` table takes.
export async function recordSupport(actor: Member, input: RecordSupportInput) {
  if (!input.knowsPersonally && !input.thinksGoodFit) {
    throw new ConflictError("Say how you know this person — personally, or that you'd expect them to fit");
  }
  const view = await getSupportView(input.token, actor);
  if (!view) {
    throw new NotFoundError("That support link isn't valid any more");
  }
  if (view.communityId !== actor.communityId) {
    throw new ForbiddenError("That support link belongs to another community");
  }
  if (view.state !== "awaiting") {
    throw new ConflictError("This nomination has already been settled");
  }

  const [existing] = await db
    .select()
    .from(joiningSupport)
    .where(and(eq(joiningSupport.nominationId, view.nominationId), eq(joiningSupport.supporterId, actor.id)));
  if (existing) {
    const [updated] = await db
      .update(joiningSupport)
      .set({ knowsPersonally: input.knowsPersonally, thinksGoodFit: input.thinksGoodFit })
      .where(eq(joiningSupport.id, existing.id))
      .returning();
    return { support: updated, reached: await supportSatisfied(view.nominationId, view.supportCount) };
  }

  const [created] = await db
    .insert(joiningSupport)
    .values({
      nominationId: view.nominationId,
      supporterId: actor.id,
      knowsPersonally: input.knowsPersonally,
      thinksGoodFit: input.thinksGoodFit,
    })
    .returning();
  return { support: created, reached: await supportSatisfied(view.nominationId, view.supportCount) };
}

async function supportSatisfied(nominationId: string, supportCount: number) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(joiningSupport)
    .where(eq(joiningSupport.nominationId, nominationId));
  return (row?.count ?? 0) >= supportCount;
}

// Marks the nomination satisfied as soon as the count is met. Done
// inline rather than by a job so the person being supported finds out
// the moment the last support lands, which is the entire point of the
// window existing.
export async function settleNominationIfSatisfied(nominationId: string, supportCount: number) {
  if (!(await supportSatisfied(nominationId, supportCount))) {
    return null;
  }
  const [updated] = await db
    .update(joiningNomination)
    .set({ state: "supported", updatedAt: new Date() })
    .where(and(eq(joiningNomination.id, nominationId), eq(joiningNomination.state, "awaiting")))
    .returning();
  return updated ?? null;
}

// §2.5/J6 — "at any time during the window, the invitee can choose
// 'skip the nomination, I'll do the application instead' — dropping
// straight onto the lane's configured process." Public, because the
// person doing it is the one who is *not* a member yet: they are
// holding nothing but the support link. The window stays open after
// this — a second person may still turn up and vouch, and if the
// subject is still around for it the extra support is a gift, not a
// lost cause — but the subject is no longer waiting.
//
// Returns the subject too, because the caller has to send them
// somewhere: an invite-backed nomination has an apply link to hand them,
// and an application-backed one has nothing left to skip *to* (they have
// already applied; skipping only stops them being counted as waiting).
export async function skipNomination(token: string) {
  const view = await getSupportView(token, null);
  if (!view) {
    throw new NotFoundError("That support link isn't valid any more");
  }
  if (view.state !== "awaiting") {
    throw new ConflictError("This nomination has already been settled");
  }
  const [updated] = await db
    .update(joiningNomination)
    .set({ state: "skipped", updatedAt: new Date() })
    .where(and(eq(joiningNomination.id, view.nominationId), eq(joiningNomination.state, "awaiting")))
    .returning();
  if (!updated) {
    throw new ConflictError("This nomination has already been settled");
  }
  const [subject] = updated.inviteId
    ? await db.select({ token: communityInvite.token }).from(communityInvite).where(eq(communityInvite.id, updated.inviteId))
    : [];
  return { nomination: updated, inviteToken: subject?.token ?? null };
}

// The other end of §2.5: "if the window lapses unsupported, the invite
// falls through automatically to the lane's process path." Wired into
// the same scheduler as the wider-discussion windows
// (src/instrumentation.ts). Note what this job does *not* do: it never
// refuses anyone, and it never sends anyone away. It moves `awaiting` to
// `lapsed`, which every reader treats exactly like `skipped` — "the
// nomination is over, carry on with whatever this lane's process is".
export async function lapseExpiredNominations() {
  const due = await db
    .select()
    .from(joiningNomination)
    .where(and(eq(joiningNomination.state, "awaiting"), lt(joiningNomination.deadline, new Date())));
  const lapsed: string[] = [];
  for (const nomination of due) {
    const [updated] = await db
      .update(joiningNomination)
      .set({ state: "lapsed", updatedAt: new Date() })
      .where(and(eq(joiningNomination.id, nomination.id), eq(joiningNomination.state, "awaiting")))
      .returning();
    if (updated) lapsed.push(updated.id);
  }
  return { checked: due.length, lapsed };
}

// Whether a nomination is still holding its subject at the door. `lapsed`
// and `skipped` both count as "no longer waiting" (J6), and `supported`
// does too.
export function nominationIsWaiting(state: JoiningNominationState): boolean {
  return state === "awaiting";
}

export type JoiningNominationState = (typeof joiningNomination.$inferSelect)["state"];

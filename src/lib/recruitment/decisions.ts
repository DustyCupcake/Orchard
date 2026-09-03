import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  communityInvite,
  form,
  formResponse,
  member,
  memberIdentity,
  objection,
  recruitmentApplicationInvite,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import type { FormField } from "../forms";
import { ConflictError, NotFoundError } from "../errors";
import { createTask } from "../tasks";
import { createPoll } from "../scheduling-polls";
import { generateToken } from "../token";
import { getCommunityRow, requireRecruitmentTaskHolder } from "./access";
import { computeRecruitmentOutcome } from "./evaluations";

type Member = typeof memberTable.$inferSelect;
type CommunityRow = typeof communityTable.$inferSelect;
type RecruitmentDecisionRow = typeof recruitmentDecision.$inferSelect;

const MS_PER_HOUR = 3600_000;
const INTRO_CALL_WINDOW_DAYS = 14;

export async function getRecruitmentDecision(formResponseId: string) {
  const [row] = await db.select().from(recruitmentDecision).where(eq(recruitmentDecision.formResponseId, formResponseId));
  return row ?? null;
}

// The reverse lookup a task detail page needs to know "is this task an
// Accompaniment task, and if so, whose engagement record does its
// holder get to see" — see docs/spec.md's Recruitment ("the
// accompanier gets explicit... visibility into the new member's
// engagement record") and docs/development-plan.md's Phase 52. Null
// whenever this isn't an Accompaniment task at all, or the decision
// that created it never converted a real Member (an untagged
// application Form — see Phase 48's own maybeConvertApplicantToMember).
export async function getAccompaniedMemberId(taskId: string): Promise<string | null> {
  const [row] = await db
    .select({ convertedMemberId: recruitmentDecision.convertedMemberId })
    .from(recruitmentDecision)
    .where(eq(recruitmentDecision.accompanimentTaskId, taskId));
  return row?.convertedMemberId ?? null;
}

// Purely time-computed from widerDiscussionDeadline, the same no-
// scheduler-job-for-the-status-itself pattern Phase 31's returning-
// priority window and Assemblies' computeAssemblyPhase already
// establish — actually resolving it (a real write, possibly creating
// an Accompaniment task) is resolveWiderDiscussionWindows' job below.
export type WiderDiscussionStatus = "open" | "closed" | null;
export function computeWiderDiscussionStatus(decision: RecruitmentDecisionRow): WiderDiscussionStatus {
  if (decision.ruleOutcome !== "wider_discussion") return null;
  if (decision.resolution !== null) return "closed";
  if (!decision.widerDiscussionDeadline) return null;
  return new Date() < decision.widerDiscussionDeadline ? "open" : "closed";
}

// Whoever currently holds the recruitment task, first by claimedAt —
// used as the acting/creating member for automated task creation that
// has no live human actor behind it (the scheduled wider-discussion
// resolution job). Synchronous, evaluator-triggered creation instead
// uses the filing evaluator directly, a real person taking a real
// action.
async function getRecruitmentTaskHolderMember(communityRow: CommunityRow): Promise<Member | null> {
  if (!communityRow.recruitmentTaskId) return null;
  const [holding] = await db
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(eq(taskAssignment.taskId, communityRow.recruitmentTaskId), eq(taskAssignment.isShadow, false)))
    .orderBy(taskAssignment.claimedAt)
    .limit(1);
  if (!holding) return null;
  const [holder] = await db.select().from(member).where(eq(member.id, holding.memberId));
  return holder ?? null;
}

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

// "The intro-call SchedulingPoll is created in must-overlap-specific-
// people mode against the two evaluators as real, required Member
// participants, while the applicant is tracked by [their] FormResponse
// ... required participant for the applicant's side means their own
// token-linked availability submission, not a memberId" — docs/
// development-plan.md's Phase 34. requiredParticipantIds mixes real
// evaluator member ids with the applicant's own formResponseId; that
// field is an unconstrained uuid[] already (see its own schema
// comment), and getPollAggregate's participant key already falls back
// to formResponseId when memberId is null, so must-overlap resolution
// needs no further special-casing to treat the two uniformly.
async function createIntroCallPoll(
  actor: Member,
  communityRow: CommunityRow,
  formResponseId: string,
  evaluatorIds: string[],
) {
  if (!communityRow.recruitmentTaskId) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(eq(task.id, communityRow.recruitmentTaskId));
  if (!recruitmentTaskRow) return null;

  const now = new Date();
  const poll = await createPoll(actor, {
    branchId: recruitmentTaskRow.branchId,
    title: "Recruitment intro call",
    resolutionMode: "must_overlap",
    requiredParticipantIds: [...evaluatorIds, formResponseId],
    rangeStart: isoDate(now),
    rangeEnd: isoDate(new Date(now.getTime() + INTRO_CALL_WINDOW_DAYS * 86_400_000)),
  });

  return { pollId: poll.id, token: generateToken() };
}

// Idempotent — convertedMemberId is the marker. docs/development-
// plan.md's Phase 48: the real conversion step Phases 32-34
// deliberately left un-mechanized (see maybeCreateAccompanimentTask's
// own historical comment above, and src/db/schema/recruitment.ts's
// recruitmentDecision comment). Since a Form's fields are opaque to
// the platform (docs/spec.md's Forms), this only ever runs when the
// application Form itself tags which field holds the applicant's name
// and which holds their email (src/lib/forms.ts's
// isNameField/isEmailField) — an untagged form is a real, visible
// limitation (surfaced on the Accompaniment task's own description
// below), not a silent failure. Mirrors src/lib/recruitment/
// invites.ts's redeemCommunityInvite almost exactly (same Member +
// MemberIdentity two-row shape, same "an email already on file links
// to the existing member rather than erroring or duplicating" posture
// — an applicant who separately redeemed an invite, or already had an
// account before Recruitment was turned on, is a real, if rare, case
// worth handling gracefully rather than crashing the decision).
async function maybeConvertApplicantToMember(
  communityRow: CommunityRow,
  decision: RecruitmentDecisionRow,
): Promise<RecruitmentDecisionRow> {
  if (decision.convertedMemberId) return decision;

  const [responseRow] = await db.select().from(formResponse).where(eq(formResponse.id, decision.formResponseId));
  if (!responseRow) return decision;
  const [formRow] = await db.select().from(form).where(eq(form.id, responseRow.formId));
  if (!formRow) return decision;

  const fields = formRow.fields as FormField[];
  const nameField = fields.find((f) => f.isNameField);
  const emailField = fields.find((f) => f.isEmailField);
  if (!nameField || !emailField) return decision;

  const values = responseRow.values as Record<string, unknown>;
  const name = typeof values[nameField.key] === "string" ? (values[nameField.key] as string).trim() : "";
  const rawEmail = typeof values[emailField.key] === "string" ? (values[emailField.key] as string).trim().toLowerCase() : "";
  if (!name || !z.string().email().safeParse(rawEmail).success) return decision;

  // The same "who vouched for this person" fact
  // maybeCreateAccompanimentTask already read on its own before this
  // function existed — reused here so the new Member's own
  // referredByMemberId carries it directly, per spec's exact framing
  // ("pre-filling suggestedMemberId from the new member's
  // referredByMemberId"), rather than maybeCreateAccompanimentTask
  // re-deriving it a second, parallel way.
  const [linkedInvite] = await db
    .select({ createdBy: communityInvite.createdBy })
    .from(recruitmentApplicationInvite)
    .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
    .where(eq(recruitmentApplicationInvite.formResponseId, decision.formResponseId));

  const [existingIdentity] = await db
    .select({ memberId: memberIdentity.memberId })
    .from(memberIdentity)
    .where(and(eq(memberIdentity.provider, "magic_link"), eq(memberIdentity.loginEmail, rawEmail)));

  const memberId = existingIdentity
    ? existingIdentity.memberId
    : await db.transaction(async (tx) => {
        const [newMember] = await tx
          .insert(member)
          .values({
            communityId: communityRow.id,
            name,
            referredByMemberId: linkedInvite?.createdBy ?? null,
          })
          .returning();
        await tx.insert(memberIdentity).values({
          memberId: newMember.id,
          provider: "magic_link",
          loginEmail: rawEmail,
        });
        return newMember.id;
      });

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ convertedMemberId: memberId })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();
  return updated;
}

// Idempotent — accompanimentTaskId is the marker. suggestedMemberId
// pre-fills from the accepted applicant's own referredByMemberId once
// maybeConvertApplicantToMember above has run (spec's exact framing —
// "the same 'carry a shadow forward as a suggested next claimant'
// reasoning Phase 14 already established for succession, applied here
// to a referrer instead of a shadow," docs/development-plan.md's Phase
// 34); falls back to the linked invite's own creator directly when
// conversion didn't happen (an untagged application Form — see
// maybeConvertApplicantToMember's own comment) so this still degrades
// to Phase 34's original resolved interpretation rather than losing
// the suggestion entirely.
async function maybeCreateAccompanimentTask(actor: Member, communityRow: CommunityRow, decision: RecruitmentDecisionRow) {
  if (decision.accompanimentTaskId) return null;
  if (!communityRow.recruitmentTaskId) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(eq(task.id, communityRow.recruitmentTaskId));
  if (!recruitmentTaskRow) return null;

  let suggestedMemberId: string | null = null;
  if (decision.convertedMemberId) {
    const [convertedMember] = await db.select().from(member).where(eq(member.id, decision.convertedMemberId));
    suggestedMemberId = convertedMember?.referredByMemberId ?? null;
  } else {
    const [linked] = await db
      .select({ createdBy: communityInvite.createdBy })
      .from(recruitmentApplicationInvite)
      .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
      .where(eq(recruitmentApplicationInvite.formResponseId, decision.formResponseId));
    suggestedMemberId = linked?.createdBy ?? null;
  }

  const description = decision.convertedMemberId
    ? `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission.`
    : `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission. The application Form isn't tagged with a name/email field, so no Member was created automatically; someone will need to invite or otherwise onboard this person by hand.`;

  const created = await createTask(
    actor,
    {
      branchId: recruitmentTaskRow.branchId,
      title: "Accompany new member",
      description,
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
    },
    actor.id,
  );

  if (suggestedMemberId) {
    await db.update(task).set({ suggestedMemberId }).where(eq(task.id, created.id));
  }

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ accompanimentTaskId: created.id })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();
  return updated;
}

// The real, persisted trigger point Phase 33 deliberately didn't build
// — called after every submitEvaluation, but only actually does
// anything the first time enough evaluators have filed for this
// formResponseId (idempotent: a recruitmentDecision row already
// existing means this is a no-op). See src/db/schema/recruitment.ts's
// recruitmentDecision comment for the full state-machine reasoning.
export async function recordDecisionIfReached(actor: Member, formResponseId: string) {
  const existing = await getRecruitmentDecision(formResponseId);
  if (existing) return existing;

  const communityRow = await getCommunityRow(actor.communityId);
  const result = await computeRecruitmentOutcome(communityRow, formResponseId);
  if (!result.outcome) return null;

  const resolution: "accepted" | "declined" | null =
    result.outcome === "proceed" ? "accepted" : result.outcome === "decline" ? "declined" : null;
  const widerDiscussionDeadline =
    result.outcome === "wider_discussion"
      ? new Date(Date.now() + communityRow.recruitmentWiderDiscussionHours * MS_PER_HOUR)
      : null;

  const [created] = await db
    .insert(recruitmentDecision)
    .values({
      formResponseId,
      ruleOutcome: result.outcome,
      defaultResolution: result.defaultResolution,
      resolution,
      widerDiscussionDeadline,
    })
    .returning();

  let decisionRow = created;

  // "Proceed-adjacent" — proceed and wider_discussion both auto-
  // schedule the intro call; decline never does.
  if (result.outcome !== "decline") {
    const evaluatorIds = result.evaluations.map((e) => e.evaluatorId);
    const introCall = await createIntroCallPoll(actor, communityRow, formResponseId, evaluatorIds);
    if (introCall) {
      const [updated] = await db
        .update(recruitmentDecision)
        .set({ introCallPollId: introCall.pollId, introCallToken: introCall.token })
        .where(eq(recruitmentDecision.id, created.id))
        .returning();
      decisionRow = updated;
    }
  }

  if (resolution === "accepted") {
    decisionRow = await maybeConvertApplicantToMember(communityRow, decisionRow);
    const updated = await maybeCreateAccompanimentTask(actor, communityRow, decisionRow);
    if (updated) decisionRow = updated;
  }

  return decisionRow;
}

export const resolveWiderDiscussionInput = z.object({
  resolution: z.enum(["accepted", "declined"]),
});
export type ResolveWiderDiscussionInput = z.infer<typeof resolveWiderDiscussionInput>;

// The human-call escape hatch spec names but doesn't mechanize: "an
// objection → evaluators see it and the outcome waits on a human
// call, not the timer." Callable any time resolution is still
// pending, whether or not an objection was actually raised — a holder
// can also just decide not to wait out the window. Holder-gated, same
// authority as filing an Evaluation.
export async function resolveWiderDiscussionManually(
  actor: Member,
  formResponseId: string,
  input: ResolveWiderDiscussionInput,
) {
  await requireRecruitmentTaskHolder(actor);
  const decision = await getRecruitmentDecision(formResponseId);
  if (!decision || decision.ruleOutcome !== "wider_discussion") {
    throw new NotFoundError("No open wider-discussion decision for this application");
  }
  if (decision.resolution) {
    throw new ConflictError("This decision has already resolved");
  }

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ resolution: input.resolution })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();

  if (input.resolution === "accepted") {
    const communityRow = await getCommunityRow(actor.communityId);
    const converted = await maybeConvertApplicantToMember(communityRow, updated);
    const withTask = await maybeCreateAccompanimentTask(actor, communityRow, converted);
    return withTask ?? converted;
  }
  return updated;
}

// Scheduled job (see src/instrumentation.ts) — the actual write a
// closed wider-discussion window needs, unlike the purely-read
// computeWiderDiscussionStatus above. Skips any decision with a raised
// Objection: "an objection → evaluators see it and the outcome waits
// on a human call, not the timer" — resolveWiderDiscussionManually is
// that human call.
export async function resolveWiderDiscussionWindows() {
  const due = await db
    .select()
    .from(recruitmentDecision)
    .where(
      and(
        eq(recruitmentDecision.ruleOutcome, "wider_discussion"),
        isNull(recruitmentDecision.resolution),
        lt(recruitmentDecision.widerDiscussionDeadline, new Date()),
      ),
    );

  let resolved = 0;
  let accompanimentsCreated = 0;
  for (const decision of due) {
    const [objectionRow] = await db
      .select({ id: objection.id })
      .from(objection)
      .where(eq(objection.formResponseId, decision.formResponseId))
      .limit(1);
    if (objectionRow) continue;

    const resolution = decision.defaultResolution === "proceed" ? "accepted" : "declined";
    const [updated] = await db
      .update(recruitmentDecision)
      .set({ resolution })
      .where(eq(recruitmentDecision.id, decision.id))
      .returning();
    resolved++;

    if (resolution === "accepted") {
      const [formRow] = await db
        .select({ communityId: form.communityId })
        .from(formResponse)
        .innerJoin(form, eq(formResponse.formId, form.id))
        .where(eq(formResponse.id, decision.formResponseId));
      const communityRow = await getCommunityRow(formRow.communityId);
      // Conversion needs no acting Member (it's a pure record-creation
      // step, same as findOrCreateMemberByEmail), so this still runs
      // even if the recruitment task currently has no holder —
      // Accompaniment's own task creation genuinely does need a real
      // actor to create a Task as, so that part alone stays gated on
      // one existing.
      const converted = await maybeConvertApplicantToMember(communityRow, updated);
      const actorMember = await getRecruitmentTaskHolderMember(communityRow);
      if (actorMember) {
        const withTask = await maybeCreateAccompanimentTask(actorMember, communityRow, converted);
        if (withTask?.accompanimentTaskId) accompanimentsCreated++;
      }
    }
  }

  return { checked: due.length, resolved, accompanimentsCreated };
}

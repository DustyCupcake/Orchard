import { and, eq, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  communityInvite,
  form,
  formResponse,
  member,
  objection,
  recruitmentApplicationInvite,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
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

// Idempotent — accompanimentTaskId is the marker. suggestedMemberId
// pre-fills from the linked invite's own creator when the application
// referenced one (src/db/schema/recruitment.ts's
// recruitmentApplicationInvite) — "the same 'carry a shadow forward as
// a suggested next claimant' reasoning Phase 14 already established
// for succession, applied here to a referrer instead of a shadow"
// (docs/development-plan.md's Phase 34). This resolves a real gap
// dev-plan's own phrasing glosses over ("the new member's
// referredByMemberId") — nothing in Phases 32-35 actually converts an
// accepted applicant into a Member, so there's no Member row to read
// referredByMemberId off yet. The linked invite's creator is the same
// underlying fact (who vouched for this person) without needing that
// conversion to exist first.
async function maybeCreateAccompanimentTask(actor: Member, communityRow: CommunityRow, decision: RecruitmentDecisionRow) {
  if (decision.accompanimentTaskId) return null;
  if (!communityRow.recruitmentTaskId) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(eq(task.id, communityRow.recruitmentTaskId));
  if (!recruitmentTaskRow) return null;

  const [linked] = await db
    .select({ createdBy: communityInvite.createdBy })
    .from(recruitmentApplicationInvite)
    .innerJoin(communityInvite, eq(recruitmentApplicationInvite.communityInviteId, communityInvite.id))
    .where(eq(recruitmentApplicationInvite.formResponseId, decision.formResponseId));

  const created = await createTask(
    actor,
    {
      branchId: recruitmentTaskRow.branchId,
      title: "Accompany new member",
      description: `Accompany the new member accepted via the application submitted through /apply (id ${decision.formResponseId}) — see /applications for the full submission.`,
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
    },
    actor.id,
  );

  if (linked?.createdBy) {
    await db.update(task).set({ suggestedMemberId: linked.createdBy }).where(eq(task.id, created.id));
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
    const withTask = await maybeCreateAccompanimentTask(actor, communityRow, updated);
    return withTask ?? updated;
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
      const actorMember = await getRecruitmentTaskHolderMember(communityRow);
      if (actorMember) {
        const withTask = await maybeCreateAccompanimentTask(actorMember, communityRow, updated);
        if (withTask?.accompanimentTaskId) accompanimentsCreated++;
      }
    }
  }

  return { checked: due.length, resolved, accompanimentsCreated };
}

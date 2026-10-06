import { and, eq, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  communityInvite,
  form,
  formResponse,
  member,
  memberIdentity,
  memberLanguage,
  evaluation,
  objection,
  profileQuestion,
  recruitmentApplicationInvite,
  recruitmentDecision,
  task,
  taskAssignment,
} from "@/db/schema";
import type { community as communityTable, member as memberTable } from "@/db/schema";
import type { FormField } from "../forms";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { createTask } from "../tasks";
import { createPoll } from "../scheduling-polls";
import { generateToken } from "../token";
import { seedPrimaryContactMethod } from "../contact-methods";
import { getCommunityRow, requireRecruitmentScopeForCycle, requireRecruitmentTaskHolder } from "./access";
import { computeRecruitmentOutcome } from "./evaluations";
import { canScheduleInterview } from "./joining";
import { listGrantingTaskIds } from "../permissions";
import { answerProfileQuestion } from "../profile-questions";
import { seedCycleParticipation } from "../participation";

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
// Not an authority question: the scheduled auto-resolution job needs a real
// actor to create the Accompaniment Task *as*, since a Task needs a real
// creator. The holder of the granting task was the obvious stand-in, which
// was fine while the module was necessarily granted — but an open module may
// have no granting task at all, and the job still has to run. Hence the
// fallback chain (docs/open-permissions-plan.md §4.2): the converted member's
// referrer (a real person with a real stake in this applicant), then the
// earliest-claimed evaluator, and only then give up. Never a random member —
// the Accompaniment task is visible, and its creator is part of the record.
async function getRecruitmentTaskHolderMember(communityRow: CommunityRow): Promise<Member | null> {
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [holding] = await db
    .select({ memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(inArray(taskAssignment.taskId, grantingTaskIds), eq(taskAssignment.isShadow, false)))
    .orderBy(taskAssignment.claimedAt)
    .limit(1);
  if (!holding) return null;
  const [holder] = await db.select().from(member).where(eq(member.id, holding.memberId));
  return holder ?? null;
}

// The author's own fallback, for the open-with-no-granting-task case: the
// converted member's referrer, else the earliest evaluator who filed on this
// application. Returns null when there is genuinely nobody to be.
async function resolveAccompanimentAuthor(
  communityRow: CommunityRow,
  decision: RecruitmentDecisionRow,
): Promise<Member | null> {
  if (decision.convertedMemberId) {
    const [converted] = await db.select().from(member).where(eq(member.id, decision.convertedMemberId));
    const referrerId = converted?.referredByMemberId;
    if (referrerId) {
      const [referrer] = await db.select().from(member).where(eq(member.id, referrerId));
      if (referrer) return referrer;
    }
  }

  const [earliestEvaluation] = await db
    .select({ evaluatorId: evaluation.evaluatorId })
    .from(evaluation)
    .where(eq(evaluation.formResponseId, decision.formResponseId))
    .orderBy(evaluation.filedAt)
    .limit(1);
  if (!earliestEvaluation) return null;

  const [evaluator] = await db.select().from(member).where(eq(member.id, earliestEvaluation.evaluatorId));
  return evaluator ?? null;
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
//
// Returns null when no task grants Recruitment, because the Poll's branchId
// comes from that task and there is nowhere else to file it: a member has no
// branch column, and a cycle has none either. That was a pre-existing
// degradation for the never-granted case, but an open module makes it
// reachable *deliberately* — so it is reported rather than papered over (see
// RecruitmentAuthority.needsTaskToFileUnder), and picking an arbitrary
// branch is deliberately avoided: a real Poll under an unrelated branch is
// worse than a visible gap. The decision itself is already recorded by
// recordDecisionIfReached before this is called.
async function createIntroCallPoll(
  actor: Member,
  communityRow: CommunityRow,
  formResponseId: string,
  evaluatorIds: string[],
) {
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(inArray(task.id, grantingTaskIds));
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

  // Read up here, alongside the name/email fields, so the "this form can
  // produce a person" precondition and the "this form also knows their
  // languages" question are answered from the same array. Optional by
  // design: a form that never asks about languages still converts.
  const languageField = fields.find((f) => f.isLanguageField);

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
        // Unverified: this address came out of an application form, and
        // nobody has received anything at it yet. Same reasoning as the
        // invite path — the row exists so the member has somewhere to log
        // in from, not as an assertion that they own the inbox.
        await seedPrimaryContactMethod(tx, newMember.id, rawEmail, { verified: false });
        return newMember.id;
      });

  // Fields tagged mapsToProfileQuestionId (src/lib/forms.ts) seed a
  // real ProfileAnswer directly from this same application answer, so
  // the new member isn't asked to retype a fact they already gave —
  // see docs/spec.md's Profile questions ("the same still-unanswered
  // questions just surface the next time a relevant surface checks
  // what's outstanding"), applied here to a surface (the application)
  // that never became a real `surfaces` consumer. Best-effort: a blank
  // answer, a shape mismatch (e.g. the applicant's text doesn't match
  // one of a since-changed single_choice question's options), or a
  // since-archived question just doesn't prefill rather than blocking
  // conversion — the member can always answer it directly afterward.
  const mappedFields = fields.filter((f) => f.mapsToProfileQuestionId);
  if (mappedFields.length > 0) {
    const [memberRow] = await db.select().from(member).where(eq(member.id, memberId));
    if (memberRow) {
      for (const field of mappedFields) {
        const rawValue = values[field.key];
        if (rawValue === undefined || rawValue === null || rawValue === "") continue;
        // A form saved before sensitive questions were refused as mapping
        // targets (src/lib/forms.ts) may still point at one. The answer is
        // dropped rather than saved: answerProfileQuestion would share it
        // with the question's whole audience, which the applicant was
        // never shown. They are asked at onboarding like anyone else.
        const [mappedQuestion] = await db
          .select({ sensitive: profileQuestion.sensitive })
          .from(profileQuestion)
          .where(eq(profileQuestion.id, field.mapsToProfileQuestionId!));
        if (mappedQuestion?.sensitive) continue;
        try {
          await answerProfileQuestion(memberRow, field.mapsToProfileQuestionId!, {
            status: "answered",
            value: rawValue,
          });
        } catch {
          // best-effort — see comment above
        }
      }
    }
  }

  // A form field tagged isLanguageField seeds real `member_language` rows,
  // for the same reason the mapped questions above do: this applicant has
  // already said this, and a first-login screen that asks again is a form
  // asking twice.
  //
  // `member_language` is repeatable where a ProfileQuestion holds one
  // value, which is why this needed its own tag rather than riding
  // mapsToProfileQuestionId — the starter set's "Languages you speak" is
  // a single free-text blob and a Requirement's language check queries
  // structured rows, so a blob would never satisfy one. Split on commas
  // and newlines because that is what someone writes in one box, and drop
  // anything empty so "Spanish, " doesn't create a blank row that then
  // matches nothing while looking like an entry on /profile.
  //
  // Every row lands at `conversational` because the form asked one
  // question, not five: the level is a claim about someone's ability, and
  // a community that wants to distinguish fluent from native needs a
  // form that actually asks. Deduped case-insensitively against what the
  // member already has, because conversion can run against a Member who
  // logged in and set their own languages before the decision was filed.
  if (languageField) {
    const rawValue = values[languageField.key];
    if (typeof rawValue === "string") {
      const spoken = rawValue
        .split(/[,\n]/)
        .map((part) => part.trim())
        .filter(Boolean);
      if (spoken.length > 0) {
        const existingLanguages = await db
          .select({ language: memberLanguage.language })
          .from(memberLanguage)
          .where(eq(memberLanguage.memberId, memberId));
        const seen = new Set(existingLanguages.map((l) => l.language.trim().toLowerCase()));
        for (const language of spoken) {
          const key = language.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          await db.insert(memberLanguage).values({ memberId, language, level: "conversational" });
        }
      }
    }
  }

  // §4.3/8d (D14) / J12: accepting a cycle-keyed application seeds the
  // new member's participation in that cycle — "coming", idempotently —
  // so they count against the cycle's capacity from day one.
  await seedCycleParticipation(db, responseRow.cycleId, memberId);

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
  // Same branchId dependency as createIntroCallPoll, and the same reasoning:
  // a Task cannot be created without a branchId, and an open module with no
  // granting task has none to borrow. Reported, not guessed.
  const grantingTaskIds = await listGrantingTaskIds(communityRow.id, "recruitment");
  if (grantingTaskIds.length === 0) return null;
  const [recruitmentTaskRow] = await db.select().from(task).where(inArray(task.id, grantingTaskIds));
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

// The write half of an acceptance, split out of recordDecisionIfReached
// so that src/lib/recruitment/mediation.ts can reuse it: an objection
// that the body *clears* admits the applicant exactly the way a `proceed`
// rule does, and re-implementing the conversion + accompaniment steps
// there would be how the two paths started disagreeing about what
// "accepted" means. Idempotent at both steps (convertedMemberId and
// accompanimentTaskId are the markers), so calling it on an already-
// accepted decision is a no-op rather than a double conversion.
export async function applyAcceptanceSideEffects(
  actor: Member,
  communityRow: CommunityRow,
  decision: RecruitmentDecisionRow,
) {
  const converted = await maybeConvertApplicantToMember(communityRow, decision);
  const withTask = await maybeCreateAccompanimentTask(actor, communityRow, converted);
  return withTask ?? converted;
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
  // schedule the intro call; decline never does. Unless the third door
  // says otherwise: §2.3/J3 made the interview stage independently
  // toggleable, so a community (or an event) with interviews closed gets
  // no poll at all rather than a promise it didn't make. The decision
  // still records, and the pipeline's stage computation already treats a
  // decision with no poll as `call_pending`, so the applicant is visible
  // as waiting rather than as finished.
  if (result.outcome !== "decline") {
    const [responseRow] = await db
      .select({ cycleId: formResponse.cycleId })
      .from(formResponse)
      .where(eq(formResponse.id, formResponseId));
    if (await canScheduleInterview(actor.communityId, responseRow?.cycleId ?? null)) {
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
  }

  if (resolution === "accepted") {
    const converted = await maybeConvertApplicantToMember(communityRow, decisionRow);
    const updated = await maybeCreateAccompanimentTask(actor, communityRow, converted);
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
// call, not the timer." Callable any time resolution is still pending —
// but §2.6/J7 closed the loophole this used to have, which is the whole
// point of the redesign: a recruitment holder can no longer resolve a
// window that has a standing objection on it. The plan says that
// decision belongs to the mediation body ("the objection is never
// thrown out... it stands"), and this is where that promise is enforced
// rather than stated. A window with no objection is still a holder's to
// resolve — they can decline to wait out the clock, which is a decision
// about *timing*, not about overriding anybody's concern.
export async function resolveWiderDiscussionManually(
  actor: Member,
  formResponseId: string,
  input: ResolveWiderDiscussionInput,
) {
  await requireRecruitmentTaskHolder(actor);
  const [responseRow] = await db
    .select({ cycleId: formResponse.cycleId })
    .from(formResponse)
    .where(eq(formResponse.id, formResponseId));
  if (!responseRow) {
    throw new NotFoundError("Application not found");
  }
  // Deciding, like evaluating, is scoped to the holder's placement
  // (§4.3): a cycle-placed recorder only resolves their own cycle's
  // applications.
  await requireRecruitmentScopeForCycle(actor, responseRow.cycleId);
  const decision = await getRecruitmentDecision(formResponseId);
  if (!decision || decision.ruleOutcome !== "wider_discussion") {
    throw new NotFoundError("No open wider-discussion decision for this application");
  }
  if (decision.resolution) {
    throw new ConflictError("This decision has already resolved");
  }

  const [standing] = await db
    .select({ id: objection.id })
    .from(objection)
    .where(
      and(
        eq(objection.formResponseId, formResponseId),
        eq(objection.resolution, "standing"),
      ),
    )
    .limit(1);
  if (standing) {
    throw new ForbiddenError(
      "Someone has raised a concern about this arrival, and it isn't yours to wave through — the mediation team has to talk it through first",
    );
  }

  const [updated] = await db
    .update(recruitmentDecision)
    .set({ resolution: input.resolution })
    .where(eq(recruitmentDecision.id, decision.id))
    .returning();

  if (input.resolution === "accepted") {
    const communityRow = await getCommunityRow(actor.communityId);
    return applyAcceptanceSideEffects(actor, communityRow, updated);
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
      .where(
        and(
          eq(objection.formResponseId, decision.formResponseId),
          // §2.6/J7: only a *standing* objection holds the window. One
          // the body has already settled is history, and letting a
          // settled objection keep blocking the arrival would re-create
          // the veto-by-inaction this whole redesign is about.
          eq(objection.resolution, "standing"),
        ),
      )
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
      // The job needs a real actor to create a Task as, so it resolves one:
      // the recruitment task's holder when there is a granting task, else the
      // fallback chain (the converted member's referrer, then the earliest
      // evaluator). Without the second path an open module with no granting
      // task would resolve wider-discussion windows but never create the
      // Accompaniment task that resolution is supposed to produce.
      const actorMember =
        (await getRecruitmentTaskHolderMember(communityRow)) ??
        (await resolveAccompanimentAuthor(communityRow, converted));
      if (actorMember) {
        const withTask = await applyAcceptanceSideEffects(actorMember, communityRow, converted);
        if (withTask?.accompanimentTaskId) accompanimentsCreated++;
      }
    }
  }

  return { checked: due.length, resolved, accompanimentsCreated };
}

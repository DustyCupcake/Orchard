"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { respondToNomination, respondToNominationInput } from "@/lib/tasks";
import { completeOnboarding } from "@/lib/onboarding";
import { answerProfileQuestion, getProfileQuestion, listProfileQuestionsByIds } from "@/lib/profile-questions";
import { fieldValueFromFormData, toFieldShape } from "@/lib/field-shape";
import { listOutstandingQuestions } from "@/lib/profile-questions/answers";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { upsertMemberAxisValue } from "@/lib/trait-axes";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/dashboard?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/dashboard?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// The in-app mirror of the emailed one-click links — see
// src/lib/tasks/nominations.ts and src/app/api/task-nominations/respond/route.ts.

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export async function respondToNominationAction(formData: FormData) {
  const actor = await requireMember();
  const nominationId = String(formData.get("nominationId"));

  try {
    const input = respondToNominationInput.parse({ response: String(formData.get("response") ?? "") });
    await respondToNomination(actor, nominationId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/dashboard");
  revalidatePath("/board");
}

// docs/development-plan.md's Phase 56 — "skipping is always available,
// a nudge, never a gate": finishing the tutorial/suggestions sequence
// and explicitly skipping it both just clear the same flag, same
// "one flag, no separate completed-vs-skipped state" the dev plan
// itself describes.
export async function completeOnboardingAction() {
  const actor = await requireMember();
  await completeOnboarding(actor);
  revalidatePath("/dashboard");
}

// The one-click declare-joining control on this page's event cards and
// coming ribbon (src/components/EventParticipation.tsx). Status only —
// arrival/departure dates and the note stay on /participation's own full
// form, which this never overwrites (declareParticipation treats an
// omitted field as "leave it alone").
//
// After recording, this checks whether the event has questions of its own
// still unanswered and hands the member straight to them, rather than
// leaving required information to be collected by the sidebar badge and
// the shell banner alone. The Dashboard is where the whole flow starts,
// so this is the only place the "declare, then answer" pairing exists.
export async function declareEventStatusAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));

  let eventQuestions = 0;
  try {
    const input = declareParticipationInput.parse({
      status: String(formData.get("status") ?? "unknown"),
    });
    await declareParticipation(actor, cycleId, input);

    // Only event-scoped questions — the once-ever ones are that member's
    // own standing facts and shouldn't hijack the flow they just started.
    eventQuestions = (await listOutstandingQuestions(actor, { cycleId })).filter(
      (q) => q.question.scope !== "once_ever",
    ).length;
  } catch (err) {
    redirectWithError(err);
  }

  // The declaration moves the participant count the cards and the
  // Community snapshot both render, and (for a first declaration) the
  // nav switcher's own "coming to" aggregate — hence the layout-wide
  // revalidate.
  revalidatePath("/dashboard");
  revalidatePath("/community");
  revalidatePath("/participation");
  revalidatePath("/", "layout");

  // Redirecting only after the revalidations, and outside the try, so
  // this isn't caught by its own error handling on the way out.
  if (eventQuestions > 0) {
    redirect(`/questions?cycle=${encodeURIComponent(cycleId)}`);
  }
}

// The onboarding panel's own answer form — a thin mirror of
// /profile's submitProfileAnswerAction, kept as its own action (rather
// than imported cross-page) so it revalidates /dashboard, not /profile,
// matching every other page's actions.ts owning its own revalidation.
export async function submitOnboardingAnswerAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));
  const status = String(formData.get("status")) === "deferred" ? "deferred" : "answered";
  // No "declined" here: this panel is the first-week onboarding flow, and
  // a member declining an onboarding question still needs to get through
  // it, so the option isn't offered on this surface at all. The same
  // reasoning applies to /profile's "Your answers" editor. Only /questions
  // — where the question is actually being asked of you — offers it.
  //
  // The row is read only to interpret the submitted inputs — see
  // fieldValueFromFormData, the same read the Form path uses.
  const question = await getProfileQuestion(actor, questionId);
  const value = fieldValueFromFormData(toFieldShape(question), formData, "value");

  try {
    await answerProfileQuestion(actor, questionId, {
      status,
      value: status === "answered" ? value : undefined,
    });
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/dashboard");
}

// The onboarding panel's trait-axis form — one axis per submit, same
// small-form-per-item shape as submitOnboardingAnswerAction above.
export async function submitOnboardingAxisAction(formData: FormData) {
  const actor = await requireMember();
  const axisId = String(formData.get("axisId"));
  const value = Number(formData.get("value"));

  try {
    await upsertMemberAxisValue(actor, axisId, value);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/dashboard");
  revalidatePath("/profile");
}

// PrefilledAnswersReview.tsx's own "Apply" step — several once-ever
// answers reviewed together as one confirmation, unlike every other
// profile-question form here which is deliberately one question per
// submit (ProfileQuestion is always independently answerable per
// spec). This bundles the submit only because the review UI presents
// them together; each answer is still validated and written
// individually via answerProfileQuestion, same as anywhere else. Each
// reviewed question contributes its own "questionId" hidden input, so
// formData.getAll recovers exactly the set the member was shown.
export async function submitOnboardingPrefilledAnswersAction(formData: FormData) {
  const actor = await requireMember();
  const questionIds = formData.getAll("questionId").map(String);

  try {
    // The shapes are read up front so each field's submission can be
    // interpreted the same way a single-question form's is — a
    // multi_choice submits several values under one name, and a choice
    // field with an escape hatch has a second sibling input.
    const rows = await listProfileQuestionsByIds(actor, questionIds);
    const shapeById = new Map(rows.map((r) => [r.id, toFieldShape(r)]));
    for (const questionId of questionIds) {
      const shape = shapeById.get(questionId);
      // A stale id in a form the member submitted means that question is
      // no longer answerable; answerProfileQuestion's own lookup would
      // reject it, and there's nothing to write.
      if (!shape) continue;
      const value = fieldValueFromFormData(shape, formData, `value_${questionId}`);
      await answerProfileQuestion(actor, questionId, { status: "answered", value });
    }
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/dashboard");
  revalidatePath("/profile");
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { respondToNomination, respondToNominationInput } from "@/lib/tasks";
import { completeOnboarding } from "@/lib/onboarding";
import { answerProfileQuestion } from "@/lib/profile-questions";
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

// The onboarding panel's own answer form — a thin mirror of
// /profile's submitProfileAnswerAction, kept as its own action (rather
// than imported cross-page) so it revalidates /dashboard, not /profile,
// matching every other page's actions.ts owning its own revalidation.
export async function submitOnboardingAnswerAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));
  const status = String(formData.get("status")) === "deferred" ? "deferred" : "answered";
  const multi = formData.getAll("value_multi").map(String);
  const single = formData.get("value");
  const value = multi.length > 0 ? multi : (single ?? "");

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

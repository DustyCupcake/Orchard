"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  raiseObjection,
  raiseObjectionInput,
  recordDecisionIfReached,
  resolveWiderDiscussionInput,
  resolveWiderDiscussionManually,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitEvaluationInput,
} from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/applications?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/applications?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function setRecruitmentSubscriptionAction(formData: FormData) {
  const actor = await requireMember();
  const active = formData.get("active") === "true";

  try {
    await setRecruitmentSubscriptionActive(actor, active);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect(active ? "/applications?subscribed=1" : "/applications?unsubscribed=1");
}

// Holder-gated, enforced inside submitEvaluation. recordDecisionIfReached
// is idempotent (a no-op once a decision already exists for this
// application) so it's safe to call after every evaluation, not just
// the one that happens to complete the threshold.
export async function submitEvaluationAction(formData: FormData) {
  const actor = await requireMember();
  const formResponseId = String(formData.get("formResponseId"));

  try {
    const input = submitEvaluationInput.parse({
      recommendation: String(formData.get("recommendation") ?? ""),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await submitEvaluation(actor, formResponseId, input);
    await recordDecisionIfReached(actor, formResponseId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect("/applications?evaluated=1");
}

// Subscriber-gated, enforced inside raiseObjection.
export async function raiseObjectionAction(formData: FormData) {
  const actor = await requireMember();
  const formResponseId = String(formData.get("formResponseId"));

  try {
    const input = raiseObjectionInput.parse({ note: String(formData.get("note") ?? "").trim() });
    await raiseObjection(actor, formResponseId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect("/applications?objectionRaised=1");
}

// Holder-gated, enforced inside resolveWiderDiscussionManually — the
// human-call escape hatch for an objected (or simply not worth
// waiting out) wider-discussion window.
export async function resolveWiderDiscussionAction(formData: FormData) {
  const actor = await requireMember();
  const formResponseId = String(formData.get("formResponseId"));

  try {
    const input = resolveWiderDiscussionInput.parse({ resolution: String(formData.get("resolution") ?? "") });
    await resolveWiderDiscussionManually(actor, formResponseId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect("/applications?decisionResolved=1");
}

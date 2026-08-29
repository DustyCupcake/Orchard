"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { setRecruitmentSubscriptionActive, submitEvaluation, submitEvaluationInput } from "@/lib/recruitment";
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

// Holder-gated, enforced inside submitEvaluation.
export async function submitEvaluationAction(formData: FormData) {
  const actor = await requireMember();
  const formResponseId = String(formData.get("formResponseId"));

  try {
    const input = submitEvaluationInput.parse({
      recommendation: String(formData.get("recommendation") ?? ""),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await submitEvaluation(actor, formResponseId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect("/applications?evaluated=1");
}

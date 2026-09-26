"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { getQuestionForShape, submitQuestionResponse } from "@/lib/input-rounds";
import { fieldValueFromFormData, toFieldShape } from "@/lib/field-shape";
import { AppError } from "@/lib/errors";

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

export async function submitQuestionResponseAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));

  // Read against the question's own shape, the same way every other
  // question system does it — a multi_choice submits several values
  // under one name, and a choice with an escape hatch has a second
  // sibling input. Was the old "value_multi vs value" pair, which
  // couldn't express the new types at all.
  const question = await getQuestionForShape(actor, questionId);
  const value = fieldValueFromFormData(toFieldShape(question), formData, "value");

  try {
    await submitQuestionResponse(actor, questionId, { value });
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/input-rounds?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/input-rounds?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  revalidatePath("/input-rounds");
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { submitQuestionResponse } from "@/lib/input-rounds";
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
  const multi = formData.getAll("value_multi").map(String);
  const single = formData.get("value");
  const value = multi.length > 0 ? multi : (single ?? "");

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

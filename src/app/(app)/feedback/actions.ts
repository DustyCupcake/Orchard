"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { getPostCycleFeedbackForm, submitFormResponseInput, submitPostCycleFeedback } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
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

export async function submitFeedbackAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const form = await getPostCycleFeedbackForm(actor);
    if (!form) {
      throw new AppError("No post-cycle feedback form is configured for this Community yet");
    }

    const fields = form.fields as FormField[];
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.responseType === "multi_choice") {
        values[f.key] = formData.getAll(`field_${f.key}`).map(String);
      } else {
        values[f.key] = String(formData.get(`field_${f.key}`) ?? "");
      }
    }

    const input = submitFormResponseInput.parse({
      values,
      anonymous: formData.get("anonymous") === "on",
    });
    await submitPostCycleFeedback(actor, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/feedback?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/feedback?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  revalidatePath("/feedback");
  redirect("/feedback?submitted=1");
}

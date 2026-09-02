"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { getPostCycleFeedbackForm, submitFormResponseInput, submitPostCycleFeedback } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";

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

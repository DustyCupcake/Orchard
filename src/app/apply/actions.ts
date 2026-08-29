"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { getOrCreateCommunity } from "@/lib/community";
import {
  getRecruitmentApplicationFormPublic,
  submitRecruitmentApplication,
  submitRecruitmentApplicationInput,
} from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";

export async function submitApplicationAction(formData: FormData) {
  const community = await getOrCreateCommunity();

  try {
    const form = await getRecruitmentApplicationFormPublic(community.id);
    if (!form) {
      throw new AppError("No application form is configured for this Community yet");
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

    const input = submitRecruitmentApplicationInput.parse({
      values,
      inviteToken: String(formData.get("inviteToken") ?? "").trim() || null,
    });
    await submitRecruitmentApplication(community.id, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/apply?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/apply?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/apply?submitted=1");
}

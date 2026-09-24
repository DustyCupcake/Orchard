"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { getOrCreateCommunity } from "@/lib/community";
import {
  requireApplicationDoorOpen,
  resolvePublicApplicationForm,
  submitRecruitmentApplication,
  submitRecruitmentApplicationInput,
} from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";

export async function submitApplicationAction(formData: FormData) {
  const community = await getOrCreateCommunity();
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const inviteToken = String(formData.get("inviteToken") ?? "").trim() || null;

  // Keep the context on any redirect — a cycle-targeted landing should
  // come back to (and show the result on) the same cycle.
  const back = new URLSearchParams();
  if (cycleId) back.set("cycle", cycleId);
  if (inviteToken) back.set("invite", inviteToken);

  try {
    // Resolve the form + door for the targeted surface, then enforce
    // the door so a shut or unconfigured one produces a clean message
    // here (submitRecruitmentApplication below re-checks it anyway).
    const resolution = await resolvePublicApplicationForm(community.id, cycleId);
    requireApplicationDoorOpen(resolution);
    if (!resolution.form) {
      throw new AppError("No application form is configured yet");
    }

    const fields = resolution.form.fields as FormField[];
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
      inviteToken,
      cycleId,
    });
    await submitRecruitmentApplication(community.id, input);
  } catch (err) {
    if (err instanceof ZodError) {
      back.set("error", err.issues[0]?.message ?? "Invalid input");
      redirect(`/apply?${back.toString()}`);
    }
    if (err instanceof AppError) {
      back.set("error", err.message);
      redirect(`/apply?${back.toString()}`);
    }
    throw err;
  }

  back.set("submitted", "1");
  redirect(`/apply?${back.toString()}`);
}
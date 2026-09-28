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
import { getNominationForApplication } from "@/lib/recruitment/support";
import { formValuesFromFormData, type FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";

export async function submitApplicationAction(formData: FormData) {
  const community = await getOrCreateCommunity();
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const inviteToken = String(formData.get("inviteToken") ?? "").trim() || null;
  const pairingToken = String(formData.get("pairingToken") ?? "").trim() || null;
  const consentAccepted = formData.get("consentAccepted") === "on";
  const disclosure = String(formData.get("disclosure") ?? "").trim() || undefined;

  // Keep the context on any redirect — a cycle-targeted landing should
  // come back to (and show the result on) the same cycle, and a pairing
  // link has to survive the round trip or the applicant is silently
  // applying unpaired.
  const back = new URLSearchParams();
  if (cycleId) back.set("cycle", cycleId);
  if (inviteToken) back.set("invite", inviteToken);
  if (pairingToken) back.set("pair", pairingToken);

  let responseId: string | null = null;
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
    const values = formValuesFromFormData(fields, formData);

    const input = submitRecruitmentApplicationInput.parse({
      values,
      inviteToken,
      cycleId,
      pairingToken,
      consentAccepted,
      disclosure,
    });
    const created = await submitRecruitmentApplication(community.id, input);
    responseId = created?.id ?? null;
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
  // §2.4 — a nomination lane opened a support window as part of this
  // submission, so hand the token to the page and let it show the link.
  // Losing it here would mean the "here's your support link" follow-up
  // only ever worked for people who had it in a URL already.
  if (responseId) {
    const nomination = await getNominationForApplication(responseId);
    if (nomination) {
      back.set("supportToken", nomination.supportToken);
    }
  }
  redirect(`/apply?${back.toString()}`);
}

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
import { formValuesFromFormData, type FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";

export async function submitApplicationAction(formData: FormData) {
  const community = await getOrCreateCommunity();
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const inviteToken = String(formData.get("inviteToken") ?? "").trim() || null;
  const pairingToken = String(formData.get("pairingToken") ?? "").trim() || null;
  const publicSlug = String(formData.get("publicSlug") ?? "").trim() || null;
  const consentAccepted = formData.get("consentAccepted") === "on";
  const disclosure = String(formData.get("disclosure") ?? "").trim() || undefined;

  // Keep the context on any redirect — an event landing should come back to
  // the same event, and a pairing link has to survive the round trip or the
  // applicant is silently applying unpaired.
  const back = new URLSearchParams();
  if (cycleId) back.set("cycle", cycleId);
  if (inviteToken) back.set("invite", inviteToken);
  if (pairingToken) back.set("pair", pairingToken);
  const backPath = publicSlug ? `/apply/${encodeURIComponent(publicSlug)}` : "/apply";

  let arrivalToken: string;
  try {
    // Resolve the form + door for the targeted surface, then enforce the door
    // so a shut or unconfigured one produces a clean message here
    // (submitRecruitmentApplication below re-checks it anyway).
    const resolution = await resolvePublicApplicationForm(community.id, cycleId);
    requireApplicationDoorOpen(resolution);
    if (!resolution.form) {
      throw new AppError("No application form is configured yet");
    }

    const values = formValuesFromFormData(resolution.form.fields as FormField[], formData);
    const input = submitRecruitmentApplicationInput.parse({
      values,
      inviteToken,
      cycleId,
      publicSlug,
      pairingToken,
      consentAccepted,
      disclosure,
    });
    ({ token: arrivalToken } = await submitRecruitmentApplication(community.id, input));
  } catch (err) {
    if (err instanceof ZodError) {
      back.set("error", err.issues[0]?.message ?? "Invalid input");
      redirect(`${backPath}?${back.toString()}`);
    }
    if (err instanceof AppError) {
      back.set("error", err.message);
      redirect(`${backPath}?${back.toString()}`);
    }
    throw err;
  }

  // Their private page: the one place they can see where things are. The
  // same link is emailed to them.
  redirect(`/admission/${arrivalToken}`);
}

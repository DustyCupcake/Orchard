"use server";

import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getCurrentMember } from "@/lib/session";
import { activateEmergencyAccess, addEmergencyAccessExplanation } from "@/lib/emergency-access";
import { AppError } from "@/lib/errors";

function redirectWithError(targetId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/members/${targetId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/members/${targetId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Any member can activate; the log is the accountability trail. Redirects
// with a plain `activated=1` marker (never the actual contact values —
// see the page's own comment for why) — the page re-derives what to show
// from a fresh, gated DB read.
export async function activateEmergencyAccessAction(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const targetMemberId = String(formData.get("targetMemberId"));
  const explanation = String(formData.get("explanation") ?? "").trim() || undefined;
  try {
    await activateEmergencyAccess(current, targetMemberId, explanation);
  } catch (err) {
    redirectWithError(targetMemberId, err);
  }
  redirect(`/members/${targetMemberId}?activated=1`);
}

export async function addEmergencyAccessExplanationAction(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const targetMemberId = String(formData.get("targetMemberId"));
  const logId = String(formData.get("logId"));
  const explanation = String(formData.get("explanation") ?? "").trim();
  try {
    await addEmergencyAccessExplanation(current, logId, explanation);
  } catch (err) {
    redirectWithError(targetMemberId, err);
  }
  redirect(`/members/${targetMemberId}?activated=1`);
}

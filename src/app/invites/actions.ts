"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  claimInquiry,
  createCommunityInvite,
  createCommunityInviteInput,
  resolveInquiry,
  revokeCommunityInvite,
} from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/invites?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/invites?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function createCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const input = createCommunityInviteInput.parse({
      label: String(formData.get("label") ?? "").trim() || null,
      inviterThinksGoodFit: formData.get("inviterThinksGoodFit") === "on",
      inviterKnowsPersonally: formData.get("inviterKnowsPersonally") === "on",
      expiresAt: String(formData.get("expiresAt") ?? "").trim()
        ? new Date(String(formData.get("expiresAt"))).toISOString()
        : null,
    });
    await createCommunityInvite(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?created=1");
}

export async function revokeCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();
  const inviteId = String(formData.get("inviteId"));

  try {
    await revokeCommunityInvite(actor, inviteId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?revoked=1");
}

// Recruitment-task-holder-gated, enforced inside claimInquiry.
export async function claimInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await claimInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?claimed=1");
}

export async function resolveInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await resolveInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?inquiryResolved=1");
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { activateProposal, activateProposalInput, declineProposal } from "@/lib/proposals";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/proposals?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/proposals?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function activateProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  const effort = String(formData.get("effort"));
  const duration = String(formData.get("duration") ?? "");
  const hoursPerWeekRaw = String(formData.get("hoursPerWeek") ?? "");
  const effortMagnitude =
    effort === "one_off"
      ? { duration: duration || "few_hours" }
      : { hours_per_week: Number(hoursPerWeekRaw) || 1 };

  const capacityRaw = String(formData.get("capacity") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "");
  const tagsRaw = String(formData.get("tags") ?? "");
  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const endorsementThresholdRaw = String(formData.get("endorsementThreshold") ?? "");
  const browsePeriodEndRaw = String(formData.get("browsePeriodEnd") ?? "");

  try {
    const input = activateProposalInput.parse({
      branchId: String(formData.get("branchId")),
      effort,
      effortMagnitude,
      capacity: capacityRaw ? Number(capacityRaw) : undefined,
      critical: formData.get("critical") === "on",
      title: title || undefined,
      description: description || undefined,
      tags: tags.length > 0 ? tags : undefined,
      openness: String(formData.get("openness") ?? "request"),
      endorsementThreshold: endorsementThresholdRaw ? Number(endorsementThresholdRaw) : undefined,
      browsePeriodEnd: browsePeriodEndRaw ? new Date(browsePeriodEndRaw).toISOString() : undefined,
    });
    await activateProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/proposals");
  revalidatePath("/board");
}

export async function declineProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));
  const reason = String(formData.get("reason") ?? "") || undefined;

  try {
    await declineProposal(actor, proposalId, reason);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/proposals");
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { updateCycleSettings, updateCycleSettingsInput } from "@/lib/cycles";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/participation?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/participation?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function declareParticipationAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));

  try {
    const input = declareParticipationInput.parse({
      status: String(formData.get("status") ?? "unknown"),
      arrivalDate: String(formData.get("arrivalDate") ?? "").trim() || null,
      departureDate: String(formData.get("departureDate") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
    });
    await declareParticipation(actor, cycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/participation");
  redirect("/participation?declared=1");
}

// Cycle-initiation-eligibility-gated, enforced inside updateCycleSettings.
export async function updateCycleSettingsAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const windowRaw = String(formData.get("returningWindowClosesAt") ?? "").trim();

  try {
    const input = updateCycleSettingsInput.parse({
      capacity: capacityRaw ? Number(capacityRaw) : null,
      returningWindowClosesAt: windowRaw ? new Date(windowRaw).toISOString() : null,
    });
    await updateCycleSettings(actor, cycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/participation");
  redirect("/participation?settingsUpdated=1");
}

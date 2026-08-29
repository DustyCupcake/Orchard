"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { upsertMySpacePreference, upsertSpacePreferenceInput } from "@/lib/spatial-planning";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/spatial-planning?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/spatial-planning?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Self-service — see docs/spec.md's Space preferences. A plain Server
// Action form, not part of the client PlotEditor component: unlike
// drawing/editing a Placement, this needs no drag interaction, so it
// stays consistent with the rest of this codebase's server-action-
// first posture rather than growing the one client component further.
export async function upsertSpacePreferenceAction(formData: FormData) {
  const actor = await requireMember();

  const groupWithRaw = String(formData.get("groupWith") ?? "").trim();
  const sharingWithRaw = String(formData.get("sharingWith") ?? "").trim();
  const lengthRaw = String(formData.get("vehicleLength") ?? "").trim();
  const widthRaw = String(formData.get("vehicleWidth") ?? "").trim();
  const heightRaw = String(formData.get("vehicleHeight") ?? "").trim();

  try {
    const input = upsertSpacePreferenceInput.parse({
      sleepArrangement: String(formData.get("sleepArrangement") ?? "solo_tent"),
      vehicleDimensions:
        lengthRaw && widthRaw && heightRaw
          ? { length: Number(lengthRaw), width: Number(widthRaw), height: Number(heightRaw) }
          : null,
      groupWith: groupWithRaw ? groupWithRaw.split(",").map((s) => s.trim()) : null,
      sharingWith: sharingWithRaw ? sharingWithRaw.split(",").map((s) => s.trim()) : null,
      accessibilityNotes: String(formData.get("accessibilityNotes") ?? "").trim() || null,
    });
    await upsertMySpacePreference(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/spatial-planning");
}

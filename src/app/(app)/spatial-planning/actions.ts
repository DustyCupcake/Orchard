"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  acceptPlacementInvite,
  acknowledgeRevertNotice,
  declinePlacementInvite,
  upsertMySpacePreference,
  upsertSpacePreferenceInput,
} from "@/lib/spatial-planning";
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

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

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

// Plain Server Action forms for the three Phase 38 yes/no actions that
// need no drag interaction — accept/decline an invite, acknowledge a
// revert notice — same "stays out of the client canvas" reasoning as
// Space preferences above. Approve/revert stay in PlotEditor.tsx
// itself, since the holder genuinely benefits from seeing the moved
// geometry on the canvas before deciding.

export async function acceptPlacementInviteAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await acceptPlacementInvite(actor, String(formData.get("placementId")));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/spatial-planning");
}

export async function declinePlacementInviteAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await declinePlacementInvite(actor, String(formData.get("placementId")));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/spatial-planning");
}

export async function acknowledgeRevertNoticeAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await acknowledgeRevertNotice(actor, String(formData.get("noticeId")));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/spatial-planning");
}

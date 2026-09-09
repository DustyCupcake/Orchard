"use server";

import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { createProposal } from "@/lib/proposals";
import { AppError } from "@/lib/errors";

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

export async function submitProposal(formData: FormData) {
  const actor = await requireMember();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    redirect("/propose?error=A%20title%20is%20required");
  }

  const suggestedMemberId = String(formData.get("suggestedMemberId") ?? "") || null;

  const suggestedBranchId = String(formData.get("branchId") ?? "").trim() || null;
  const suggestedCycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const effortRaw = String(formData.get("effort") ?? "").trim();
  const suggestedEffort = effortRaw || null;
  let suggestedEffortMagnitude: Record<string, unknown> | null = null;
  if (effortRaw) {
    const duration = String(formData.get("duration") ?? "");
    const hoursPerWeekRaw = String(formData.get("hoursPerWeek") ?? "");
    suggestedEffortMagnitude =
      effortRaw === "one_off" ? { duration: duration || "few_hours" } : { hours_per_week: Number(hoursPerWeekRaw) || 1 };
  }
  const suggestedTagsRaw = String(formData.get("tags") ?? "");
  const suggestedTags = suggestedTagsRaw
    ? suggestedTagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : null;
  const suggestedCapacityRaw = String(formData.get("capacity") ?? "").trim();
  const suggestedCritical = formData.get("critical") === "on";
  const suggestedDueDate = String(formData.get("dueDate") ?? "").trim() || null;

  // One radio-group per axis, named "axis_<axisId>" (see AxisScaleField).
  const suggestedAxisValuesRaw: Record<string, number> = {};
  for (const key of formData.keys()) {
    if (!key.startsWith("axis_")) continue;
    const raw = formData.get(key);
    if (raw === null || raw === "") continue;
    suggestedAxisValuesRaw[key.slice("axis_".length)] = Number(raw);
  }
  const suggestedAxisValues = Object.keys(suggestedAxisValuesRaw).length > 0 ? suggestedAxisValuesRaw : null;

  try {
    await createProposal(actor, {
      title,
      description: String(formData.get("description") ?? ""),
      wantsToClaim: formData.get("wantsToClaim") === "on",
      suggestedMemberId,
      suggestedMemberNote: String(formData.get("suggestedMemberNote") ?? "") || null,
      suggestedBranchId,
      suggestedCycleId,
      suggestedEffort: suggestedEffort as "one_off" | "ongoing" | "owns_a_thing" | null,
      suggestedEffortMagnitude,
      suggestedTags,
      suggestedCapacity: suggestedCapacityRaw ? Number(suggestedCapacityRaw) : null,
      suggestedCritical,
      suggestedDueDate,
      suggestedAxisValues,
    });
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/propose?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/proposals?submitted=1");
}

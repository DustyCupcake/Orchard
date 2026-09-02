"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { createCycle, updateCycleSettings, updateCycleSettingsInput, updatePhaseBoundary } from "@/lib/cycles";
import type { DateBoundaryInput } from "@/lib/dates";
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

// No form anywhere in this app ever called createCycle before this —
// see docs/development-plan.md's Phase 44, which found that gap while
// checking code before trusting the dev-plan's own "extends the
// existing clone/import flow" framing (there was no flow to extend).
// Cycle-initiation-eligibility-gated, enforced inside createCycle
// itself. Dates for a fresh clone aren't set here — see this page's own
// "Preview a clone" section below for why: the Cycle-settings form
// right above this one already sets them post-creation, and doing it
// there (not here) means a clone's dates always go through the exact
// same recompute path an existing cycle's date edit does, not a second
// one.
export async function createCycleAction(formData: FormData) {
  const actor = await requireMember();
  const source = String(formData.get("source") ?? "blank");
  const name = String(formData.get("name") ?? "").trim();
  const cycleTypeId = String(formData.get("cycleTypeId") ?? "").trim() || null;

  try {
    if (source === "clone_previous") {
      await createCycle(actor, { source: "clone_previous", name, cycleTypeId });
    } else {
      const startDate = String(formData.get("startDate") ?? "").trim() || null;
      const endDate = String(formData.get("endDate") ?? "").trim() || null;
      await createCycle(actor, { source: "blank", name, cycleTypeId, startDate, endDate });
    }
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/participation");
  redirect("/participation?cycleCreated=1");
}

// Cycle-initiation-eligibility-gated, enforced inside updateCycleSettings.
export async function updateCycleSettingsAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const capacityRaw = String(formData.get("capacity") ?? "").trim();
  const windowRaw = String(formData.get("returningWindowClosesAt") ?? "").trim();
  const startDateRaw = String(formData.get("startDate") ?? "").trim();
  const endDateRaw = String(formData.get("endDate") ?? "").trim();

  try {
    const input = updateCycleSettingsInput.parse({
      capacity: capacityRaw ? Number(capacityRaw) : null,
      returningWindowClosesAt: windowRaw ? new Date(windowRaw).toISOString() : null,
      startDate: startDateRaw || null,
      endDate: endDateRaw || null,
    });
    await updateCycleSettings(actor, cycleId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/participation");
  redirect("/participation?settingsUpdated=1");
}

// Reads one boundary's worth of fields off the submitted form — see
// src/app/participation/page.tsx's PhaseBoundaryFields, which renders
// exactly this shape. A `targetDate` (the "drag it to a new date"
// path) wins over a typed offsetDays/percent when both are present —
// same precedence src/lib/dates/resolve.ts's dateBoundaryInput already
// allows either way, but the form only ever sends one at a time.
function boundaryFromForm(formData: FormData, prefix: "start" | "end"): DateBoundaryInput {
  const mode = String(formData.get(`${prefix}Mode`) ?? "absolute");
  const targetDate = String(formData.get(`${prefix}TargetDate`) ?? "").trim();

  if (mode === "relative_offset") {
    const anchor = String(formData.get(`${prefix}Anchor`) ?? "cycle_start") as "cycle_start" | "cycle_end";
    if (targetDate) return { type: "relative_offset", anchor, targetDate };
    const offsetDaysRaw = String(formData.get(`${prefix}OffsetDays`) ?? "").trim();
    return { type: "relative_offset", anchor, offsetDays: offsetDaysRaw ? Number(offsetDaysRaw) : 0 };
  }
  if (mode === "relative_percent") {
    if (targetDate) return { type: "relative_percent", targetDate };
    const percentRaw = String(formData.get(`${prefix}Percent`) ?? "").trim();
    return { type: "relative_percent", percent: percentRaw ? Number(percentRaw) : 0 };
  }
  const absoluteDate = String(formData.get(`${prefix}AbsoluteDate`) ?? "").trim();
  return { type: "absolute", date: absoluteDate || null };
}

// Cycle-initiation-eligibility-gated, enforced inside updatePhaseBoundary
// — same authority as Cycle settings above. See docs/development-plan.md's
// Phase 39.
export async function updatePhaseBoundaryAction(formData: FormData) {
  const actor = await requireMember();
  const phaseId = String(formData.get("phaseId"));

  try {
    await updatePhaseBoundary(actor, phaseId, {
      start: boundaryFromForm(formData, "start"),
      end: boundaryFromForm(formData, "end"),
    });
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/participation");
  redirect("/participation?phaseUpdated=1");
}

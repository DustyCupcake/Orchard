"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import {
  closeCycle,
  createCycle,
  updateCycleSettings,
  updateCycleSettingsInput,
  updatePhaseBoundary,
  updatePhaseHighlight,
} from "@/lib/cycles";
import type { DateBoundaryInput } from "@/lib/dates";
import { exportCycleAsTaskPack } from "@/lib/task-packs";
import { AppError, ConfirmationRequiredError } from "@/lib/errors";

// Every form on this page carries a hidden `cycleScope` field so a
// redirect after submitting lands back on the exact scoped URL it came
// from (docs/development-plan.md's Phase 65) — never the bare
// /participation, which could bounce through the redirect shim to a
// *different* default scope than the one the member was just looking
// at.
function redirectWithError(cycleScope: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/${cycleScope}/participation?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/${cycleScope}/participation?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

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

export async function declareParticipationAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const input = declareParticipationInput.parse({
      status: String(formData.get("status") ?? "unknown"),
      arrivalDate: String(formData.get("arrivalDate") ?? "").trim() || null,
      departureDate: String(formData.get("departureDate") ?? "").trim() || null,
      note: String(formData.get("note") ?? "").trim() || null,
    });
    await declareParticipation(actor, cycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?declared=1`);
}

// No form anywhere in this app ever called createCycle before Phase 44
// — see this file's own long-standing comment history. Cycle-
// initiation-eligibility-gated, enforced inside createCycle itself,
// which also now (Phase 65) throws ConfirmationRequiredError when a
// cycle is already open and `confirmed` wasn't passed — the page
// itself pre-computes this (needsAlreadyOpenConfirmation) and shows a
// real confirm banner, matching the same UX pattern
// src/app/(app)/tasks/[id]/page.tsx's self-assign confirmation already
// establishes; the thrown error here is only a defense-in-depth
// backstop if the two ever drift. On success, redirects to the *newly
// created* cycle's own scope — not wherever the form was submitted
// from — so the admin lands directly on what they just made.
export async function createCycleAction(formData: FormData) {
  const actor = await requireMember();
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  const source = String(formData.get("source") ?? "blank");
  const name = String(formData.get("name") ?? "").trim();
  const cycleTypeId = String(formData.get("cycleTypeId") ?? "").trim() || null;
  const confirmed = formData.get("confirmed") === "on";

  let created;
  try {
    if (source === "clone_previous") {
      created = await createCycle(actor, { source: "clone_previous", name, cycleTypeId, confirmed });
    } else {
      const startDate = String(formData.get("startDate") ?? "").trim() || null;
      const endDate = String(formData.get("endDate") ?? "").trim() || null;
      created = await createCycle(actor, { source: "blank", name, cycleTypeId, startDate, endDate, confirmed });
    }
  } catch (err) {
    if (err instanceof ConfirmationRequiredError) {
      redirect(`/${cycleScope}/participation?error=${encodeURIComponent(err.message)}`);
    }
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${created.id}/participation?cycleCreated=1`);
}

// Cycle-initiation-eligibility-gated, enforced inside updateCycleSettings.
export async function updateCycleSettingsAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");
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
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?settingsUpdated=1`);
}

// Cycle-initiation-eligibility-gated, enforced inside
// exportCycleAsTaskPack — see docs/development-plan.md's Phase 55.
// taskIds is left unset here (exports the whole cycle); the board's
// own bulk-selection checkboxes post to a sibling action for the
// partial-export case.
export async function exportCycleAsTaskPackAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;

  let packId: string;
  try {
    const created = await exportCycleAsTaskPack(actor, cycleId, { name, description });
    packId = created.id;
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  redirect(`/task-packs?exported=${packId}`);
}

// Reads one boundary's worth of fields off the submitted form — see
// src/app/(app)/[cycleScope]/participation/page.tsx's
// PhaseBoundaryFields, which renders exactly this shape. A
// `targetDate` (the "drag it to a new date" path) wins over a typed
// offsetDays/percent when both are present — same precedence
// src/lib/dates/resolve.ts's dateBoundaryInput already allows either
// way, but the form only ever sends one at a time.
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
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    await updatePhaseBoundary(actor, phaseId, {
      start: boundaryFromForm(formData, "start"),
      end: boundaryFromForm(formData, "end"),
    });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?phaseUpdated=1`);
}

// Cycle-initiation-eligibility-gated, enforced inside updatePhaseHighlight
// — same authority as everything else on this page. See src/lib/nav.ts's
// HIGHLIGHTABLE_MODULES for the option set this form's select renders.
export async function updatePhaseHighlightAction(formData: FormData) {
  const actor = await requireMember();
  const phaseId = String(formData.get("phaseId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  const highlightModuleKey = String(formData.get("highlightModuleKey") ?? "").trim() || null;

  try {
    await updatePhaseHighlight(actor, phaseId, highlightModuleKey);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?highlightUpdated=1`);
}

// Admin-gated inside closeCycle itself (src/lib/cycles/lifecycle.ts —
// docs/development-plan.md's Phase 65). The page pre-computes whether
// the Budget-owner warning applies and requires a real checkbox before
// this ever submits with overrideBudgetWarning=on, matching the
// self-assign confirmation UX pattern elsewhere in this codebase — the
// ConfirmationRequiredError catch below is only a defense-in-depth
// backstop if the two ever drift.
export async function closeCycleAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  const overrideBudgetWarning = formData.get("overrideBudgetWarning") === "on";

  try {
    await closeCycle(actor, cycleId, { overrideBudgetWarning });
  } catch (err) {
    if (err instanceof ConfirmationRequiredError) {
      redirect(`/${cycleScope}/participation?error=${encodeURIComponent(err.message)}`);
    }
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?cycleClosed=1`);
}

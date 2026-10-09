"use server";

import { ZodError } from "zod";
import { getEventTimeZone } from "@/lib/cycles";
import { instantFromZoned, isValidTimeZone } from "@/lib/dates";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { startBudgetCycleForNewCycle } from "@/lib/budget";
import {
  addPhase,
  closeCycle,
  createCycle,
  updateCycleSettings,
  updateCycleSettingsInput,
  updatePhaseBoundary,
  updatePhaseHighlight,
} from "@/lib/cycles";
import type { DateBoundaryInput } from "@/lib/dates";
import { exportCycleAsTaskPack } from "@/lib/task-packs";
import {
  joiningLaneRuleInputSchema,
  updateCycleLaneRules,
  type JoiningLaneRuleInput,
} from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_ORDER } from "@/lib/recruitment/lanes";
import type { JoinLaneKind } from "@/db/schema";
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
  const startBudget = formData.get("startBudget") === "on";

  let created;
  try {
    if (source === "clone_previous") {
      const startDate = String(formData.get("startDate") ?? "").trim() || null;
      const endDate = String(formData.get("endDate") ?? "").trim() || null;
      created = await createCycle(actor, { source: "clone_previous", name, cycleTypeId, startDate, endDate, confirmed });
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

  // Best-effort and opt-in only (the checkbox above) — a Budget hiccup
  // here never means the Cycle itself failed to start; see
  // src/lib/budget/cycles.ts's startBudgetCycleForNewCycle.
  let budgetStarted = false;
  if (startBudget) {
    try {
      budgetStarted = Boolean(await startBudgetCycleForNewCycle(actor, created));
    } catch {
      budgetStarted = false;
    }
  }

  revalidatePath(`/${cycleScope}/participation`);
  const budgetFlag = startBudget && !budgetStarted ? "&budgetNotStarted=1" : "";
  redirect(`/${created.id}/participation?cycleCreated=1${budgetFlag}`);
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
  const timeZoneRaw = String(formData.get("timeZone") ?? "").trim();
  const applicationFormId = String(formData.get("recruitmentApplicationFormId") ?? "").trim() || null;
  const joiningWindowRaw = String(formData.get("joiningWindowClosesAt") ?? "").trim();

  try {
    // The windows are typed on the event's clock — the one this same form
    // is saving, or the community's when it's being cleared. An unusable
    // zone is left for the schema to reject with its own message rather
    // than throwing from here first.
    const clock = isValidTimeZone(timeZoneRaw)
      ? timeZoneRaw
      : await getEventTimeZone(actor.communityId, null);
    const input = updateCycleSettingsInput.parse({
      capacity: capacityRaw ? Number(capacityRaw) : null,
      returningWindowClosesAt: windowRaw ? instantFromZoned(windowRaw, clock).toISOString() : null,
      startDate: startDateRaw || null,
      endDate: endDateRaw || null,
      // Blank inherits the Community's zone rather than pinning UTC —
      // see src/lib/dates/timezone.ts.
      timeZone: timeZoneRaw || null,
      recruitmentApplicationFormId: applicationFormId,
      applicationsOpen: formData.get("applicationsOpen") === "on",
      invitesOpen: formData.get("invitesOpen") === "on",
      // §2.3/J3's third door. `=== "on"` like its two siblings: all three
      // are always in this form, so an unchecked box genuinely means off
      // rather than "not in this form" (the hidden-`off` trick the
      // settings screen's per-card forms need doesn't apply to a form that
      // owns all three).
      interviewsOpen: formData.get("interviewsOpen") === "on",
      joiningWindowClosesAt: joiningWindowRaw ? instantFromZoned(joiningWindowRaw, clock).toISOString() : null,
    });
    await updateCycleSettings(actor, cycleId, input);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?settingsUpdated=1`);
}

// §5.2 — the per-event admission-rule overrides. Its own action, its own
// button and its own error redirect, for the same reason the settings
// screen's cards stopped sharing one: four lane cards and a capacity
// field are unrelated decisions, and a rejected lane rule shouldn't cost
// you the capacity you just set.
//
// A lane whose override checkbox is unticked is *deleted*, not reset —
// inheritance is the absence of a row, so removing a card genuinely hands
// the lane back to the community rule instead of freezing whatever it
// happened to be. deleteCycleLaneRules does that; the write side then
// only handles the ones that stayed.
export async function updateCycleLaneRulesAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");

  try {
    const rules: Partial<Record<JoinLaneKind, JoiningLaneRuleInput>> = {};
    const dropped: JoinLaneKind[] = [];
    for (const lane of JOINING_LANE_ORDER) {
      const ticked = formData.get(`lane.${lane}.override`) === "on";
      if (!ticked) {
        dropped.push(lane);
        continue;
      }
      rules[lane] = joiningLaneRuleInputSchema.parse({
        verificationMode: formData.get(`lane.${lane}.verificationMode`),
        supportCount: Number(formData.get(`lane.${lane}.supportCount`) ?? 1),
        applicationRequired: formData.getAll(`lane.${lane}.applicationRequired`).includes("on"),
        interviewRequired: formData.getAll(`lane.${lane}.interviewRequired`).includes("on"),
        applyInsteadAvailable: formData.getAll(`lane.${lane}.applyInsteadAvailable`).includes("on"),
      });
    }
    await updateCycleLaneRules(actor, cycleId, rules, dropped);
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?laneRulesUpdated=1`);
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

// The form now submits one resolved date. Relative mode is intentionally
// rejected here when the date is blank; a blank optional Phase boundary is
// represented as an explicitly-unset absolute boundary, never as offset zero.
function boundaryFromForm(formData: FormData, prefix: "start" | "end"): DateBoundaryInput {
  const mode = String(formData.get(`${prefix}Mode`) ?? "absolute");
  const date = String(formData.get(`${prefix}Date`) ?? "").trim();
  if (!date) return { type: "absolute", date: null };
  if (mode === "relative") {
    return { type: "relative", date };
  }
  return { type: "absolute", date: date || null };
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

// Cycle-initiation-eligibility-gated, enforced inside addPhase — same
// authority as everything else on this page. `order` isn't read from
// formData at all — addPhase always appends.
export async function addPhaseAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const cycleScope = String(formData.get("cycleScope") ?? "active");
  const name = String(formData.get("name") ?? "").trim();

  try {
    if (!name) throw new AppError("A phase needs a name");
    await addPhase(actor, cycleId, {
      name,
      start: boundaryFromForm(formData, "start"),
      end: boundaryFromForm(formData, "end"),
    });
  } catch (err) {
    redirectWithError(cycleScope, err);
  }

  revalidatePath(`/${cycleScope}/participation`);
  redirect(`/${cycleScope}/participation?phaseAdded=1`);
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

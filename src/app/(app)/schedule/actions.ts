"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  collapseCellsToWindows,
  confirmEventProposalSlot,
  confirmEventProposalSlotInput,
  createEventProposal,
  createEventProposalInput,
  declineEventProposal,
  getProposalTimeZone,
  paintedCellsInput,
  pingConflictHost,
  publishEventSchedule,
  updateEventProposal,
  updateEventProposalInput,
} from "@/lib/event-scheduling";
import { AppError } from "@/lib/errors";
import { instantFromZoned } from "@/lib/dates";

/**
 * The AvailabilityGrid's painted cells -> the availability windows
 * stored on the row.
 *
 * The grid posts absolute UTC instants for every painted half-hour, so
 * nothing here depends on the event's zone — the conversion happened in
 * the browser, where the wall clock it was painting is known. Collapsing
 * to windows is the lib's job rather than this action's, so the "what
 * does this shape mean" arithmetic has one home.
 */
function parsePaintedAvailability(formData: FormData) {
  const raw = String(formData.get("availabilityCells") ?? "[]");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError("Those times didn't come through — please paint them again.");
  }
  // The grid posts the bare array, so the {cells} wrapper paintedCellsInput
  // describes is added here rather than in the component — the component
  // only produces instants, and where they're wrapped is a parsing rule.
  const { cells } = paintedCellsInput.parse({ cells: parsed });
  return collapseCellsToWindows(cells);
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/schedule?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/schedule?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Open to any member — "any member submits a proposal."

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

export async function submitEventProposalAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const cycleIdRaw = String(formData.get("cycleId") ?? "").trim();
    const input = createEventProposalInput.parse({
      cycleId: cycleIdRaw || null,
      host: String(formData.get("host") ?? "").trim(),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      durationMinutes: Number(formData.get("durationMinutes") ?? NaN),
      spaceNeeds: String(formData.get("spaceNeeds") ?? "").trim() || null,
      preferredSlots: parsePaintedAvailability(formData),
    });
    await createEventProposal(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?submitted=1");
}

// Submitter-only, enforced inside updateEventProposal.
export async function updateEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    const input = updateEventProposalInput.parse({
      host: String(formData.get("host") ?? "").trim(),
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      durationMinutes: Number(formData.get("durationMinutes") ?? NaN),
      spaceNeeds: String(formData.get("spaceNeeds") ?? "").trim() || null,
      preferredSlots: parsePaintedAvailability(formData),
    });
    await updateEventProposal(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?updated=1");
}

// Owner-only, enforced inside confirmEventProposalSlot.
export async function confirmEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    // The two datetime-local controls are filled in and read in the
    // event's own wall-clock. `new Date(...)` on a bare "YYYY-MM-DDTHH:mm"
    // would instead read it in the *server's* zone, so a confirmed slot
    // could land hours off what the owner just clicked — instantFromZoned
    // converts against the event's zone, which is looked up here rather
    // than trusted from the form.
    const timeZone = await getProposalTimeZone(actor, proposalId);
    const startsAtRaw = String(formData.get("startsAt") ?? "");
    const endsAtRaw = String(formData.get("endsAt") ?? "");
    const input = confirmEventProposalSlotInput.parse({
      startsAt: startsAtRaw ? instantFromZoned(startsAtRaw, timeZone).toISOString() : "",
      endsAt: endsAtRaw ? instantFromZoned(endsAtRaw, timeZone).toISOString() : "",
    });
    await confirmEventProposalSlot(actor, proposalId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?confirmed=1");
}

// Owner-only, enforced inside declineEventProposal.
export async function declineEventProposalAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    await declineEventProposal(actor, proposalId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?declined=1");
}

// Owner-only, enforced inside pingConflictHost.
export async function pingConflictHostAction(formData: FormData) {
  const actor = await requireMember();
  const proposalId = String(formData.get("proposalId"));

  try {
    await pingConflictHost(actor, proposalId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?pinged=1");
}

// Owner-only, enforced inside publishEventSchedule against the given
// cycleId (docs/development-plan.md's Phase 68) — a hidden field on
// EventReviewSection.tsx's form carries the review batch's resolved
// cycle, since publishing has no single proposal row to derive it from.
export async function publishEventScheduleAction(formData: FormData) {
  const actor = await requireMember();
  const cycleIdRaw = String(formData.get("cycleId") ?? "").trim();

  try {
    await publishEventSchedule(actor, cycleIdRaw || null);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/schedule");
  redirect("/schedule?published=1");
}

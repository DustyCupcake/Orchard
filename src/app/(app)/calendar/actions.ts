"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  acceptCalendarEventInvite,
  createCalendarEvent,
  createCalendarEventInput,
  declineCalendarEventInvite,
  deleteCalendarEvent,
  inviteBranchRosterToCalendarEvent,
  inviteCommunityToCalendarEvent,
  inviteMemberToCalendarEvent,
  updateCalendarEvent,
  updateCalendarEventInput,
} from "@/lib/calendar-events";
import type { DateBoundaryInput } from "@/lib/dates";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/calendar?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/calendar?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Mirrors src/app/(app)/participation/actions.ts's own boundaryFromForm,
// simplified to one field (an event has a single date, not a start/end
// pair) — see src/app/(app)/calendar/page.tsx's EventDateFields.
function dateFromForm(formData: FormData): DateBoundaryInput {
  const mode = String(formData.get("dateMode") ?? "absolute");
  const targetDate = String(formData.get("targetDate") ?? "").trim();

  if (mode === "relative_offset") {
    const anchor = String(formData.get("anchor") ?? "cycle_start") as "cycle_start" | "cycle_end";
    if (targetDate) return { type: "relative_offset", anchor, targetDate };
    const offsetDaysRaw = String(formData.get("offsetDays") ?? "").trim();
    return { type: "relative_offset", anchor, offsetDays: offsetDaysRaw ? Number(offsetDaysRaw) : 0 };
  }
  if (mode === "relative_percent") {
    if (targetDate) return { type: "relative_percent", targetDate };
    const percentRaw = String(formData.get("percent") ?? "").trim();
    return { type: "relative_percent", percent: percentRaw ? Number(percentRaw) : 0 };
  }
  const absoluteDate = String(formData.get("absoluteDate") ?? "").trim();
  return { type: "absolute", date: absoluteDate || null };
}

function shareTargetFromForm(formData: FormData) {
  const shareTarget = String(formData.get("shareTarget") ?? "personal") as "personal" | "branch" | "community";
  const sharedBranchId = String(formData.get("sharedBranchId") ?? "").trim() || null;
  return { shareTarget, sharedBranchId };
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

export async function createCalendarEventAction(formData: FormData) {
  const actor = await requireMember();
  const { shareTarget, sharedBranchId } = shareTargetFromForm(formData);
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;

  try {
    const input = createCalendarEventInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || null,
      cycleId,
      date: dateFromForm(formData),
      shareTarget,
      sharedBranchId,
    });
    await createCalendarEvent(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect("/calendar?created=1");
}

export async function updateCalendarEventAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));
  const { shareTarget, sharedBranchId } = shareTargetFromForm(formData);
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;

  try {
    const input = updateCalendarEventInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || null,
      cycleId,
      date: dateFromForm(formData),
      shareTarget,
      sharedBranchId,
    });
    await updateCalendarEvent(actor, eventId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  redirect("/calendar?updated=1");
}

export async function deleteCalendarEventAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));

  try {
    await deleteCalendarEvent(actor, eventId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect("/calendar?deleted=1");
}

export async function inviteMemberAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));
  const memberId = String(formData.get("memberId"));

  try {
    await inviteMemberToCalendarEvent(actor, eventId, memberId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  redirect("/calendar?invited=1");
}

export async function inviteBranchAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));
  const branchId = String(formData.get("branchId"));

  try {
    await inviteBranchRosterToCalendarEvent(actor, eventId, branchId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  redirect("/calendar?invited=1");
}

export async function inviteCommunityAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));

  try {
    await inviteCommunityToCalendarEvent(actor, eventId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  redirect("/calendar?invited=1");
}

export async function acceptInviteAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));

  try {
    await acceptCalendarEventInvite(actor, eventId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect("/calendar?responded=1");
}

export async function declineInviteAction(formData: FormData) {
  const actor = await requireMember();
  const eventId = String(formData.get("eventId"));

  try {
    await declineCalendarEventInvite(actor, eventId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  redirect("/calendar?responded=1");
}

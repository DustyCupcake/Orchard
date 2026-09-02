"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  archiveShiftSeries,
  createShiftSeries,
  createShiftSeriesInput,
  generateShiftOccurrences,
  generateShiftOccurrencesInput,
  markShiftSignupCompleted,
  markShiftSignupNoShow,
  signUpForShift,
  unarchiveShiftSeries,
  withdrawFromShift,
} from "@/lib/shifts";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/shifts?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/shifts?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Open to any member — see src/lib/shifts/series.ts's createShiftSeries.
export async function createShiftSeriesAction(formData: FormData) {
  const actor = await requireMember();

  try {
    const input = createShiftSeriesInput.parse({
      branchId: String(formData.get("branchId") ?? "").trim() || null,
      title: String(formData.get("title") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || undefined,
      defaultCapacity: Number(formData.get("defaultCapacity") ?? NaN),
      sourceTaskId: String(formData.get("sourceTaskId") ?? "").trim() || null,
    });
    await createShiftSeries(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?seriesCreated=1");
}

export async function signUpForShiftAction(formData: FormData) {
  const actor = await requireMember();
  const occurrenceId = String(formData.get("occurrenceId"));

  try {
    await signUpForShift(actor, occurrenceId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?signedUp=1");
}

export async function withdrawFromShiftAction(formData: FormData) {
  const actor = await requireMember();
  const occurrenceId = String(formData.get("occurrenceId"));

  try {
    await withdrawFromShift(actor, occurrenceId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?withdrawn=1");
}

// Coordinator-only, enforced inside generateShiftOccurrences. Two
// separate forms on the page (weekly pattern / explicit list) post to
// this same action, distinguished by a hidden "mode" field — no
// client-side JS toggle available in this codebase.
export async function generateOccurrencesAction(formData: FormData) {
  const actor = await requireMember();
  const seriesId = String(formData.get("seriesId"));
  const mode = String(formData.get("mode"));

  try {
    if (mode === "weekly") {
      const input = generateShiftOccurrencesInput.parse({
        mode: "weekly",
        startDate: String(formData.get("startDate") ?? ""),
        endDate: String(formData.get("endDate") ?? ""),
        daysOfWeek: formData.getAll("daysOfWeek").map(Number),
        startTime: String(formData.get("startTime") ?? ""),
        durationMinutes: Number(formData.get("durationMinutes") ?? NaN),
      });
      await generateShiftOccurrences(actor, seriesId, input);
    } else {
      const slots = String(formData.get("slotsRaw") ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [startsAt, endsAt] = line.split("|").map((p) => p?.trim() ?? "");
          return {
            startsAt: startsAt ? new Date(startsAt).toISOString() : "",
            endsAt: endsAt ? new Date(endsAt).toISOString() : "",
          };
        });
      const input = generateShiftOccurrencesInput.parse({ mode: "explicit", slots });
      await generateShiftOccurrences(actor, seriesId, input);
    }
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?occurrencesGenerated=1");
}

export async function archiveShiftSeriesAction(formData: FormData) {
  const actor = await requireMember();
  const seriesId = String(formData.get("seriesId"));

  try {
    await archiveShiftSeries(actor, seriesId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?archived=1");
}

export async function unarchiveShiftSeriesAction(formData: FormData) {
  const actor = await requireMember();
  const seriesId = String(formData.get("seriesId"));

  try {
    await unarchiveShiftSeries(actor, seriesId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?unarchived=1");
}

// Self-reported, enforced inside markShiftSignupCompleted.
export async function markShiftSignupCompletedAction(formData: FormData) {
  const actor = await requireMember();
  const signupId = String(formData.get("signupId"));

  try {
    await markShiftSignupCompleted(actor, signupId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?markedCompleted=1");
}

// Coordinator-only, enforced inside markShiftSignupNoShow.
export async function markShiftSignupNoShowAction(formData: FormData) {
  const actor = await requireMember();
  const signupId = String(formData.get("signupId"));

  try {
    await markShiftSignupNoShow(actor, signupId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/shifts");
  redirect("/shifts?markedNoShow=1");
}

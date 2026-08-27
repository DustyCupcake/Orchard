"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  addAgendaItem,
  addAgendaItemInput,
  confirmSlot,
  markSummaryRead,
  publishSummary,
  recordAttendance,
  saveSummary,
} from "@/lib/scheduling-polls";
import { AppError } from "@/lib/errors";

function redirectWithError(pollId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/scheduling-polls/${pollId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/scheduling-polls/${pollId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function addAgendaItemAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));

  try {
    const input = addAgendaItemInput.parse({ text: String(formData.get("text") ?? "") });
    await addAgendaItem(actor, pollId, input);
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

export async function saveSummaryAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));

  try {
    await saveSummary(actor, pollId, { body: String(formData.get("body") ?? "") });
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

export async function publishSummaryAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));

  try {
    await publishSummary(actor, pollId);
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

export async function markSummaryReadAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));
  const summaryId = String(formData.get("summaryId"));

  try {
    await markSummaryRead(actor, summaryId);
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

export async function confirmSlotAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));
  const slot = String(formData.get("slot"));

  try {
    await confirmSlot(actor, pollId, { slot });
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

export async function recordAttendanceAction(formData: FormData) {
  const actor = await requireMember();
  const pollId = String(formData.get("pollId"));
  const memberId = String(formData.get("memberId"));
  const attended = formData.get("attended") === "true";

  try {
    await recordAttendance(actor, pollId, { memberId, attended });
  } catch (err) {
    redirectWithError(pollId, err);
  }

  revalidatePath(`/scheduling-polls/${pollId}`);
}

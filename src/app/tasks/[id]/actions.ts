"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  acceptJoinRequest,
  addComment,
  addCommentInput,
  addResource,
  addResourceInput,
  addWikiRevision,
  addWikiRevisionInput,
  declineJoinRequest,
  splitSubtask,
  splitSubtaskInput,
  withdrawJoinRequest,
} from "@/lib/tasks";
import { AppError } from "@/lib/errors";

function redirectWithError(taskId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/tasks/${taskId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function editWikiAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addWikiRevisionInput.parse({ content: String(formData.get("content") ?? "") });
    await addWikiRevision(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function addCommentAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addCommentInput.parse({ body: String(formData.get("body") ?? "") });
    await addComment(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function addResourceAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addResourceInput.parse({
      label: String(formData.get("label") ?? ""),
      url: String(formData.get("url") ?? ""),
      tag: String(formData.get("tag") ?? "") || undefined,
    });
    await addResource(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function splitSubtaskAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  const effort = String(formData.get("effort"));
  const duration = String(formData.get("duration") ?? "");
  const hoursPerWeekRaw = String(formData.get("hoursPerWeek") ?? "");
  const effortMagnitude =
    effort === "one_off"
      ? { duration: duration || "few_hours" }
      : { hours_per_week: Number(hoursPerWeekRaw) || 1 };

  const capacityRaw = String(formData.get("capacity") ?? "");
  const branchId = String(formData.get("branchId") ?? "") || undefined;

  let created;
  try {
    const input = splitSubtaskInput.parse({
      branchId,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      effort,
      effortMagnitude,
      capacity: capacityRaw ? Number(capacityRaw) : undefined,
      critical: formData.get("critical") === "on",
    });
    created = await splitSubtask(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  redirect(`/tasks/${created.id}`);
}

export async function acceptJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));

  try {
    await acceptJoinRequest(actor, taskId, requestId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function declineJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));
  const reason = String(formData.get("reason") ?? "") || null;

  try {
    await declineJoinRequest(actor, taskId, requestId, { reason });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function withdrawJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));

  try {
    await withdrawJoinRequest(actor, taskId, requestId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

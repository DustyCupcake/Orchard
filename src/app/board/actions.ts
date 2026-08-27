"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { claimTask, finishTask, parkTask, releaseTask, resumeTask } from "@/lib/tasks";
import { AppError } from "@/lib/errors";

async function runAction(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/board?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/board");
}

export async function claimAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => claimTask(actor, taskId));
}

export async function releaseAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => releaseTask(actor, taskId));
}

export async function resumeAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => resumeTask(actor, taskId));
}

export async function finishAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => finishTask(actor, taskId));
}

export async function parkAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const nextCheckinAt = String(formData.get("nextCheckinAt"));
  const waitingNote = String(formData.get("waitingNote") ?? "");

  await runAction(() =>
    parkTask(actor, taskId, {
      nextCheckinAt: new Date(nextCheckinAt),
      waitingNote: waitingNote || undefined,
    }),
  );
}

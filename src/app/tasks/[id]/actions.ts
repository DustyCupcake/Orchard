"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { addComment, addCommentInput, addResource, addResourceInput, addWikiRevision, addWikiRevisionInput } from "@/lib/tasks";
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

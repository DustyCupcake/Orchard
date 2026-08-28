"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  addWikiPageRevision,
  addWikiPageRevisionInput,
  markWikiPageDuplicate,
  markWikiPageDuplicateInput,
} from "@/lib/wiki-pages";
import { AppError } from "@/lib/errors";

function redirectWithError(pageId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/documentation/${pageId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/documentation/${pageId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function editWikiPageAction(formData: FormData) {
  const actor = await requireMember();
  const pageId = String(formData.get("pageId"));

  try {
    const input = addWikiPageRevisionInput.parse({ content: String(formData.get("content") ?? "") });
    await addWikiPageRevision(actor, pageId, input);
  } catch (err) {
    redirectWithError(pageId, err);
  }

  revalidatePath(`/documentation/${pageId}`);
}

export async function markDuplicateAction(formData: FormData) {
  const actor = await requireMember();
  const pageId = String(formData.get("pageId"));
  const duplicateOfPageId = String(formData.get("duplicateOfPageId") ?? "");

  try {
    const input = markWikiPageDuplicateInput.parse({ duplicateOfPageId });
    await markWikiPageDuplicate(actor, pageId, input);
  } catch (err) {
    redirectWithError(pageId, err);
  }

  revalidatePath(`/documentation/${pageId}`);
  // Land on the canonical page — the one just resolved as a duplicate
  // has nothing left to look at.
  redirect(`/documentation/${duplicateOfPageId}`);
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { archiveTaskPack, importTaskPackFromFile, unarchiveTaskPack } from "@/lib/task-packs";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/task-packs?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/task-packs?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Phase 54 (View-as): see participation/actions.ts's own identical
// comment — every write in this file goes through requireMember()
// below rather than the raw @/lib/api import directly.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// "Uploading" adopts an externally-shared pack file as a real, local
// TaskPack — see src/lib/task-packs/file.ts's own comment on why this
// is the one adoption step the rest of the import flow never needs to
// know happened.
export async function importTaskPackFromFileAction(formData: FormData) {
  const actor = await requireMember();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    redirect(`/task-packs?error=${encodeURIComponent("Choose a .json Task Pack file to upload")}`);
  }

  let packId: string;
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new AppError("That file isn't valid JSON");
    }
    const pack = await importTaskPackFromFile(actor, parsed);
    packId = pack.id;
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/task-packs");
  redirect(`/task-packs?imported=${packId}`);
}

export async function archiveTaskPackAction(formData: FormData) {
  const actor = await requireMember();
  const packId = String(formData.get("packId"));
  try {
    await archiveTaskPack(actor, packId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/task-packs");
}

export async function unarchiveTaskPackAction(formData: FormData) {
  const actor = await requireMember();
  const packId = String(formData.get("packId"));
  try {
    await unarchiveTaskPack(actor, packId);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/task-packs");
}

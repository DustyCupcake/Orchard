"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/api";
import { createWikiPage, createWikiPageInput } from "@/lib/wiki-pages";
import { AppError } from "@/lib/errors";

export async function createWikiPageAction(formData: FormData) {
  const actor = await requireMember();

  let created;
  try {
    const branchId = String(formData.get("branchId") ?? "") || undefined;
    const content = String(formData.get("content") ?? "") || undefined;
    const input = createWikiPageInput.parse({
      title: String(formData.get("title") ?? ""),
      branchId,
      content,
    });
    created = await createWikiPage(actor, input);
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(
        `/documentation/new?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
      );
    }
    if (err instanceof AppError) {
      redirect(`/documentation/new?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect(`/documentation/${created.id}`);
}

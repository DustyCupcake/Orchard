"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { createWikiPage, createWikiPageInput } from "@/lib/wiki-pages";
import { AppError } from "@/lib/errors";

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

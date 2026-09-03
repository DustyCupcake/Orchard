"use server";

import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { createProposal } from "@/lib/proposals";
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

export async function submitProposal(formData: FormData) {
  const actor = await requireMember();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) {
    redirect("/propose?error=A%20title%20is%20required");
  }

  const suggestedMemberId = String(formData.get("suggestedMemberId") ?? "") || null;

  try {
    await createProposal(actor, {
      title,
      description: String(formData.get("description") ?? ""),
      wantsToClaim: formData.get("wantsToClaim") === "on",
      suggestedMemberId,
      suggestedMemberNote: String(formData.get("suggestedMemberNote") ?? "") || null,
    });
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/propose?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }

  redirect("/proposals?submitted=1");
}

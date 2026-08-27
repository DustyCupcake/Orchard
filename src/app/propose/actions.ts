"use server";

import { redirect } from "next/navigation";
import { requireMember } from "@/lib/api";
import { createProposal } from "@/lib/proposals";
import { AppError } from "@/lib/errors";

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

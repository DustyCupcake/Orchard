"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";
import { AppError } from "@/lib/errors";

function redirectWithError(token: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function redeemInviteAction(formData: FormData) {
  const token = String(formData.get("token"));
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();

  try {
    const input = redeemCommunityInviteInput.parse({ email });
    const newMember = await redeemCommunityInvite(token, input);
    await createSession(newMember.id);
  } catch (err) {
    redirectWithError(token, err);
  }

  redirect("/dashboard");
}

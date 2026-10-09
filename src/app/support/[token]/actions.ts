"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";
import { recordSupport } from "@/lib/recruitment";

async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// One member's word, from the link they were given. The marks are their own,
// read out of the form, and the check that they said *something* is in the lib
// where a hand-rolled POST can't skip it.
export async function supportAction(formData: FormData) {
  const actor = await requireMember();
  const token = String(formData.get("token") ?? "");
  try {
    await recordSupport(actor, {
      supportToken: token,
      knowsPersonally: formData.get("knowsPersonally") === "on",
      thinksGoodFit: formData.get("thinksGoodFit") === "on",
    });
  } catch (err) {
    if (err instanceof ZodError) {
      redirect(`/support/${encodeURIComponent(token)}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
    }
    if (err instanceof AppError) {
      redirect(`/support/${encodeURIComponent(token)}?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/support/${encodeURIComponent(token)}?done=1`);
}

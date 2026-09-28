"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";
import { answerSharedInterviewOffer, sharedInterviewInput } from "@/lib/recruitment/pairs";

async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/recruitment?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/recruitment?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// §2.8's joint interview. An offer, answered — never applied
// automatically, which is the whole reason it is a form with two buttons
// rather than a side effect of the pair being accepted. The decline path
// is recorded too, so a community reading these records later can tell
// "never asked" from "asked and said no", which is a real difference
// when the next pair comes along.
export async function answerSharedInterviewAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = sharedInterviewInput.parse({
      pairId: String(formData.get("pairId") ?? ""),
      accept: formData.get("accept") === "1",
    });
    await answerSharedInterviewOffer(actor, input);
  } catch (err) {
    redirectWithError(err);
  }
  redirect("/recruitment");
}

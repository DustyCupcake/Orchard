"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { raiseConcern, raiseConcernInput, withdrawObjection } from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/community-check?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/community-check?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Like every write: never while viewing as someone else.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// The one way to raise a concern about an arrival (docs/admission-flow.md §5),
// whichever way its window opened. Open to any member except whoever stood behind
// the arrival, enforced inside raiseConcern.
export async function raiseConcernAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const input = raiseConcernInput.parse({ note: String(formData.get("note") ?? "") });
    await raiseConcern(actor, String(formData.get("arrivalId") ?? ""), input);
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/community-check");
  redirect("/community-check?raised=1");
}

// Whoever raised a concern can take it back; the arrival then carries on exactly as
// if it had been cleared (check-outcome.ts).
export async function withdrawConcernAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await withdrawObjection(actor, String(formData.get("concernId") ?? ""));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/community-check");
  redirect("/community-check?withdrawn=1");
}

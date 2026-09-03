"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { respondToNomination, respondToNominationInput } from "@/lib/tasks";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/dashboard?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/dashboard?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// The in-app mirror of the emailed one-click links — see
// src/lib/tasks/nominations.ts and src/app/api/task-nominations/respond/route.ts.

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

export async function respondToNominationAction(formData: FormData) {
  const actor = await requireMember();
  const nominationId = String(formData.get("nominationId"));

  try {
    const input = respondToNominationInput.parse({ response: String(formData.get("response") ?? "") });
    await respondToNomination(actor, nominationId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/dashboard");
  revalidatePath("/board");
}

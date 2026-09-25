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
    redirect(`/communication?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/communication?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// The Inbox's own copy of the dashboard's respond-to-nomination action
// (dashboard/actions.ts keeps its own for the same reason every page's
// actions.ts owns its own revalidation) — the Inbox section carries the
// same inline respond buttons, so the revalidation here covers
// /communication too, not just /dashboard and /board. See
// src/lib/tasks/nominations.ts and
// src/app/api/task-nominations/respond/route.ts.
export async function respondToNominationAction(formData: FormData) {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  const nominationId = String(formData.get("nominationId"));

  try {
    const input = respondToNominationInput.parse({ response: String(formData.get("response") ?? "") });
    await respondToNomination(actor, nominationId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/communication");
  revalidatePath("/dashboard");
  revalidatePath("/board");
}
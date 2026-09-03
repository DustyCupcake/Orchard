"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
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

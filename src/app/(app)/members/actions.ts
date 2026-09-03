"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getCurrentMember } from "@/lib/session";
import { activateViewAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/members?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/members?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

async function requireMember() {
  const actor = await getCurrentMember();
  if (!actor) {
    redirect("/login");
  }
  return actor;
}

// Support-task-holder-only — see src/lib/view-as.ts's activateViewAs,
// which does the real authorization check. Lands on /dashboard so the
// support holder immediately sees the platform's actual landing page
// exactly as the viewed member would.
export async function activateViewAsAction(formData: FormData) {
  const actor = await requireMember();
  const targetMemberId = String(formData.get("targetMemberId") ?? "");

  try {
    await activateViewAs(actor, targetMemberId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

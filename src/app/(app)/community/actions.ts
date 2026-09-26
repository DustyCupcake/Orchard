"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { listOutstandingQuestions } from "@/lib/profile-questions/answers";
import { declareParticipation, declareParticipationInput } from "@/lib/participation";
import { AppError } from "@/lib/errors";

// Phase 54 (View-as): every write goes through requireMember() below
// rather than the raw @/lib/api import directly, so a session actively
// rendering as someone else can never perform one — see src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/community?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/community?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// The one-click declare-joining control on this page's "current and
// upcoming events" cards (src/components/EventParticipation.tsx). Kept as
// its own action rather than imported from the Dashboard's identical one
// so it revalidates /community, not /dashboard — the same split
// dashboard/actions.ts's own comment describes for the onboarding answer
// form, and the reason every page here owns its actions.ts.
export async function declareEventStatusAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));

  let eventQuestions = 0;
  try {
    const input = declareParticipationInput.parse({
      status: String(formData.get("status") ?? "unknown"),
    });
    await declareParticipation(actor, cycleId, input);
    eventQuestions = (await listOutstandingQuestions(actor, { cycleId })).filter(
      (q) => q.question.scope !== "once_ever",
    ).length;
  } catch (err) {
    redirectWithError(err);
  }

  // A declaration moves the participant count on this page's own cards,
  // the "Active members" snapshot stat, and the nav switcher's aggregate.
  revalidatePath("/community");
  revalidatePath("/dashboard");
  revalidatePath("/participation");
  revalidatePath("/", "layout");

  if (eventQuestions > 0) {
    redirect(`/questions?cycle=${encodeURIComponent(cycleId)}`);
  }
}

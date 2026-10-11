"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  confirmInterview,
  markInterviewHeld,
  pokeForSupport,
  recordSupport,
  recordDecisionIfReached,
  setRecruitmentSubscriptionActive,
  submitEvaluation,
  submitEvaluationInput,
} from "@/lib/recruitment";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/applications?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/applications?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

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

export async function setRecruitmentSubscriptionAction(formData: FormData) {
  const actor = await requireMember();
  const active = formData.get("active") === "true";

  try {
    await setRecruitmentSubscriptionActive(actor, active);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect(active ? "/applications?subscribed=1" : "/applications?unsubscribed=1");
}

// Holder-gated, enforced inside submitEvaluation. recordDecisionIfReached
// is idempotent (a no-op once a decision already exists for this
// application) so it's safe to call after every evaluation, not just
// the one that happens to complete the threshold.
export async function submitEvaluationAction(formData: FormData) {
  const actor = await requireMember();
  const formResponseId = String(formData.get("formResponseId"));

  try {
    const input = submitEvaluationInput.parse({
      recommendation: String(formData.get("recommendation") ?? ""),
      notes: String(formData.get("notes") ?? "").trim() || null,
    });
    await submitEvaluation(actor, formResponseId, input);
    await recordDecisionIfReached(actor, formResponseId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/applications");
  redirect("/applications?evaluated=1");
}

// A holder who can already see an application supports it from here with one
// action, no link needed (docs/admission-flow.md §2). The marks are their own.
export async function supportApplicationAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await recordSupport(actor, {
      arrivalId: String(formData.get("arrivalId") ?? ""),
      knowsPersonally: formData.get("knowsPersonally") === "on",
      thinksGoodFit: formData.get("thinksGoodFit") === "on",
    });
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/applications");
  redirect("/applications?supported=1");
}

// Ask named members to look at somebody's support link: one message each, never
// a broadcast. Best-effort by design, so the page says who was and wasn't reached
// rather than failing — and the link itself is always on the page to hand over.
export async function askMembersToSupportAction(formData: FormData) {
  const actor = await requireMember();
  try {
    const memberIds = formData.getAll("memberId").map(String).filter(Boolean);
    const { poked } = await pokeForSupport(actor, String(formData.get("arrivalId") ?? ""), memberIds);
    if (poked.length === 0) {
      throw new AppError("Nobody was asked — pick at least one person, and check they have an email on file");
    }
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/applications");
  redirect("/applications?asked=1");
}

// A holder confirms one of the interview times that suit the person and enough of
// the people who'll be on the call (docs/admission-flow.md §2) — a person, not a
// job, and any holder rather than only whoever organized the poll.
export async function confirmInterviewAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await confirmInterview(actor, String(formData.get("arrivalId") ?? ""), String(formData.get("slot") ?? ""));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/applications");
  redirect("/applications?interviewConfirmed=1");
}

// An interviewer says the call happened, without waiting for the slot to pass, so
// reports can be filed.
export async function markInterviewHeldAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await markInterviewHeld(actor, String(formData.get("arrivalId") ?? ""));
  } catch (err) {
    redirectWithError(err);
  }
  revalidatePath("/applications");
  redirect("/applications?interviewHeld=1");
}

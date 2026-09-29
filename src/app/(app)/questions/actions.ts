"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { answerProfileQuestion, getProfileQuestion } from "@/lib/profile-questions";
import { fieldValueFromFormData, toFieldShape } from "@/lib/field-shape";
import { AppError } from "@/lib/errors";

// Keeping the event in the URL rather than reading it back off the form
// is what makes the "back to the event" link and a reloaded page land on
// the same event's questions; the action only ever needs the one
// validating it below.
function redirectWithError(cycleId: string | null, err: unknown): never {
  const back = cycleId ? `?cycle=${encodeURIComponent(cycleId)}` : "";
  if (err instanceof ZodError) {
    redirect(`/questions${back}&error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/questions${back}&error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

// The three response buttons all submit under the same name, so
// getAll + an explicit order is what reads them. The form only ever
// submits one, so this is a formality — but the order has to be total
// rather than "whatever get returned first" so a future field addition
// can't silently change what a click means.
function readStatus(formData: FormData): "answered" | "deferred" | "declined" {
  const submitted = formData.getAll("status").map(String);
  if (submitted.includes("declined")) return "declined";
  if (submitted.includes("deferred")) return "deferred";
  return "answered";
}

export async function submitQuestionAnswerAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));
  const cycleId = String(formData.get("cycleId") ?? "").trim() || null;
  const status = readStatus(formData);

  try {
    // The row is read only to interpret the submitted inputs — see
    // fieldValueFromFormData, the same read the Form path uses.
    const question = await getProfileQuestion(actor, questionId);
    const value = fieldValueFromFormData(toFieldShape(question), formData, "value");

    // cycleId passes through to answerProfileQuestion, which validates it
    // against this member's own community + the open-cycle lifecycle
    // before stamping anything (submitAnswerInput.cycleId).
    await answerProfileQuestion(actor, questionId, {
      status,
      value: status === "answered" ? value : undefined,
      cycleId,
      // The audiences ticked, one id per box, and only on a sensitive
      // question — answerProfileQuestion forces sharing back to true on a
      // public one, so a stray box there can't store a claim about the
      // world that isn't true. `filter(Boolean)` drops the empty marker
      // input the form renders, which exists so that "every box unticked"
      // arrives as an empty list rather than as an absent field; absent
      // means "the whole audience", which is the opposite decision.
      shareRuleIds: question.sensitive
        ? formData.getAll("shareRuleIds").map(String).filter(Boolean)
        : undefined,
    });
  } catch (err) {
    redirectWithError(cycleId, err);
  }

  // The shell-wide required-questions banner and the sidebar badge read
  // this same data on every request, so refreshing the shell's own path
  // is what actually clears them — not just this page.
  revalidatePath("/questions");
  revalidatePath("/dashboard");
  revalidatePath("/community");
  revalidatePath("/profile");
  revalidatePath("/", "layout");
}

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";
import { firstLoginDestinationFor } from "@/lib/first-login";
import { AppError } from "@/lib/errors";

function redirectWithError(token: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/invite/${token}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// §2.6/J10's binding consent, read out of the form rather than taken on
// trust: the checkbox is `required` in the UI *and* its absence is an
// AppError in the lib, so a hand-rolled POST can't skip it. The
// disclosure text is submitted alongside the tick and stored with it, so
// the record answers "what were they told" and not merely "did they say
// yes".
export async function redeemInviteAction(formData: FormData) {
  const token = String(formData.get("token"));
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const consentAccepted = formData.get("consentAccepted") === "on";
  const disclosure = String(formData.get("disclosure") ?? "").trim() || undefined;

  let outcome;
  try {
    const input = redeemCommunityInviteInput.parse({ email, consentAccepted, disclosure });
    outcome = await redeemCommunityInvite(token, input);
  } catch (err) {
    redirectWithError(token, err);
  }

  if (outcome.kind === "admitted") {
    await createSession(outcome.memberId);
    redirect(outcome.redirectTo);
  }
  if (outcome.kind === "check") {
    // A community-check arrival: they are not a member yet, the window runs.
    // Redirect to the admission page with their token.
    redirect(`/admission/${outcome.token}?check=1`);
  }
  if (outcome.kind === "process") {
    // A process lane (application and/or interview): redirect to the admission page
    redirect(`/admission/${outcome.token}`);
  }
  if (outcome.kind === "support_shortcut") {
    // A lane with a support shortcut: show the support view
    redirect(`/support/${outcome.supportToken}`);
  }
  if (outcome.kind === "apply") {
    // They need to apply: redirect to /apply with the invite token
    redirect(`/apply?invite=${encodeURIComponent(token)}`);
  }
  // Should not reach here
  redirect(`/admission/${outcome.token}`);
}

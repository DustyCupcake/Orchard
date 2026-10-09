"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { redeemCommunityInvite, redeemCommunityInviteInput } from "@/lib/recruitment";
import { createSession } from "@/lib/session";
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
  if (outcome.kind === "apply") {
    // The lane asks for an application: the invite goes with them as the vouch.
    redirect(`/apply?invite=${encodeURIComponent(token)}`);
  }
  // A community check, or a wait for an interview: they are in the funnel but
  // not members yet, and their private page is where they follow it.
  redirect(`/admission/${outcome.token}`);
}

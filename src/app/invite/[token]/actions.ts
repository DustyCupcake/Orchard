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

  if (outcome.kind === "member") {
    await createSession(outcome.memberId);
    redirect(await firstLoginDestinationFor(outcome.memberId));
  }
  if (outcome.kind === "announced") {
    // A consensus arrival: they are a member (and get a session, because
    // they need to be able to see the community while the window runs)
    // but their place in the event is not settled, so they land on the
    // page that says so rather than the dashboard's unqualified
    // welcome. That page's own button then hands them on to /welcome if
    // they haven't been through it — same single hop, one page later.
    await createSession(outcome.memberId);
    redirect(`/invite/${token}?announced=1`);
  }
  if (outcome.kind === "awaiting_support") {
    // §2.4 — the one link, auth-branched. No session is created: there
    // is no Member yet, and the support view is exactly the right thing
    // to show somebody who is not one.
    redirect(`/support/${outcome.supportToken}`);
  }
  // `process` is unreachable here — redeemCommunityInvite throws for it —
  // but routing it to /apply is the honest fallback if that ever changes.
  redirect(`/apply?invite=${encodeURIComponent(token)}`);
}

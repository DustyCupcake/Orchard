"use server";

import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/magic-link";
import { publicAppUrl } from "@/lib/public-url";
import { getArrivalByToken, getAskedApplicationForm, submitAskedApplication, withdrawArrival } from "@/lib/recruitment";
import { formValuesFromFormData, type FormField } from "@/lib/forms";
import { AppError } from "@/lib/errors";
import { answerPairing, createApplyTogetherLink } from "@/lib/recruitment/pairs";

// Only for the address the arrival itself was admitted with, and only once it
// has been: this is the person's route from "you're in" to being signed in,
// not a general-purpose login form. The token is the credential, and the link
// goes to the arrival's own inbox — never to an address the caller supplies.
export async function sendSignInLinkAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const arrival = await getArrivalByToken(token);
  if (arrival?.admittedMemberId) {
    try {
      await requestMagicLink(arrival.email, publicAppUrl());
    } catch (err) {
      // An unreachable mail relay is an ops problem, and the answer the
      // person sees doesn't say whether it worked either way.
      console.error("[admission] could not send the sign-in link", err);
    }
  }
  redirect(`/admission/${encodeURIComponent(token)}?sent=1`);
}

export async function withdrawAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  await withdrawArrival(token);
  redirect(`/admission/${encodeURIComponent(token)}?withdrawn=1`);
}

// The application the mediation body asked for (docs/plans/admission-flow.md §5). The token
// is the credential; what the form asks for is read from the form, never from what the
// request says it is.
export async function sendAskedApplicationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = `/admission/${encodeURIComponent(token)}`;
  try {
    const arrival = await getArrivalByToken(token);
    const formRow = arrival ? await getAskedApplicationForm(arrival) : null;
    if (!formRow) throw new AppError("There's no application form to fill in right now");
    const values = formValuesFromFormData(formRow.fields as FormField[], formData);
    await submitAskedApplication(token, values);
  } catch (err) {
    if (err instanceof AppError) redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`${back}?applied=1`);
}

// docs/plans/admission-flow.md §2, "Pairing": the link the person sends to whoever they are applying
// with, made from their own page. The token is the credential.
export async function makeApplyTogetherLinkAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = `/admission/${encodeURIComponent(token)}`;
  try {
    await createApplyTogetherLink(token);
  } catch (err) {
    if (err instanceof AppError) redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(back);
}

// "Is this who you meant?" — confirming a pairing, or turning it down. Either is an answer.
export async function answerPairingAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const back = `/admission/${encodeURIComponent(token)}`;
  try {
    await answerPairing(token, String(formData.get("pairId") ?? ""), formData.get("accept") === "1");
  } catch (err) {
    if (err instanceof AppError) redirect(`${back}?error=${encodeURIComponent(err.message)}`);
    throw err;
  }
  redirect(`${back}?paired=1`);
}

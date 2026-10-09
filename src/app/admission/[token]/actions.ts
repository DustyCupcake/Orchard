"use server";

import { redirect } from "next/navigation";
import { requestMagicLink } from "@/lib/magic-link";
import { publicAppUrl } from "@/lib/public-url";
import { getArrivalByToken, withdrawArrival } from "@/lib/recruitment";

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

"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";
import {
  consentPartyToObjection,
  recuseFromObjection,
  resolveObjection,
  withdrawConsentToObjection,
  withdrawObjection,
} from "@/lib/recruitment/mediation";

async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/recruitment/mediation?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/recruitment/mediation?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// The one place a standing objection becomes a decision, and the only
// place the overrule is exercised. §2.6/J7: clearing it and upholding it
// are mediation's own conclusions and need no threshold; overruling it —
// admitting somebody *over* a concern that was not cleared — needs the
// community's configured threshold, checked in the lib, and always
// carries the note that becomes the audit record.
export async function resolveObjectionAction(formData: FormData) {
  const actor = await requireMember();
  let settled = true;
  try {
    const result = await resolveObjection(actor, {
      objectionId: String(formData.get("objectionId") ?? ""),
      outcome: String(formData.get("outcome") ?? "cleared") as "cleared" | "upheld" | "overruled",
      note: String(formData.get("note") ?? "").trim(),
    });
    // An overrule that hasn't reached the threshold records this holder's
    // support and leaves the objection standing.
    settled = result.resolution !== "standing";
  } catch (err) {
    redirectWithError(err);
  }
  redirect(settled ? "/recruitment/mediation?resolved=1" : "/recruitment/mediation?overruleSupported=1");
}

// The objector's own controls. These are the two levers §2.6 says they
// have over their own identity, and they are deliberately on the *same*
// action surface as the body resolving it: an objector who has recused
// three of the five people on the body and consented one needs to be able
// to see that state and change it, not go hunting for it.
export async function recuseFromObjectionAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await recuseFromObjection(actor, {
      objectionId: String(formData.get("objectionId") ?? ""),
      memberId: String(formData.get("memberId") ?? ""),
    });
  } catch (err) {
    redirectWithError(err);
  }
  redirect("/recruitment/mediation?recused=1");
}

export async function consentPartyToObjectionAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await consentPartyToObjection(actor, {
      objectionId: String(formData.get("objectionId") ?? ""),
      memberId: String(formData.get("memberId") ?? ""),
      note: String(formData.get("note") ?? "").trim() || null,
    });
  } catch (err) {
    redirectWithError(err);
  }
  redirect("/recruitment/mediation?consented=1");
}

export async function withdrawConsentToObjectionAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await withdrawConsentToObjection(
      actor,
      String(formData.get("objectionId") ?? ""),
      String(formData.get("memberId") ?? ""),
    );
  } catch (err) {
    redirectWithError(err);
  }
  redirect("/recruitment/mediation?consentWithdrawn=1");
}

export async function withdrawObjectionAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await withdrawObjection(actor, String(formData.get("objectionId") ?? ""));
  } catch (err) {
    redirectWithError(err);
  }
  redirect("/recruitment/mediation?withdrawn=1");
}

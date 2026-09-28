"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";
import { recordSupport, recordSupportInput, skipNomination } from "@/lib/recruitment/support";

// Phase 54 (View-as): every write goes through requireMember() below
// rather than the raw @/lib/api import directly, so a session actively
// rendering as someone else can never record a vouch in somebody else's
// name. See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(token: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/support/${token}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/support/${token}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// A supporter records *their own* marks, which is what makes the second a
// real second rather than a rubber stamp of the first. The lib refuses
// neither-mark as "saying nothing at all", so the form says the same
// thing before they press it.
export async function recordSupportAction(formData: FormData) {
  const actor = await requireMember();
  const token = String(formData.get("token") ?? "");
  try {
    const input = recordSupportInput.parse({
      token,
      knowsPersonally: formData.get("knowsPersonally") === "on",
      thinksGoodFit: formData.get("thinksGoodFit") === "on",
    });
    await recordSupport(actor, input);
  } catch (err) {
    redirectWithError(token, err);
  }
  redirect(`/support/${token}?supported=1`);
}

// §2.5/J6, the invitee's own way out. Public on purpose: the person
// using it is the one who is *not* a member, and they are holding nothing
// but this link.
//
// It redirects to /invite/<token> rather than straight to /apply, and
// that indirection is the point: where "skip the wait" actually leads
// depends on the lane's own process, and /invite is the one page that
// knows. A nomination lane with a form wants the application; one without
// a form wants the join form, and a link that always went to /apply would
// send the second kind of person to a page that says "not accepting
// applications". An application-backed nomination has nothing left to
// skip to — they've already applied — so that goes to /applications.
export async function skipNominationAction(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  let inviteToken: string | null;
  try {
    const result = await skipNomination(token);
    inviteToken = result.inviteToken;
  } catch (err) {
    redirectWithError(token, err);
  }
  redirect(inviteToken ? `/invite/${inviteToken}` : "/applications");
}

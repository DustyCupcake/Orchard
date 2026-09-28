"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { AppError } from "@/lib/errors";
import { acceptPairing, declinePairing } from "@/lib/recruitment/pairs";

async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(token: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/pair/${token}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/pair/${token}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// §2.8's accept-the-pairing link. "Same token shape" as the original
// link, which is the point: the person who named somebody gets a link
// they can open to confirm the person who arrived through it is who they
// meant. Only they can, and only after the other side has actually
// applied — a pairing nobody confirmed is a fact recorded and nothing
// more, which is exactly as much weight J9 gives it.
//
// It is a real decision with a real consequence (they'll be offered one
// shared interview), so declining is a first-class button rather than
// something you do by not clicking.
export async function answerPairingAction(formData: FormData) {
  const actor = await requireMember();
  const token = String(formData.get("token") ?? "");
  const accept = formData.get("accept") === "1";
  try {
    if (accept) {
      await acceptPairing(actor, token);
    } else {
      await declinePairing(actor, token);
    }
  } catch (err) {
    redirectWithError(token, err);
  }
  redirect(`/pair/${token}?answered=1`);
}

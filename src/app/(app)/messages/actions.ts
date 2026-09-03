"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getCurrentMember } from "@/lib/session";
import { assertNotViewingAs } from "@/lib/view-as";
import { sendOutboundMessage } from "@/lib/messages";
import { AppError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/messages?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/messages?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

async function requireMember() {
  const actor = await getCurrentMember();
  if (!actor) {
    redirect("/login");
  }
  // Phase 54 (View-as) — see src/lib/view-as.ts.
  await assertNotViewingAs();
  return actor;
}

// One shared action for all four scopes — each form on the page
// carries its own hidden `scope` field, and sendOutboundMessage's own
// zod discriminated union does the real per-scope validation, so this
// just routes formData into the right shape rather than duplicating
// four near-identical Server Actions.
export async function sendMessageAction(formData: FormData) {
  const actor = await requireMember();
  const scope = String(formData.get("scope") ?? "");
  const subject = String(formData.get("subject") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();

  try {
    if (scope === "branch") {
      await sendOutboundMessage(actor, {
        scope: "branch",
        branchId: String(formData.get("branchId") ?? ""),
        subject,
        body,
      });
    } else if (scope === "task_holders") {
      await sendOutboundMessage(actor, {
        scope: "task_holders",
        taskId: String(formData.get("taskId") ?? ""),
        subject,
        body,
      });
    } else if (scope === "arrival_window") {
      await sendOutboundMessage(actor, {
        scope: "arrival_window",
        start: String(formData.get("start") ?? ""),
        end: String(formData.get("end") ?? ""),
        subject,
        body,
      });
    } else if (scope === "community") {
      await sendOutboundMessage(actor, { scope: "community", subject, body });
    } else {
      throw new AppError("Unknown message scope");
    }
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/messages");
}

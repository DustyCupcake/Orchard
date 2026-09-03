"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  claimOrRequestToJoin,
  finishTask,
  parkTask,
  releaseTask,
  resumeTask,
  withdrawJoinRequest,
} from "@/lib/tasks";
import { AppError } from "@/lib/errors";

async function runAction(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/board?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  revalidatePath("/board");
}

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export async function claimAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => claimOrRequestToJoin(actor, taskId));
}

// "Select and claim with exceptions" — see docs/spec.md's Coordination
// mechanics: bulk task selection. Reuses the ordinary claim path per
// task rather than a separate bulk-insert, so capacity/Requirement/
// self-assign-confirmation checks all still apply individually — a
// task that needs confirmation just fails in the summary, same as any
// other per-task failure, rather than silently bypassing that check.
export async function bulkClaimAction(formData: FormData) {
  const actor = await requireMember();
  const taskIds = formData.getAll("taskIds").map(String);

  let claimed = 0;
  const failures: string[] = [];
  for (const taskId of taskIds) {
    try {
      await claimOrRequestToJoin(actor, taskId);
      claimed++;
    } catch (err) {
      if (err instanceof AppError) {
        failures.push(err.message);
      } else {
        throw err;
      }
    }
  }

  const summary =
    failures.length === 0
      ? `Claimed ${claimed} task(s).`
      : `Claimed ${claimed} task(s); ${failures.length} failed: ${failures.join("; ")}`;
  redirect(`/board?notice=${encodeURIComponent(summary)}`);
}

export async function withdrawRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));
  await runAction(() => withdrawJoinRequest(actor, taskId, requestId));
}

export async function releaseAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => releaseTask(actor, taskId));
}

export async function resumeAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => resumeTask(actor, taskId));
}

export async function finishAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => finishTask(actor, taskId));
}

export async function parkAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const nextCheckinAt = String(formData.get("nextCheckinAt"));
  const waitingNote = String(formData.get("waitingNote") ?? "");

  await runAction(() =>
    parkTask(actor, taskId, {
      nextCheckinAt: new Date(nextCheckinAt),
      waitingNote: waitingNote || undefined,
    }),
  );
}

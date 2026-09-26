"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  claimOrRequestToJoin,
  escalateTask,
  finishTask,
  finishWaitingTask,
  parkTask,
  releaseTask,
  resumeTask,
  updateTask,
  withdrawJoinRequest,
} from "@/lib/tasks";
import { exportCycleAsTaskPack } from "@/lib/task-packs";
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

function safeBoardReturnPath(value: FormDataEntryValue | null): string {
  const raw = String(value ?? "");
  if (!raw.startsWith("/board")) return "/board";
  try {
    const url = new URL(raw, "http://orchard.local");
    if (url.origin !== "http://orchard.local" || url.pathname !== "/board") return "/board";
    return `${url.pathname}${url.search}`;
  } catch {
    return "/board";
  }
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
  const returnTo = safeBoardReturnPath(formData.get("returnTo"));
  const errorHref = (message: string) => {
    const separator = returnTo.includes("?") ? "&" : "?";
    return `${returnTo}${separator}error=${encodeURIComponent(message)}`;
  };

  if (taskIds.length === 0) {
    redirect(errorHref("Select at least one task to claim."));
  }

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
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}notice=${encodeURIComponent(summary)}`);
}

// Placement edits are already a first-class task operation (the task
// detail Edit panel writes branch/cycle/phase through updateTask). The
// board's shared selection island reuses that same domain function so a
// bulk move gets the same community/phase/grant checks as an individual
// edit, while still reporting per-task failures instead of pretending a
// mixed selection moved atomically.
export async function bulkMoveTasksAction(formData: FormData) {
  const actor = await requireMember();
  const taskIds = formData.getAll("taskIds").map(String);
  const branchId = String(formData.get("branchId") ?? "").trim();
  const cycleIdRaw = String(formData.get("cycleId") ?? "").trim();
  const phaseIdRaw = String(formData.get("phaseId") ?? "").trim();

  const returnTo = safeBoardReturnPath(formData.get("returnTo"));
  const errorHref = (message: string) => {
    const separator = returnTo.includes("?") ? "&" : "?";
    return `${returnTo}${separator}error=${encodeURIComponent(message)}`;
  };

  if (taskIds.length === 0) {
    redirect(errorHref("Select at least one task to move."));
  }
  if (!branchId && !cycleIdRaw && !phaseIdRaw) {
    redirect(errorHref("Choose a destination branch, event, or phase."));
  }

  const input = {
    ...(branchId ? { branchId } : {}),
    ...(cycleIdRaw ? { cycleId: cycleIdRaw === "__none__" ? null : cycleIdRaw } : {}),
    ...(phaseIdRaw ? { phaseId: phaseIdRaw === "__none__" ? null : phaseIdRaw } : {}),
  };

  let moved = 0;
  const failures: string[] = [];
  for (const taskId of taskIds) {
    try {
      // updateTask normalizes an incompatible phase while it resolves a
      // cycle move. Pass a fresh object per item so one task's
      // normalization cannot leak into the next task in the batch.
      await updateTask(actor, taskId, { ...input });
      moved++;
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
      ? `Moved ${moved} task(s).`
      : `Moved ${moved} task(s); ${failures.length} failed: ${failures.join("; ")}`;
  const separator = returnTo.includes("?") ? "&" : "?";
  redirect(`${returnTo}${separator}notice=${encodeURIComponent(summary)}`);
}

// The board's own bulk-selection mechanism, reused for a partial
// export rather than a claim — see docs/development-plan.md's Phase
// 55 ("the current cycle, or a hand-picked task subset via the
// board's existing bulk-selection mechanism").
export async function exportSelectedTasksAsPackAction(formData: FormData) {
  const actor = await requireMember();
  const cycleId = String(formData.get("cycleId"));
  const name = String(formData.get("name") ?? "").trim();
  const taskIds = formData.getAll("taskIds").map(String);
  const returnTo = safeBoardReturnPath(formData.get("returnTo"));
  const errorHref = (message: string) => {
    const separator = returnTo.includes("?") ? "&" : "?";
    return `${returnTo}${separator}error=${encodeURIComponent(message)}`;
  };

  // The board action is the hand-picked subset path. The library treats
  // an empty list as "export the whole cycle", which would turn a user
  // mistake (an empty selection) into an unexpectedly broad export.
  if (taskIds.length === 0) {
    redirect(errorHref("Select at least one task to export."));
  }

  let packId: string;
  try {
    const created = await exportCycleAsTaskPack(actor, cycleId, { name, taskIds });
    packId = created.id;
  } catch (err) {
    if (err instanceof AppError) {
      redirect(errorHref(err.message));
    }
    throw err;
  }

  redirect(`/task-packs?exported=${packId}`);
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

// docs/development-plan.md's Phase 56 — "a Done confirmation gains a
// 'you might also like' strip." No separate confirmation screen exists
// (finishing already just redirects back to the board, same as every
// other lifecycle action here) — reusing that same redirect-with-query
// pattern (bulkClaimAction's own `notice=`, Task Packs' `exported=`) is
// the ephemeral, no-new-schema way to carry "which task just finished"
// across the redirect for board/page.tsx's strip to read.
export async function finishAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await finishTask(actor, taskId);
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/board?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/board?done=${taskId}`);
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

export async function escalateTaskAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  await runAction(() => escalateTask(actor, taskId));
}

// "Mark done" straight from Waiting — one of the four spec'd nudge
// options, surfaced in the card's overflow menu so it doesn't need a
// Resume-first detour. Same done-redirect as finishAction so the
// "you might also like" strip still fires.
export async function finishWaitingAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await finishWaitingTask(actor, taskId);
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/board?error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(`/board?done=${taskId}`);
}

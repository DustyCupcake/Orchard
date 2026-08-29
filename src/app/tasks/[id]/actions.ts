"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  acceptJoinRequest,
  addComment,
  addCommentInput,
  addResource,
  addResourceInput,
  addWikiRevision,
  addWikiRevisionInput,
  claimAsShadow,
  claimOrRequestToJoin,
  createSignal,
  createSignalInput,
  declineJoinRequest,
  endorseCandidacy,
  expressCandidacy,
  pingCoordinator,
  releaseTask,
  resolvePing,
  resolveSignal,
  setOutgoing,
  splitSubtask,
  splitSubtaskInput,
  suggestMemberForTask,
  waiveAndClaim,
  waiveAndClaimInput,
  withdrawCandidacy,
  withdrawJoinRequest,
} from "@/lib/tasks";
import { createQuestion, createQuestionInput } from "@/lib/input-rounds";
import { rotateTaskIntoShift } from "@/lib/shifts";
import { AppError } from "@/lib/errors";

function redirectWithError(taskId: string, err: unknown): never {
  if (err instanceof ZodError) {
    redirect(
      `/tasks/${taskId}?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`,
    );
  }
  if (err instanceof AppError) {
    redirect(`/tasks/${taskId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function editWikiAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addWikiRevisionInput.parse({ content: String(formData.get("content") ?? "") });
    await addWikiRevision(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function addCommentAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addCommentInput.parse({ body: String(formData.get("body") ?? "") });
    await addComment(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function addResourceAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = addResourceInput.parse({
      label: String(formData.get("label") ?? ""),
      url: String(formData.get("url") ?? ""),
      tag: String(formData.get("tag") ?? "") || undefined,
    });
    await addResource(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function splitSubtaskAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  const effort = String(formData.get("effort"));
  const duration = String(formData.get("duration") ?? "");
  const hoursPerWeekRaw = String(formData.get("hoursPerWeek") ?? "");
  const effortMagnitude =
    effort === "one_off"
      ? { duration: duration || "few_hours" }
      : { hours_per_week: Number(hoursPerWeekRaw) || 1 };

  const capacityRaw = String(formData.get("capacity") ?? "");
  const branchId = String(formData.get("branchId") ?? "") || undefined;

  let created;
  try {
    const input = splitSubtaskInput.parse({
      branchId,
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? ""),
      effort,
      effortMagnitude,
      capacity: capacityRaw ? Number(capacityRaw) : undefined,
      critical: formData.get("critical") === "on",
    });
    created = await splitSubtask(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  redirect(`/tasks/${created.id}`);
}

// Any current holder, enforced inside rotateTaskIntoShift — a
// one-click action, no form fields of its own. The original Task is
// left untouched; this just starts a new ShiftSeries.
export async function rotateIntoShiftAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await rotateTaskIntoShift(actor, taskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  redirect("/shifts?seriesCreated=1");
}

export async function acceptJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));

  try {
    await acceptJoinRequest(actor, taskId, requestId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function declineJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));
  const reason = String(formData.get("reason") ?? "") || null;

  try {
    await declineJoinRequest(actor, taskId, requestId, { reason });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function withdrawJoinRequestAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requestId = String(formData.get("requestId"));

  try {
    await withdrawJoinRequest(actor, taskId, requestId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function expressCandidacyAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await expressCandidacy(actor, taskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function endorseCandidacyAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const candidacyId = String(formData.get("candidacyId"));

  try {
    await endorseCandidacy(actor, taskId, candidacyId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function withdrawCandidacyAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const candidacyId = String(formData.get("candidacyId"));

  try {
    await withdrawCandidacy(actor, taskId, candidacyId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function claimAsShadowAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await claimAsShadow(actor, taskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function stopShadowingAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await releaseTask(actor, taskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function setOutgoingAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const outgoing = formData.get("outgoing") === "true";

  try {
    await setOutgoing(actor, taskId, outgoing);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

// Self-assign confirmation check — see docs/spec.md's Coordination
// mechanics. The three options spec lists: really want it myself
// (confirmClaimAction, below), suggest a person instead
// (suggestSomeoneAction), or flag for the group (flagForGroupAction,
// which reuses the anonymous task signal mechanism rather than
// inventing a fourth one).
export async function confirmClaimAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await claimOrRequestToJoin(actor, taskId, { confirmed: true });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function suggestSomeoneAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const memberId = String(formData.get("memberId") ?? "");

  try {
    if (!memberId) throw new AppError("Choose someone to suggest");
    await suggestMemberForTask(actor, taskId, memberId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function flagForGroupAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await createSignal(actor, taskId, { kind: "might_need_help" });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function waiveAndClaimAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = waiveAndClaimInput.parse({
      memberId: String(formData.get("memberId") ?? ""),
      reason: String(formData.get("reason") ?? ""),
    });
    await waiveAndClaim(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
}

export async function createSignalAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = createSignalInput.parse({ kind: String(formData.get("kind") ?? "") });
    await createSignal(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function resolveSignalAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const signalId = String(formData.get("signalId"));

  try {
    await resolveSignal(actor, taskId, signalId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function pingCoordinatorAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await pingCoordinator(actor, taskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function resolvePingAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const pingId = String(formData.get("pingId"));

  try {
    await resolvePing(actor, taskId, pingId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function createQuestionAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const responseType = String(formData.get("responseType") ?? "free_text");
    const options = String(formData.get("options") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const deadline = String(formData.get("deadline") ?? "").trim();
    const input = createQuestionInput.parse({
      text: String(formData.get("text") ?? ""),
      responseType,
      options: options.length > 0 ? options : undefined,
      deadline: deadline ? new Date(deadline).toISOString() : undefined,
      priority: formData.get("priority") === "on",
    });
    await createQuestion(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

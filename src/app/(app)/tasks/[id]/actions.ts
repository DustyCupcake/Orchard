"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  acceptJoinRequest,
  addComment,
  addCommentInput,
  addResource,
  addResourceInput,
  addTaskDependency,
  addWikiRevision,
  addWikiRevisionInput,
  claimAsShadow,
  claimOrRequestToJoin,
  confirmTaskMilestone,
  createRequirement,
  createRequirementInput,
  createSignal,
  createSignalInput,
  createTaskMilestone,
  declineJoinRequest,
  deleteRequirement,
  deleteTaskMilestone,
  endorseCandidacy,
  expressCandidacy,
  nominateForTask,
  nominateForTaskInput,
  pingCoordinator,
  releaseTask,
  removeTaskDependency,
  resolvePing,
  resolveSignal,
  setOutgoing,
  splitSubtask,
  splitSubtaskInput,
  suggestMemberForTask,
  updateRequirement,
  updateRequirementInput,
  updateTaskMilestone,
  waiveAndClaim,
  waiveAndClaimInput,
  withdrawCandidacy,
  withdrawJoinRequest,
  type MilestoneDateInput,
} from "@/lib/tasks";
import { createQuestion, createQuestionInput } from "@/lib/input-rounds";
import { rotateTaskIntoShift } from "@/lib/shifts";
import { requireAdmins } from "@/lib/settings";
import {
  addPermissionGrant,
  allowsMultipleGrants,
  listModuleKeysGrantedByTask,
  PERMISSION_MODULE_KEYS,
  removePermissionGrant,
  setPermissionGrant,
} from "@/lib/permissions";
import { AppError } from "@/lib/errors";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";

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

// Reads one milestone's date fields off the submitted form — see
// src/app/tasks/[id]/page.tsx's MilestoneDateFields, which renders
// exactly this shape. Mirrors src/app/participation/actions.ts's own
// boundaryFromForm, generalized to the 4-way phase-or-cycle anchor and
// an optional phaseId override.
function milestoneDateFromForm(formData: FormData): MilestoneDateInput {
  const mode = String(formData.get("dateMode") ?? "absolute");
  if (mode === "absolute") {
    return { type: "absolute", date: String(formData.get("absoluteDate") ?? "").trim() };
  }

  const anchor = String(formData.get("anchor") ?? "cycle_start") as
    | "phase_start"
    | "phase_end"
    | "cycle_start"
    | "cycle_end";
  const phaseId = String(formData.get("milestonePhaseId") ?? "").trim() || null;
  const targetDate = String(formData.get("targetDate") ?? "").trim();

  if (mode === "relative_offset") {
    if (targetDate) return { type: "relative_offset", anchor, phaseId, targetDate };
    const offsetDaysRaw = String(formData.get("offsetDays") ?? "").trim();
    return { type: "relative_offset", anchor, phaseId, offsetDays: offsetDaysRaw ? Number(offsetDaysRaw) : 0 };
  }
  if (targetDate) return { type: "relative_percent", anchor, phaseId, targetDate };
  const percentRaw = String(formData.get("percent") ?? "").trim();
  return { type: "relative_percent", anchor, phaseId, percent: percentRaw ? Number(percentRaw) : 0 };
}

export async function addMilestoneAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    await createTaskMilestone(actor, taskId, {
      label: String(formData.get("label") ?? ""),
      date: milestoneDateFromForm(formData),
    });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function updateMilestoneAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const milestoneId = String(formData.get("milestoneId"));

  try {
    await updateTaskMilestone(actor, milestoneId, {
      label: String(formData.get("label") ?? ""),
      date: milestoneDateFromForm(formData),
    });
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

// Also how a holder rejects a still-pending proposal — see
// deleteTaskMilestone's own comment.
export async function deleteMilestoneAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const milestoneId = String(formData.get("milestoneId"));

  try {
    await deleteTaskMilestone(actor, milestoneId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function confirmMilestoneAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const milestoneId = String(formData.get("milestoneId"));

  try {
    await confirmTaskMilestone(actor, milestoneId);
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

export async function nominateForTaskAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const input = nominateForTaskInput.parse({
      memberId: String(formData.get("memberId") ?? ""),
      message: String(formData.get("message") ?? "").trim() || null,
    });
    const appUrl = await resolveAppUrlFromHeaders();
    await nominateForTask(actor, taskId, input, appUrl);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/board");
  revalidatePath("/dashboard");
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

// Shared by add/update — builds the one value key a given type actually
// needs from whichever of the form's four (type-specific) fields was
// filled in, matching createRequirementInput/updateRequirementInput's
// own superRefine (see src/lib/tasks/requirements.ts).
function requirementValueFromFormData(type: string, formData: FormData): Record<string, unknown> {
  switch (type) {
    case "tier":
      return { tierId: String(formData.get("requirementTierId") ?? "") };
    case "language":
      return { language: String(formData.get("requirementLanguage") ?? "") };
    case "completed_task":
      return { taskId: String(formData.get("requirementCompletedTaskId") ?? "") };
    default:
      return { flag: String(formData.get("requirementFlag") ?? "") };
  }
}

export async function addRequirementAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));

  try {
    const type = String(formData.get("requirementType") ?? "");
    const mode = String(formData.get("requirementMode") ?? "individual_gate");
    const input = createRequirementInput.parse({
      type,
      mode,
      value: requirementValueFromFormData(type, formData),
    });
    await createRequirement(actor, taskId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function updateRequirementAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requirementId = String(formData.get("requirementId"));

  try {
    const type = String(formData.get("requirementType") ?? "");
    const input = updateRequirementInput.parse({
      value: requirementValueFromFormData(type, formData),
    });
    await updateRequirement(actor, taskId, requirementId, input);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function deleteRequirementAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const requirementId = String(formData.get("requirementId"));

  try {
    await deleteRequirement(actor, taskId, requirementId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function addDependencyAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const dependsOnTaskIds = formData
    .getAll("dependsOnTaskIds")
    .map(String)
    .filter(Boolean);

  try {
    for (const dependsOnTaskId of dependsOnTaskIds) {
      await addTaskDependency(actor, taskId, dependsOnTaskId);
    }
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

export async function removeDependencyAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const dependsOnTaskId = String(formData.get("dependsOnTaskId"));

  try {
    await removeTaskDependency(actor, taskId, dependsOnTaskId);
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
}

// The task-side entry point onto the exact same PermissionGrant rows
// the settings panel's Access & permissions tab edits
// (docs/development-plan.md's Phase 64) — one code path
// (setPermissionGrant/addPermissionGrant/removePermissionGrant), two
// entry points, never two sources of truth. Admin-gated here too
// (requireAdmins), a genuinely stricter check than the rest of this
// file's own actions — the page only renders these checkboxes for an
// Admin in the first place, but this re-checks server-side regardless,
// since a forged POST could otherwise reach this code path without
// ever seeing the UI. Diffs against a fresh DB read of what this task
// currently grants (never the form's own stale render-time snapshot)
// so a concurrent change elsewhere can't get silently clobbered.
export async function updateTaskPermissionGrantsAction(formData: FormData) {
  const actor = await requireMember();
  const taskId = String(formData.get("taskId"));
  const selectedModuleKeys = new Set(formData.getAll("moduleKeys").map(String));

  try {
    await requireAdmins(actor);
    const currentModuleKeys = await listModuleKeysGrantedByTask(actor.communityId, taskId);
    for (const moduleKey of PERMISSION_MODULE_KEYS) {
      const selected = selectedModuleKeys.has(moduleKey);
      const current = currentModuleKeys.has(moduleKey);
      if (selected && !current) {
        if (allowsMultipleGrants(moduleKey)) {
          await addPermissionGrant(actor.communityId, moduleKey, taskId);
        } else {
          await setPermissionGrant(actor.communityId, moduleKey, taskId);
        }
      } else if (!selected && current) {
        if (allowsMultipleGrants(moduleKey)) {
          await removePermissionGrant(actor.communityId, moduleKey, taskId);
        } else {
          await setPermissionGrant(actor.communityId, moduleKey, null);
        }
      }
    }
  } catch (err) {
    redirectWithError(taskId, err);
  }

  revalidatePath(`/tasks/${taskId}`);
  revalidatePath("/settings");
}

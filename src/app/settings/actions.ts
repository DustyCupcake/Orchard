"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  createBranch,
  createBranchInput,
  createTier,
  createTierInput,
  deleteBranch,
  deleteTier,
  requireAdmins,
  updateBranch,
  updateBranchInput,
  updateCommunity,
  updateCommunityInput,
  updateTier,
  updateTierInput,
} from "@/lib/settings";
import {
  archiveProfileQuestion,
  createProfileQuestion,
  createProfileQuestionInput,
  unarchiveProfileQuestion,
  updateProfileQuestion,
  updateProfileQuestionInput,
} from "@/lib/profile-questions";
import {
  createSensitiveFieldAccessRule,
  createSensitiveFieldAccessRuleInput,
  deleteSensitiveFieldAccessRule,
} from "@/lib/sensitive-data";
import { archiveForm, createForm, createFormInput, unarchiveForm } from "@/lib/forms";
import { AppError } from "@/lib/errors";

// Fields are entered one per line in a plain textarea rather than a
// dynamic add-row UI (this codebase has no client-side JS beyond
// Scheduling polls' one deliberate exception) — matches spec's own
// "MVP forms are hardcoded per use" framing; a no-code field builder
// is explicitly out of scope. Format: key|label|response_type|options
// (comma-separated, choice types only)|required (yes/no).
function parseFormFields(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, responseType, options, required] = line.split("|").map((p) => p?.trim() ?? "");
      return {
        key,
        label,
        responseType: (responseType || "free_text") as "free_text" | "single_choice" | "multi_choice",
        options: options ? options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
        required: required?.toLowerCase() === "yes",
      };
    });
}

function triState(value: FormDataEntryValue | null): boolean | null | undefined {
  if (value === "on") return true;
  if (value === "off") return false;
  if (value === "inherit") return null;
  return undefined;
}

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/settings?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/settings?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

export async function updateCommunityAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      name: String(formData.get("name") ?? "").trim() || undefined,
      cyclesEnabled: formData.get("cyclesEnabled") === "on",
      phasesEnabled: formData.get("phasesEnabled") === "on",
      cycleInitiationTierId: String(formData.get("cycleInitiationTierId") ?? "") || null,
      adminsTag: String(formData.get("adminsTag") ?? "").trim() || undefined,
      coordinationTag: String(formData.get("coordinationTag") ?? "").trim() || undefined,
      defaultCallHasAgenda: formData.get("defaultCallHasAgenda") === "on",
      defaultCallNeedsSummary: formData.get("defaultCallNeedsSummary") === "on",
      defaultCallRequireRead: formData.get("defaultCallRequireRead") === "on",
      conflictTeamTaskId: String(formData.get("conflictTeamTaskId") ?? "").trim() || null,
      conflictAckWindowHours: Number(formData.get("conflictAckWindowHours") ?? NaN) || undefined,
      modulesEnabled: formData.getAll("modulesEnabled").map(String),
      postCycleFeedbackFormId: String(formData.get("postCycleFeedbackFormId") ?? "").trim() || null,
      feedbackReviewTaskId: String(formData.get("feedbackReviewTaskId") ?? "").trim() || null,
      eventSchedulingOwnerTaskId: String(formData.get("eventSchedulingOwnerTaskId") ?? "").trim() || null,
      recruitmentTaskId: String(formData.get("recruitmentTaskId") ?? "").trim() || null,
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function createBranchAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = createBranchInput.parse({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
    });
    await createBranch(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function updateBranchAction(formData: FormData) {
  const actor = await requireMember();
  const branchId = String(formData.get("branchId"));

  try {
    await requireAdmins(actor);
    const input = updateBranchInput.parse({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? "") || undefined,
      defaultCallHasAgenda: triState(formData.get("defaultCallHasAgenda")),
      defaultCallNeedsSummary: triState(formData.get("defaultCallNeedsSummary")),
      defaultCallRequireRead: triState(formData.get("defaultCallRequireRead")),
    });
    await updateBranch(actor, branchId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function deleteBranchAction(formData: FormData) {
  const actor = await requireMember();
  const branchId = String(formData.get("branchId"));

  try {
    await requireAdmins(actor);
    await deleteBranch(actor, branchId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function createTierAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = createTierInput.parse({
      name: String(formData.get("name") ?? ""),
      criterionType: String(formData.get("criterionType") ?? "manual"),
    });
    await createTier(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function updateTierAction(formData: FormData) {
  const actor = await requireMember();
  const tierId = String(formData.get("tierId"));

  try {
    await requireAdmins(actor);
    const input = updateTierInput.parse({ name: String(formData.get("name") ?? "") });
    await updateTier(actor, tierId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function deleteTierAction(formData: FormData) {
  const actor = await requireMember();
  const tierId = String(formData.get("tierId"));

  try {
    await requireAdmins(actor);
    await deleteTier(actor, tierId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function createProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const scope = String(formData.get("scope") ?? "once_ever");
    const options = String(formData.get("options") ?? "")
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const input = createProfileQuestionInput.parse({
      label: String(formData.get("label") ?? ""),
      responseType: String(formData.get("responseType") ?? "free_text"),
      options: options.length > 0 ? options : undefined,
      scope,
      phaseNameHint:
        scope === "phase" ? String(formData.get("phaseNameHint") ?? "").trim() || undefined : undefined,
      required: formData.get("required") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
    });
    await createProfileQuestion(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function updateProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));

  try {
    await requireAdmins(actor);
    const input = updateProfileQuestionInput.parse({
      label: String(formData.get("label") ?? "") || undefined,
      required: formData.get("required") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
    });
    await updateProfileQuestion(actor, questionId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function archiveProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));

  try {
    await requireAdmins(actor);
    await archiveProfileQuestion(actor, questionId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function unarchiveProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));

  try {
    await requireAdmins(actor);
    await unarchiveProfileQuestion(actor, questionId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function createSensitiveFieldAccessRuleAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = createSensitiveFieldAccessRuleInput.parse({
      fieldKey: String(formData.get("fieldKey") ?? ""),
      unlockedByTaskId: String(formData.get("unlockedByTaskId") ?? "").trim() || null,
      unlockedByTierId: String(formData.get("unlockedByTierId") ?? "").trim() || null,
    });
    await createSensitiveFieldAccessRule(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function deleteSensitiveFieldAccessRuleAction(formData: FormData) {
  const actor = await requireMember();
  const ruleId = String(formData.get("ruleId"));

  try {
    await requireAdmins(actor);
    await deleteSensitiveFieldAccessRule(actor, ruleId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function createFormAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = createFormInput.parse({
      title: String(formData.get("title") ?? ""),
      description: String(formData.get("description") ?? "").trim() || undefined,
      fields: parseFormFields(String(formData.get("fieldsRaw") ?? "")),
      allowAnonymous: formData.get("allowAnonymous") === "on",
    });
    await createForm(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function archiveFormAction(formData: FormData) {
  const actor = await requireMember();
  const formId = String(formData.get("formId"));

  try {
    await requireAdmins(actor);
    await archiveForm(actor, formId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function unarchiveFormAction(formData: FormData) {
  const actor = await requireMember();
  const formId = String(formData.get("formId"));

  try {
    await requireAdmins(actor);
    await unarchiveForm(actor, formId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

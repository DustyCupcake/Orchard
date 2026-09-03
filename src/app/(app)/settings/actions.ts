"use server";

import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import {
  createBranch,
  createBranchInput,
  createCycleType,
  createCycleTypeInput,
  createTier,
  createTierInput,
  deleteBranch,
  deleteCycleType,
  deleteTier,
  requireAdmins,
  updateBranch,
  updateBranchInput,
  updateCommunity,
  updateCommunityInput,
  updateCycleType,
  updateCycleTypeInput,
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
import { createConsentPurpose, createConsentPurposeInput, deleteConsentPurpose } from "@/lib/consent";
import { AppError } from "@/lib/errors";

// Fields are entered one per line in a plain textarea rather than a
// dynamic add-row UI (this codebase has no client-side JS beyond
// Scheduling polls' one deliberate exception) — matches spec's own
// "MVP forms are hardcoded per use" framing; a no-code field builder
// is explicitly out of scope. Format: key|label|response_type|options
// (comma-separated, choice types only)|required (yes/no)|role. `role`
// is optional and only meaningful for a form a later step might need
// to convert into a real person (Recruitment's own application form —
// see docs/development-plan.md's Phase 48) — `name` or `email` tags
// that one field as isNameField/isEmailField (src/lib/forms.ts);
// blank/anything else leaves both unset, same as before this segment
// existed.
function parseFormFields(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, label, responseType, options, required, role] = line.split("|").map((p) => p?.trim() ?? "");
      const normalizedRole = role?.toLowerCase();
      return {
        key,
        label,
        responseType: (responseType || "free_text") as "free_text" | "single_choice" | "multi_choice",
        options: options ? options.split(",").map((o) => o.trim()).filter(Boolean) : undefined,
        required: required?.toLowerCase() === "yes",
        isNameField: normalizedRole === "name" || undefined,
        isEmailField: normalizedRole === "email" || undefined,
      };
    });
}

// Raw JSON, not a dynamic rule-builder UI — same "plain text config,
// no client-side JS" posture parseFormFields already takes, but the
// nested {conditions, outcome}[] shape doesn't fit a flat pipe-
// delimited line the way Form fields do.
function parseDecisionRules(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AppError("Decision rules must be valid JSON");
  }
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
      taskNominationResponseDays:
        Number(formData.get("taskNominationResponseDays") ?? NaN) || undefined,
      engagementSoftFlagThreshold:
        Number(formData.get("engagementSoftFlagThreshold") ?? NaN) || undefined,
      engagementPatternThreshold:
        Number(formData.get("engagementPatternThreshold") ?? NaN) || undefined,
      callSummaryReadWindowDays:
        Number(formData.get("callSummaryReadWindowDays") ?? NaN) || undefined,
      modulesEnabled: formData.getAll("modulesEnabled").map(String),
      postCycleFeedbackFormId: String(formData.get("postCycleFeedbackFormId") ?? "").trim() || null,
      feedbackReviewTaskId: String(formData.get("feedbackReviewTaskId") ?? "").trim() || null,
      eventSchedulingOwnerTaskId: String(formData.get("eventSchedulingOwnerTaskId") ?? "").trim() || null,
      recruitmentTaskId: String(formData.get("recruitmentTaskId") ?? "").trim() || null,
      recruitmentApplicationFormId: String(formData.get("recruitmentApplicationFormId") ?? "").trim() || null,
      recruitmentEvaluatorCount: Number(formData.get("recruitmentEvaluatorCount") ?? NaN) || undefined,
      recruitmentDecisionRules: parseDecisionRules(String(formData.get("recruitmentDecisionRulesRaw") ?? "")),
      recruitmentSubscriptionLapseThreshold:
        Number(formData.get("recruitmentSubscriptionLapseThreshold") ?? NaN) || undefined,
      recruitmentWiderDiscussionHours: Number(formData.get("recruitmentWiderDiscussionHours") ?? NaN) || undefined,
      recruitmentRejectionTemplate: String(formData.get("recruitmentRejectionTemplate") ?? "").trim() || null,
      spatialPlanningTaskId: String(formData.get("spatialPlanningTaskId") ?? "").trim() || null,
      announcementTaskId: String(formData.get("announcementTaskId") ?? "").trim() || null,
      onsiteModeEnabled: formData.get("onsiteModeEnabled") === "on",
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

// Only meaningful when criterionType is (or already is) cycle_type_count
// — see src/lib/settings/tiers.ts's requireValidCriterionConfig, which
// re-validates this shape regardless of what's built here.
function criterionConfigFromForm(formData: FormData): Record<string, unknown> | undefined {
  const cycleTypeId = String(formData.get("cycleTypeId") ?? "").trim();
  const minCountRaw = String(formData.get("minCount") ?? "").trim();
  if (!cycleTypeId && !minCountRaw) return undefined;
  return { cycleTypeId, minCount: minCountRaw ? Number(minCountRaw) : undefined };
}

export async function createTierAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = createTierInput.parse({
      name: String(formData.get("name") ?? ""),
      criterionType: String(formData.get("criterionType") ?? "manual"),
      criterionConfig: criterionConfigFromForm(formData),
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
    const input = updateTierInput.parse({
      name: String(formData.get("name") ?? ""),
      criterionConfig: criterionConfigFromForm(formData),
    });
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

export async function createCycleTypeAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const defaultSourceCycleId = String(formData.get("defaultSourceCycleId") ?? "").trim();
    const input = createCycleTypeInput.parse({
      name: String(formData.get("name") ?? ""),
      defaultSourceCycleId: defaultSourceCycleId || null,
    });
    await createCycleType(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function updateCycleTypeAction(formData: FormData) {
  const actor = await requireMember();
  const cycleTypeId = String(formData.get("cycleTypeId"));

  try {
    await requireAdmins(actor);
    const defaultSourceCycleId = String(formData.get("defaultSourceCycleId") ?? "").trim();
    const input = updateCycleTypeInput.parse({
      name: String(formData.get("name") ?? ""),
      defaultSourceCycleId: defaultSourceCycleId || null,
    });
    await updateCycleType(actor, cycleTypeId, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function deleteCycleTypeAction(formData: FormData) {
  const actor = await requireMember();
  const cycleTypeId = String(formData.get("cycleTypeId"));

  try {
    await requireAdmins(actor);
    await deleteCycleType(actor, cycleTypeId);
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

export async function createConsentPurposeAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const gatesSensitiveField = String(formData.get("gatesSensitiveField") ?? "").trim();
    const input = createConsentPurposeInput.parse({
      key: String(formData.get("key") ?? "").trim(),
      label: String(formData.get("label") ?? "").trim(),
      noticeText: String(formData.get("noticeText") ?? "").trim(),
      requiresExplicit: formData.get("requiresExplicit") === "on",
      gatesSensitiveField: gatesSensitiveField || null,
    });
    await createConsentPurpose(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

export async function deleteConsentPurposeAction(formData: FormData) {
  const actor = await requireMember();
  const purposeId = String(formData.get("purposeId"));

  try {
    await requireAdmins(actor);
    await deleteConsentPurpose(actor, purposeId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/settings");
}

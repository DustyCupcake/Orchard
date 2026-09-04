"use server";

import { z, ZodError } from "zod";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { task } from "@/db/schema";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  addPermissionGrant,
  PERMISSION_MODULE_KEYS,
  removePermissionGrant,
  setPermissionGrant,
} from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import {
  commitBulkMemberImport,
  confirmPendingBranch,
  createBranch,
  createBranchInput,
  createCycleType,
  createCycleTypeInput,
  createTier,
  createTierInput,
  deleteBranch,
  deleteCycleType,
  deleteTier,
  parseBulkMemberRows,
  previewBulkMemberImport,
  rejectPendingBranch,
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
import { decodeBulkMemberState, encodeBulkMemberState } from "./bulk-members-state";
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
import { archiveForm, createForm, createFormInput, unarchiveForm, updateForm, updateFormInput } from "@/lib/forms";
import { createConsentPurpose, createConsentPurposeInput, deleteConsentPurpose } from "@/lib/consent";
import { AppError } from "@/lib/errors";

// Fields arrive as a JSON blob from the real field-builder client
// component (docs/development-plan.md's Phase 58 —
// src/app/(app)/settings/FormBuilder.tsx) rather than a hand-typed
// pipe-delimited textarea — the no-code builder that phase names is
// this JSON payload's only producer, never something an admin types
// directly.
function parseFieldsJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid fields payload");
  }
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

// `tab` re-selects the same tab the erroring form was submitted from —
// without it, an error would silently bounce back to the default tab,
// losing whatever the admin was looking at. Each call site below hard-
// codes its own tab name rather than reading a hidden form field, since
// every action already belongs to exactly one tab statically.
function redirectWithError(err: unknown, tab?: string): never {
  const suffix = tab ? `&tab=${tab}` : "";
  if (err instanceof ZodError) {
    redirect(`/settings?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}${suffix}`);
  }
  if (err instanceof AppError) {
    redirect(`/settings?error=${encodeURIComponent(err.message)}${suffix}`);
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

// Community settings used to be one form/one action covering every
// field below across four now-separate tabs. Split into four scoped
// actions (General/Coordination/Modules/Recruitment) so each tab's
// form only ever submits, and only ever needs to know about, its own
// fields — critically, submitting one tab can never blank out a
// checkbox or list that belongs to a different tab's own form, since
// updateCommunityInput's fields are all optional and each action here
// only supplies its own subset (an omitted key, not a false/empty
// value). updateCommunity()/updateCommunityInput themselves are
// untouched — still one shared lib function and schema, since the
// on-site-mode lock check inside updateCommunity() needs to keep
// running for every one of these regardless of which tab triggered it.

export async function updateGeneralSettingsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      name: String(formData.get("name") ?? "").trim() || undefined,
      cyclesEnabled: formData.get("cyclesEnabled") === "on",
      phasesEnabled: formData.get("phasesEnabled") === "on",
      cycleInitiationTierId: String(formData.get("cycleInitiationTierId") ?? "") || null,
      defaultCallHasAgenda: formData.get("defaultCallHasAgenda") === "on",
      defaultCallNeedsSummary: formData.get("defaultCallNeedsSummary") === "on",
      defaultCallRequireRead: formData.get("defaultCallRequireRead") === "on",
      onsiteModeEnabled: formData.get("onsiteModeEnabled") === "on",
      accentPrimary: String(formData.get("accentPrimary") ?? "").trim() || null,
      accentSecondary: String(formData.get("accentSecondary") ?? "").trim() || null,
      logoUrl: String(formData.get("logoUrl") ?? "").trim() || null,
      oidcIssuerUrl: String(formData.get("oidcIssuerUrl") ?? "").trim() || null,
      oidcClientId: String(formData.get("oidcClientId") ?? "").trim() || null,
      oidcRequiredRole: String(formData.get("oidcRequiredRole") ?? "").trim() || null,
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "general");
  }

  revalidatePath("/settings");
}

export async function updateCoordinationSettingsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      conflictAckWindowHours: Number(formData.get("conflictAckWindowHours") ?? NaN) || undefined,
      taskNominationResponseDays:
        Number(formData.get("taskNominationResponseDays") ?? NaN) || undefined,
      engagementSoftFlagThreshold:
        Number(formData.get("engagementSoftFlagThreshold") ?? NaN) || undefined,
      engagementPatternThreshold:
        Number(formData.get("engagementPatternThreshold") ?? NaN) || undefined,
      callSummaryReadWindowDays:
        Number(formData.get("callSummaryReadWindowDays") ?? NaN) || undefined,
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "coordination");
  }

  revalidatePath("/settings");
}

export async function updateModulesSettingsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      modulesEnabled: formData.getAll("modulesEnabled").map(String),
      postCycleFeedbackFormId: String(formData.get("postCycleFeedbackFormId") ?? "").trim() || null,
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "modules");
  }

  revalidatePath("/settings");
}

export async function updateRecruitmentSettingsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      recruitmentApplicationFormId: String(formData.get("recruitmentApplicationFormId") ?? "").trim() || null,
      recruitmentEvaluatorCount: Number(formData.get("recruitmentEvaluatorCount") ?? NaN) || undefined,
      recruitmentDecisionRules: parseDecisionRules(String(formData.get("recruitmentDecisionRulesRaw") ?? "")),
      recruitmentSubscriptionLapseThreshold:
        Number(formData.get("recruitmentSubscriptionLapseThreshold") ?? NaN) || undefined,
      recruitmentWiderDiscussionHours: Number(formData.get("recruitmentWiderDiscussionHours") ?? NaN) || undefined,
      recruitmentRejectionTemplate: String(formData.get("recruitmentRejectionTemplate") ?? "").trim() || null,
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }

  revalidatePath("/settings");
}

const permissionGrantFields = z.object({
  moduleKey: z.enum(PERMISSION_MODULE_KEYS),
  taskId: z.string().uuid(),
});

async function requireTaskInActorCommunity(taskId: string, communityId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task not found in your community");
  }
}

// Single-cardinality modules (conflict_team, feedback_review,
// event_scheduling_owner, recruitment, spatial_planning, announcements)
// — sets (or, with an empty taskId, clears) the one task granting this
// module, replacing whatever previously granted it. Every one of these
// six previously had its own bespoke Community column/action; this one
// generic action now backs every one of their settings-tab forms.
export async function setPermissionGrantAction(formData: FormData) {
  const actor = await requireMember();
  const moduleKeyRaw = String(formData.get("moduleKey") ?? "");
  const taskIdRaw = String(formData.get("taskId") ?? "").trim();
  const tab = String(formData.get("tab") ?? "") || undefined;

  try {
    await requireAdmins(actor);
    const moduleKey = permissionGrantFields.shape.moduleKey.parse(moduleKeyRaw);
    if (taskIdRaw) {
      const { taskId } = permissionGrantFields.parse({ moduleKey, taskId: taskIdRaw });
      await requireTaskInActorCommunity(taskId, actor.communityId);
      await setPermissionGrant(actor.communityId, moduleKey, taskId);
    } else {
      await setPermissionGrant(actor.communityId, moduleKey, null);
    }
  } catch (err) {
    redirectWithError(err, tab);
  }

  revalidatePath("/settings");
}

// Multi-cardinality modules (admin, branch_coordination, support) —
// adds one more granting task without touching any others already
// granting the same module. Replaces the old free-text "type a tag"
// fields (adminsTag/coordinationTag) and supportTag's previously-
// nonexistent settings UI alike — see docs/development-plan.md's Phase
// 63 on why a tag string could never safely stay the mechanism.
export async function addPermissionGrantAction(formData: FormData) {
  const actor = await requireMember();
  const tab = String(formData.get("tab") ?? "") || undefined;

  try {
    await requireAdmins(actor);
    const { moduleKey, taskId } = permissionGrantFields.parse({
      moduleKey: String(formData.get("moduleKey") ?? ""),
      taskId: String(formData.get("taskId") ?? "").trim(),
    });
    await requireTaskInActorCommunity(taskId, actor.communityId);
    await addPermissionGrant(actor.communityId, moduleKey, taskId);
  } catch (err) {
    redirectWithError(err, tab);
  }

  revalidatePath("/settings");
}

export async function removePermissionGrantAction(formData: FormData) {
  const actor = await requireMember();
  const tab = String(formData.get("tab") ?? "") || undefined;

  try {
    await requireAdmins(actor);
    const { moduleKey, taskId } = permissionGrantFields.parse({
      moduleKey: String(formData.get("moduleKey") ?? ""),
      taskId: String(formData.get("taskId") ?? ""),
    });
    await removePermissionGrant(actor.communityId, moduleKey, taskId);
  } catch (err) {
    redirectWithError(err, tab);
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
    redirectWithError(err, "branches");
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
    redirectWithError(err, "branches");
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
    redirectWithError(err, "branches");
  }

  revalidatePath("/settings");
}

// Phase 55 — see docs/spec.md's "Create new branch" needs its own
// check." confirmPendingBranch/rejectPendingBranch are already Admins-
// gated internally; the explicit requireAdmins call here just matches
// this file's own existing defense-in-depth posture for every other
// Branch write above.
export async function confirmPendingBranchAction(formData: FormData) {
  const actor = await requireMember();
  const branchId = String(formData.get("branchId"));

  try {
    await requireAdmins(actor);
    await confirmPendingBranch(actor, branchId);
  } catch (err) {
    redirectWithError(err, "branches");
  }

  revalidatePath("/settings");
}

export async function rejectPendingBranchAction(formData: FormData) {
  const actor = await requireMember();
  const branchId = String(formData.get("branchId"));
  const reassignToBranchId = String(formData.get("reassignToBranchId"));

  try {
    await requireAdmins(actor);
    await rejectPendingBranch(actor, branchId, reassignToBranchId);
  } catch (err) {
    redirectWithError(err, "branches");
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
    redirectWithError(err, "cycles-tiers");
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
    redirectWithError(err, "cycles-tiers");
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
    redirectWithError(err, "cycles-tiers");
  }

  revalidatePath("/settings");
}

export async function createCycleTypeAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const defaultSourceCycleId = String(formData.get("defaultSourceCycleId") ?? "").trim();
    const defaultPackId = String(formData.get("defaultPackId") ?? "").trim();
    const input = createCycleTypeInput.parse({
      name: String(formData.get("name") ?? ""),
      defaultSourceCycleId: defaultSourceCycleId || null,
      defaultPackId: defaultPackId || null,
    });
    await createCycleType(actor, input);
  } catch (err) {
    redirectWithError(err, "cycles-tiers");
  }

  revalidatePath("/settings");
}

export async function updateCycleTypeAction(formData: FormData) {
  const actor = await requireMember();
  const cycleTypeId = String(formData.get("cycleTypeId"));

  try {
    await requireAdmins(actor);
    const defaultSourceCycleId = String(formData.get("defaultSourceCycleId") ?? "").trim();
    const defaultPackId = String(formData.get("defaultPackId") ?? "").trim();
    const input = updateCycleTypeInput.parse({
      name: String(formData.get("name") ?? ""),
      defaultSourceCycleId: defaultSourceCycleId || null,
      defaultPackId: defaultPackId || null,
    });
    await updateCycleType(actor, cycleTypeId, input);
  } catch (err) {
    redirectWithError(err, "cycles-tiers");
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
    redirectWithError(err, "cycles-tiers");
  }

  revalidatePath("/settings");
}

export async function createProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const scope = String(formData.get("scope") ?? "once_ever");
    // ProfileQuestionEditor.tsx (Phase 58's field-builder) emits one
    // hidden "options" input per option rather than a comma-joined
    // string — getAll reads the same repeated-name shape this codebase
    // already uses elsewhere (e.g. board's own bulk "taskIds").
    const options = formData.getAll("options").map(String).map((o) => o.trim()).filter(Boolean);
    const input = createProfileQuestionInput.parse({
      label: String(formData.get("label") ?? ""),
      responseType: String(formData.get("responseType") ?? "free_text"),
      options: options.length > 0 ? options : undefined,
      scope,
      phaseNameHint:
        scope === "phase" ? String(formData.get("phaseNameHint") ?? "").trim() || undefined : undefined,
      required: formData.get("required") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
      surfaces: formData.get("onboardingSurface") === "on" ? ["onboarding"] : [],
    });
    await createProfileQuestion(actor, input);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

export async function updateProfileQuestionAction(formData: FormData) {
  const actor = await requireMember();
  const questionId = String(formData.get("questionId"));

  try {
    await requireAdmins(actor);
    const options = formData.getAll("options").map(String).map((o) => o.trim()).filter(Boolean);
    const input = updateProfileQuestionInput.parse({
      label: String(formData.get("label") ?? "") || undefined,
      responseType: String(formData.get("responseType") ?? "") || undefined,
      options,
      required: formData.get("required") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
      surfaces: formData.get("onboardingSurface") === "on" ? ["onboarding"] : [],
    });
    await updateProfileQuestion(actor, questionId, input);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
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
    redirectWithError(err, "profile-privacy");
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
    redirectWithError(err, "profile-privacy");
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
    redirectWithError(err, "profile-privacy");
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
    redirectWithError(err, "profile-privacy");
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
      fields: parseFieldsJson(String(formData.get("fieldsJson") ?? "[]")),
      allowAnonymous: formData.get("allowAnonymous") === "on",
    });
    await createForm(actor, input);
  } catch (err) {
    redirectWithError(err, "forms");
  }

  revalidatePath("/settings");
}

// New in Phase 58 — Form.fields (and title/description) are now
// editable post-creation through the same field-builder the create
// form uses, not just archivable. See src/lib/forms.ts's updateForm.
export async function updateFormAction(formData: FormData) {
  const actor = await requireMember();
  const formId = String(formData.get("formId"));

  try {
    await requireAdmins(actor);
    const input = updateFormInput.parse({
      title: String(formData.get("title") ?? "") || undefined,
      description: String(formData.get("description") ?? "").trim() || null,
      fields: parseFieldsJson(String(formData.get("fieldsJson") ?? "[]")),
    });
    await updateForm(actor, formId, input);
  } catch (err) {
    redirectWithError(err, "forms");
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
    redirectWithError(err, "forms");
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
    redirectWithError(err, "forms");
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
    redirectWithError(err, "profile-privacy");
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
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

// Screen one's submit for bulk-adding an existing group's roster
// (docs/development-plan.md's Phase 61) — parses the pasted text or
// uploaded file (a CSV's raw text is the identical "one row per line"
// shape, so one parser covers both sources) and checks every row
// against already-claimed emails, but creates nothing yet: "nothing
// commits until the whole flow confirms," the same posture Task Pack
// import's own review screen already established.
export async function reviewBulkMemberImportAction(formData: FormData) {
  const actor = await requireMember();
  const file = formData.get("file");
  const pastedText = String(formData.get("pastedText") ?? "");

  let state: string;
  try {
    await requireAdmins(actor);
    const raw = file instanceof File && file.size > 0 ? await file.text() : pastedText;
    const { rows, malformedLines } = parseBulkMemberRows(raw);
    const { newRows, alreadyExistsRows } = await previewBulkMemberImport(actor, rows);
    state = encodeBulkMemberState({ newRows, alreadyExistsRows, malformedLines });
  } catch (err) {
    redirectWithError(err, "members");
  }

  redirect(`/settings?bulkStage=review&bulkState=${encodeURIComponent(state)}&tab=members`);
}

// Screen two's submit — only ever reached from the review screen
// above, decoding exactly the rows it already showed rather than
// re-parsing raw text a second time. Re-checks for an already-claimed
// email again inside commitBulkMemberImport itself (defense in depth,
// same as every other two-step confirm flow in this codebase) in case
// something changed in the gap between review and confirm.
export async function confirmBulkMemberImportAction(formData: FormData) {
  const actor = await requireMember();
  const stateRaw = String(formData.get("state") ?? "");

  const state = decodeBulkMemberState(stateRaw);
  if (!state) {
    redirect(`/settings?error=${encodeURIComponent("That review session expired — start over")}&tab=members`);
  }

  let created: number;
  try {
    await requireAdmins(actor);
    ({ created } = await commitBulkMemberImport(actor, state.newRows));
  } catch (err) {
    redirectWithError(err, "members");
  }

  revalidatePath("/settings");
  redirect(`/settings?bulkAdded=${created}&tab=members`);
}

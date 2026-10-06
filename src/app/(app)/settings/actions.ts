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
  PERMISSION_MODULE_LABELS,
  removePermissionGrant,
  setModuleOpen,
  setPermissionGrant,
} from "@/lib/permissions";
import { NotFoundError } from "@/lib/errors";
import {
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
import {
  joiningLaneRuleInputSchema,
  setCommunityJoiningLaneRules,
  type JoiningLaneRuleInput,
} from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_ORDER } from "@/lib/recruitment/lanes";
import type { JoinLaneKind } from "@/db/schema";
import { checkboxGroup, checkboxOf, defined, number, optionalText, text } from "./form-values";
import {
  archiveProfileQuestion,
  createProfileQuestion,
  createProfileQuestionInput,
  hasProfileQuestions,
  seedDefaultProfileQuestions,
  unarchiveProfileQuestion,
  updateProfileQuestion,
  parseStarterSetChoices,
  updateProfileQuestionInput,
} from "@/lib/profile-questions";
import {
  createSensitiveFieldAccessRule,
  createSensitiveFieldAccessRuleInput,
  type CreateSensitiveFieldAccessRuleInput,
  deleteSensitiveFieldAccessRule,
} from "@/lib/sensitive-data";
import { archiveForm, createForm, createFormInput, unarchiveForm, updateForm, updateFormInput } from "@/lib/forms";
import { createConsentPurpose, createConsentPurposeInput, deleteConsentPurpose } from "@/lib/consent";
import {
  archiveTraitAxis,
  createTraitAxis,
  createTraitAxisInput,
  unarchiveTraitAxis,
  updateTraitAxis,
  updateTraitAxisInput,
} from "@/lib/trait-axes";
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

// Community settings are grouped into one action per *card* rather than
// one per tab. The earlier split (one action per tab) fixed a real bug —
// submitting one tab could never blank out another tab's checkbox, since
// every field in updateCommunityInput is optional — but it left the other
// half of the problem: within a tab, a single Save meant one rejected
// value discarded every unrelated change on that tab, and the person
// fixing the one bad number had to re-do the other four.
//
// So the unit is the card, and each action below submits exactly the keys
// its own card owns. `checkboxOf` (./form-values) is what makes that
// possible: a toggle paired with a hidden `off` always submits its key,
// so "off" and "not mine" stay distinguishable. Everything funnels
// through the same updateCommunity()/updateCommunityInput, unchanged, so
// the on-site-mode lock and the change log still run for every card.

// General → Name & shape
export async function updateGeneralBasicsAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        name: text(formData, "name") || undefined,
        cyclesEnabled: checkboxOf(formData, "cyclesEnabled"),
        phasesEnabled: checkboxOf(formData, "phasesEnabled"),
        defaultDateDisplayMode: text(formData, "defaultDateDisplayMode") as "exact" | "period" | "",
        cycleInitiationTierId: optionalText(formData, "cycleInitiationTierId"),
        onsiteModeEnabled: checkboxOf(formData, "onsiteModeEnabled"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "general");
  }
  revalidatePath("/settings");
}

// General → Branding
export async function updateBrandingAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    await updateCommunity(
      actor,
      updateCommunityInput.parse(
        defined({
          accentPrimary: optionalText(formData, "accentPrimary"),
          accentSecondary: optionalText(formData, "accentSecondary"),
          logoUrl: optionalText(formData, "logoUrl"),
        }),
      ),
    );
  } catch (err) {
    redirectWithError(err, "general");
  }
  revalidatePath("/settings");
}

// General → Single sign-on
export async function updateSsoAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    await updateCommunity(
      actor,
      updateCommunityInput.parse(
        defined({
          oidcIssuerUrl: optionalText(formData, "oidcIssuerUrl"),
          oidcClientId: optionalText(formData, "oidcClientId"),
          oidcRequiredRole: optionalText(formData, "oidcRequiredRole"),
          oidcPrimary: checkboxOf(formData, "oidcPrimary"),
        }),
      ),
    );
  } catch (err) {
    redirectWithError(err, "general");
  }
  revalidatePath("/settings");
}

// General → Call defaults
export async function updateCallDefaultsAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    await updateCommunity(
      actor,
      updateCommunityInput.parse(
        defined({
          defaultCallHasAgenda: checkboxOf(formData, "defaultCallHasAgenda"),
          defaultCallNeedsSummary: checkboxOf(formData, "defaultCallNeedsSummary"),
          defaultCallRequireRead: checkboxOf(formData, "defaultCallRequireRead"),
        }),
      ),
    );
  } catch (err) {
    redirectWithError(err, "general");
  }
  revalidatePath("/settings");
}

// Coordination → how long people get
export async function updateCoordinationTimingsAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        conflictAckWindowHours: number(formData, "conflictAckWindowHours"),
        taskNominationResponseDays: number(formData, "taskNominationResponseDays"),
        callSummaryReadWindowDays: number(formData, "callSummaryReadWindowDays"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "coordination");
  }

  // The two readers are the Dashboard (scoped) and /community (not).
  revalidatePath("/community");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

// Coordination → indicators
export async function updateIndicatorSettingsAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        cycleIndicatorsEnabled: checkboxOf(formData, "cycleIndicatorsEnabled"),
        cycleIndicatorsMinMembers: number(formData, "cycleIndicatorsMinMembers"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "coordination");
  }
  revalidatePath("/community");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

// Coordination → response tracking thresholds
export async function updateResponseTrackingAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        engagementSoftFlagThreshold: number(formData, "engagementSoftFlagThreshold"),
        engagementPatternThreshold: number(formData, "engagementPatternThreshold"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "coordination");
  }
  revalidatePath("/community");
  revalidatePath("/dashboard");
  revalidatePath("/settings");
}

export async function updateModulesSettingsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse({
      modulesEnabled: checkboxGroup(formData, "modulesEnabled"),
    });
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "modules");
  }

  revalidatePath("/settings");
}

export async function updatePostCycleFeedbackAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    await updateCommunity(
      actor,
      updateCommunityInput.parse({ postCycleFeedbackFormId: optionalText(formData, "postCycleFeedbackFormId") }),
    );
  } catch (err) {
    redirectWithError(err, "modules");
  }
  revalidatePath("/settings");
}

// Recruitment → the application funnel itself: which form, how many
// evaluators, how their recommendations turn into an outcome, and the
// words a decline starts from.
//
// The decision rules get their own card rather than sharing one with the
// other four, and that is the whole reason this tab stopped being one
// form: those rules are the single most error-prone field on the settings
// screen (a hand-written JSON array with a required fallback rule), and
// while they shared a Save with the doors and the windows, a rejected
// rule set silently reverted every door and window on the tab.
export async function updateRecruitmentApplicationAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        recruitmentApplicationFormId: optionalText(formData, "recruitmentApplicationFormId"),
        recruitmentEvaluatorCount: number(formData, "recruitmentEvaluatorCount"),
        recruitmentSubscriptionLapseThreshold: number(formData, "recruitmentSubscriptionLapseThreshold"),
        recruitmentRejectionTemplate: optionalText(formData, "recruitmentRejectionTemplate"),
        ...(formData.has("recruitmentDecisionRulesRaw")
          ? { recruitmentDecisionRules: parseDecisionRules(String(formData.get("recruitmentDecisionRulesRaw") ?? "")) }
          : {}),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
}

export async function updateRecruitmentDecisionRulesAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    await updateCommunity(actor, {
      recruitmentDecisionRules: parseDecisionRules(String(formData.get("recruitmentDecisionRulesRaw") ?? "")) as
        | []
        | { conditions: Record<string, unknown>; outcome: "proceed" | "decline" | "wider_discussion"; defaultResolution?: "proceed" | "decline" }[],
    });
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
}

// Recruitment → the three doors (§2.3). One card, one save, because the
// three are a single decision: "is this community accepting newcomers at
// all right now, and by which routes".
export async function updateRecruitmentDoorsAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        recruitmentApplicationsOpen: checkboxOf(formData, "recruitmentApplicationsOpen"),
        recruitmentInvitesOpen: checkboxOf(formData, "recruitmentInvitesOpen"),
        recruitmentInterviewsOpen: checkboxOf(formData, "recruitmentInterviewsOpen"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
  revalidatePath("/invites");
  revalidatePath("/apply");
}

// The two waiting periods, split into two actions to match the tab's
// pipeline order (see RecruitmentTab's header). They used to be one
// "windows" card sitting between the application and the doors, which put
// the support window — a step inside admission — two sections from the lane
// rule that invokes it, and the check window a screen from the decision rule
// that triggers it.
//
// Still per-mechanism rather than per-lane: nomination and consensus are
// never stacked on one lane precisely because two windows on one lane means
// two timers and nobody knows who resolves what. Splitting the card along
// the pipeline does not split it per lane.
//
// The support window's action deliberately does NOT revalidate
// /recruitment/mediation: nothing on the mediation page depends on how long
// a nomination waits, and the check window's does because that page renders
// the overrule threshold.
export async function updateRecruitmentSupportWindowAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({ recruitmentNominationWindowHours: number(formData, "recruitmentNominationWindowHours") }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
}

export async function updateRecruitmentCheckWindowAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const input = updateCommunityInput.parse(
      defined({
        recruitmentWiderDiscussionHours: number(formData, "recruitmentWiderDiscussionHours"),
        recruitmentObjectionOverrule: text(formData, "recruitmentObjectionOverrule") as
          | "majority"
          | "quorum"
          | "",
        recruitmentObjectionQuorum: number(formData, "recruitmentObjectionQuorum"),
      }),
    );
    await updateCommunity(actor, input);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
  revalidatePath("/recruitment/mediation");
}

// Recruitment → the four admission lanes (§2.1/§2.2, §5.1). The one card
// on this tab that is genuinely a form about a *design*, and the one that
// most needed to stop sharing a Save button with everything else.
export async function updateAdmissionRulesAction(formData: FormData) {
  const actor = await requireMember();
  try {
    await requireAdmins(actor);
    const rules: Partial<Record<JoinLaneKind, JoiningLaneRuleInput>> = {};
    for (const lane of JOINING_LANE_ORDER) {
      // A lane the client didn't render a card for is left alone rather
      // than written as a default — the preset select and the four cards
      // both post through the same fields, and "absent" has to be able to
      // mean "untouched" so a per-lane tweak survives a preset change
      // that didn't include it.
      if (formData.get(`lane.${lane}.verificationMode`) === null) continue;
      const parsed = joiningLaneRuleInputSchema.parse({
        verificationMode: formData.get(`lane.${lane}.verificationMode`),
        supportCount: Number(formData.get(`lane.${lane}.supportCount`) ?? 1),
        applicationRequired: checkboxOf(formData, `lane.${lane}.applicationRequired`) ?? false,
        interviewRequired: checkboxOf(formData, `lane.${lane}.interviewRequired`) ?? false,
        applyInsteadAvailable: checkboxOf(formData, `lane.${lane}.applyInsteadAvailable`) ?? true,
      });
      rules[lane] = parsed;
    }
    await setCommunityJoiningLaneRules(actor.communityId, rules);
  } catch (err) {
    redirectWithError(err, "recruitment");
  }
  revalidatePath("/settings");
  revalidatePath("/invites");
  revalidatePath("/apply");
  revalidatePath("/recruitment");
}

const permissionGrantFields = z.object({
  moduleKey: z.enum(PERMISSION_MODULE_KEYS),
  taskId: z.string().uuid(),
});

// "Everyone has this permission" (docs/open-permissions-plan.md). A checkbox
// plus Save, not a toggle-on-change: this whole tab is deliberately zero-JS
// (the grant picker is a datalist, Remove is a plain form), and a control that
// flipped on click would be the one thing here that silently changed a
// Community's access the instant it was pressed.
//
// The open/closed state is a single fact — the row's existence — so this is
// one upsert or one delete rather than a set/clear pair. No task id is
// involved, so unlike the three grant actions above there is nothing for
// requireTaskInActorCommunity to check: the only inputs are a module key the
// caller may only name from the enum, and the acting member.
const moduleOpenFields = z.object({
  moduleKey: z.enum(PERMISSION_MODULE_KEYS),
  open: z.boolean(),
});

export async function setModuleOpenAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const { moduleKey, open } = moduleOpenFields.parse({
      moduleKey: String(formData.get("moduleKey") ?? ""),
      // An unchecked box submits nothing at all, so absence is the negative
      // case rather than an error.
      open: formData.get("open") === "on",
    });

    // setModuleOpen refuses the one non-openable module (D11) and reports it,
    // so a forged POST gets the same answer the UI would have given.
    if (!(await setModuleOpen(actor, moduleKey, open, { confirmedReportExposure: formData.get("confirmedReportExposure") === "on" }))) {
      throw new AppError(
        `${PERMISSION_MODULE_LABELS[moduleKey]} can't be open to everyone — it needs someone named to notify.`,
      );
    }
  } catch (err) {
    redirectWithError(err, "permissions");
  }

  revalidatePath("/settings");
}

async function requireTaskInActorCommunity(taskId: string, communityId: string) {
  const [row] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task not found in your community");
  }
}

// Single-cardinality modules — makes the typed task *the* task granting
// this module, replacing a sibling grant in the same scope (the granted
// task's own placement, task.cycleId — docs/cycle-scope-remediation-plan.md
// §2.1), or adding a coexisting grant when the scope is new. Budget is one
// of these and is deliberately configurable only from this Settings action;
// generic task/proposal surfaces omit it. Clearing a grant is the per-row
// Remove button (removePermissionGrantAction), not an empty taskId — a grant
// always names a real task.
export async function setPermissionGrantAction(formData: FormData) {
  const actor = await requireMember();
  const tab = String(formData.get("tab") ?? "") || undefined;

  try {
    await requireAdmins(actor);
    const { moduleKey, taskId } = permissionGrantFields.parse({
      moduleKey: String(formData.get("moduleKey") ?? ""),
      taskId: String(formData.get("taskId") ?? "").trim(),
    });
    await requireTaskInActorCommunity(taskId, actor.communityId);
    await setPermissionGrant(actor, moduleKey, taskId);
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
    await addPermissionGrant(actor, moduleKey, taskId);
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
    await removePermissionGrant(actor, moduleKey, taskId, {
      confirmedLastAdmin: formData.get("confirmedLastAdmin") === "on",
    });
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

// "|"-delimited rather than comma-split, unlike tags — an axis's
// optionLabels are full sentences (see the autonomy axis) that could
// themselves contain a comma.
function parseOptionLabels(raw: string): string[] {
  return raw
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function createTraitAxisAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    const optionLabels = parseOptionLabels(String(formData.get("optionLabels") ?? ""));
    const input = createTraitAxisInput.parse({
      key: String(formData.get("key") ?? "").trim(),
      lowLabel: String(formData.get("lowLabel") ?? ""),
      highLabel: String(formData.get("highLabel") ?? ""),
      optionLabels: optionLabels.length > 0 ? optionLabels : undefined,
      askAtOnboarding: formData.get("askAtOnboarding") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0) || 0,
    });
    await createTraitAxis(actor, input);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

export async function updateTraitAxisAction(formData: FormData) {
  const actor = await requireMember();
  const axisId = String(formData.get("axisId"));

  try {
    await requireAdmins(actor);
    const optionLabels = parseOptionLabels(String(formData.get("optionLabels") ?? ""));
    const input = updateTraitAxisInput.parse({
      lowLabel: String(formData.get("lowLabel") ?? "") || undefined,
      highLabel: String(formData.get("highLabel") ?? "") || undefined,
      optionLabels,
      askAtOnboarding: formData.get("askAtOnboarding") === "on",
      sortOrder: Number(formData.get("sortOrder") ?? 0) || 0,
    });
    await updateTraitAxis(actor, axisId, input);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

export async function archiveTraitAxisAction(formData: FormData) {
  const actor = await requireMember();
  const axisId = String(formData.get("axisId"));

  try {
    await requireAdmins(actor);
    await archiveTraitAxis(actor, axisId);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

export async function unarchiveTraitAxisAction(formData: FormData) {
  const actor = await requireMember();
  const axisId = String(formData.get("axisId"));

  try {
    await requireAdmins(actor);
    await unarchiveTraitAxis(actor, axisId);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
}

// A number field's min/max/step, or null when the builder left it blank.
// Shared by both profile-question actions; the same "blank means unset"
// rule the requiredBy date uses.
function numberOrNull(raw: FormDataEntryValue | null): number | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// The three audience routes, read from whichever fields the form left
// filled. One reader for the create form and the Access rules form so the
// two can't disagree about what "one route" means — and a route the form
// left blank comes back undefined rather than an empty string, because
// "no tier" and "the id of a tier that doesn't exist" are different
// mistakes and only the first is recoverable.
function readAudienceFields(formData: FormData) {
  const tierId = String(formData.get("unlockedByTierId") ?? "").trim();
  const taskId = String(formData.get("unlockedByTaskId") ?? "").trim();
  const moduleKey = String(formData.get("unlockedByGrantModuleKey") ?? "").trim();
  return {
    unlockedByTierId: tierId || undefined,
    unlockedByTaskId: taskId || undefined,
    unlockedByGrantModuleKey: (moduleKey || undefined) as CreateSensitiveFieldAccessRuleInput["unlockedByGrantModuleKey"],
  };
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
      responseType: String(formData.get("responseType") ?? "text"),
      options: options.length > 0 ? options : undefined,
      // Field-shape flags, serialized as hidden inputs by
      // ProfileQuestionEditor. Blank means "off" for the booleans
      // (it emits "on"/"" rather than omitting), and null for the
      // number bounds.
      multiline: formData.get("multiline") === "on",
      validation: String(formData.get("validation") || "none"),
      allowOther: formData.get("allowOther") === "on",
      min: numberOrNull(formData.get("min")),
      max: numberOrNull(formData.get("max")),
      step: numberOrNull(formData.get("step")),
      scope,
      phaseNameHint:
        scope === "phase" ? String(formData.get("phaseNameHint") ?? "").trim() || undefined : undefined,
      required: formData.get("required") === "on",
      requiredBy: String(formData.get("requiredBy") ?? "").trim() || null,
      allowDeferral: formData.get("allowDeferral") === "on",
      allowPreferNotToSay: formData.get("allowPreferNotToSay") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
      surfaces: formData.get("onboardingSurface") === "on" ? ["onboarding"] : [],
      // Restricted, with the audience named here rather than in a second
      // trip to the Access rules section. A rule can only name a question
      // that already exists, so the two are one decision and the create
      // path does both — see createProfileQuestion's insert/rule/flag
      // sequence. The rule fields are read with the same "exactly one"
      // discipline as the standalone form, and an empty set on a
      // restricted question is a refusal from the schema rather than a
      // question nobody can read.
      sensitive: formData.get("sensitive") === "on",
      audience: readAudienceFields(formData),
      emergencyAccess: formData.get("emergencyAccess") === "on",
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
      multiline: formData.get("multiline") === "on",
      validation: String(formData.get("validation") || "none") as "none" | "email" | "phone" | "url",
      allowOther: formData.get("allowOther") === "on",
      min: numberOrNull(formData.get("min")),
      max: numberOrNull(formData.get("max")),
      step: numberOrNull(formData.get("step")),
      required: formData.get("required") === "on",
      requiredBy: String(formData.get("requiredBy") ?? "").trim() || null,
      allowDeferral: formData.get("allowDeferral") === "on",
      allowPreferNotToSay: formData.get("allowPreferNotToSay") === "on",
      feedsCapacitySignal: formData.get("feedsCapacitySignal") === "on",
      publishedAsIndicator: formData.get("publishedAsIndicator") === "on",
      // No `sensitive` here — the update input has no such field at all,
      // which is the mechanism rather than a check. Emergency *is* still
      // mutable and deliberately so: switching it off discloses nothing,
      // and a Community should be able to stop advertising a standing
      // emergency reachability of its members' facts.
      //
      // The one asymmetry, and it is unresolved: switching it ON is a
      // widening, so it ought to require the same per-answer consent
      // `profile_answer_rule_consent` gives an access rule. It doesn't yet
      // — an Admin ticking this on a question that already has answers
      // makes every one of them emergency-reachable without asking. See
      // `extendAnswerConsent`'s sibling gap in sensitive-data.ts. Noted
      // here rather than in a TODO because it is a disclosure decision,
      // not a bug report.
      emergencyAccess: formData.get("emergencyAccess") === "on",
      surfaces: formData.get("onboardingSurface") === "on" ? ["onboarding"] : [],
    });
    await updateProfileQuestion(actor, questionId, input);
  } catch (err) {
    redirectWithError(err, "profile-privacy");
  }

  revalidatePath("/settings");
  // The published aggregate is rendered on /community, not here, so a
  // publish/unpublish/re-gate has to invalidate that page too — a stale
  // /community would keep showing (or keep hiding) a breakdown the
  // community just changed its mind about.
  revalidatePath("/community");
}

export async function seedDefaultProfileQuestionsAction(formData: FormData) {
  const actor = await requireMember();

  try {
    await requireAdmins(actor);
    // The same guard the first-member path uses, and for the same reason:
    // a second run would silently double every question, which is the
    // kind of bug that looks like a data problem for ever afterwards.
    if (await hasProfileQuestions(actor.communityId)) {
      throw new AppError(
        "This Community already has questions, so the starter set wasn't added. Edit or archive what you have instead — a second set would be a duplicate of every one of them.",
      );
    }

    // Parsing lives in the lib, not here: this module is `"use server"`,
    // so a test cannot call it without a request context, and the parse is
    // exactly the kind of thing that needs one. It reads a real FormData
    // built with the same field names the review form renders.
    const choices = parseStarterSetChoices(formData);

    await seedDefaultProfileQuestions(actor, choices);
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
      fieldKey: String(formData.get("fieldKey") ?? "").trim() || null,
      questionId: String(formData.get("questionId") ?? "").trim() || null,
      unlockedByTaskId: String(formData.get("unlockedByTaskId") ?? "").trim() || null,
      unlockedByTierId: String(formData.get("unlockedByTierId") ?? "").trim() || null,
      unlockedByGrantModuleKey: String(formData.get("unlockedByGrantModuleKey") ?? "").trim() || null,
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
      gatesQuestionId: String(formData.get("gatesQuestionId") ?? "").trim() || null,
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

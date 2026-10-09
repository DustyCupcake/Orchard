import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { community, dateDisplayModeEnum, form, objectionOverruleModeEnum, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import { recruitmentDecisionRulesSchema, requireValidDecisionRules } from "../recruitment/evaluations";
import { isValidTimeZone } from "../dates/timezone";
import { requireNotOnsiteLocked } from "../onsite-mode";
import { recordSettingChanges } from "./history";

type Member = typeof memberTable.$inferSelect;

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Must be a hex color like #3a6cd9");

// Validated as a real zone rather than any string, because an unusable
// one doesn't fail loudly later — effectiveTimeZone would quietly fall
// back to UTC and every time on the programme would read an hour out
// from what the Community typed.
const timeZoneInput = z
  .string()
  .refine(isValidTimeZone, "Not a time zone — try something like Europe/London");

export async function getCommunity(actor: Member) {
  const [row] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// Deliberately narrow — per docs/plans/development-plan.md's Phase 9 scope
// ("branches, tiers, and cycle/phase structure"), not the full
// Configuration model. membership_model and branch_membership_model
// stay DB-only for now. The call defaults are wired up here in
// Phase 19 — see src/lib/settings/branches.ts for the per-Branch
// overrides that fall back to these. modulesEnabled is wired up in
// Phase 22 — see src/lib/modules.ts.
export const updateCommunityInput = z.object({
  name: z.string().min(1).optional(),
  cyclesEnabled: z.boolean().optional(),
  phasesEnabled: z.boolean().optional(),
  defaultDateDisplayMode: z.enum(dateDisplayModeEnum.enumValues).optional(),
  timeZone: timeZoneInput.nullable().optional(),
  cycleInitiationTierId: z.string().uuid().nullable().optional(),
  defaultCallHasAgenda: z.boolean().optional(),
  defaultCallNeedsSummary: z.boolean().optional(),
  defaultCallRequireRead: z.boolean().optional(),
  conflictAckWindowHours: z.number().int().positive().optional(),
  // Per-cycle indicator policy — see community.ts's own comment on the
  // two columns. Bounded below at 1 rather than 0 so "no minimum" isn't
  // expressible: a floor of zero is indistinguishable from the
  // population being unknown, and the whole point is that an event
  // small enough to identify someone must not be broken out.
  cycleIndicatorsEnabled: z.boolean().optional(),
  modulesEnabled: z.array(z.string()).optional(),
  // Null turns off the standing post-cycle feedback ask — see
  // src/db/schema/community.ts's schema comment and src/lib/forms.ts.
  // Its own review-task authority is a PermissionGrant now (Phase 63)
  // — see setPermissionGrantAction/addPermissionGrantAction/
  // removePermissionGrantAction in src/app/(app)/settings/actions.ts,
  // not this input.
  postCycleFeedbackFormId: z.string().uuid().nullable().optional(),
  // Null turns off application intake — /apply says so. Same non-FK
  // pointer reasoning as postCycleFeedbackFormId.
  recruitmentApplicationFormId: z.string().uuid().nullable().optional(),
  // Community-wide recruitment door toggles (docs/cycle-scope-
  // remediation-plan.md §4.3/D13): close the *general* cycle-less doors
  // so a community can run fully closed except for the cycles it opens
  // (per-cycle doors live on the cycle itself).
  recruitmentApplicationsOpen: z.boolean().optional(),
  recruitmentInvitesOpen: z.boolean().optional(),
  // The third door (docs/plans/archive/joining-admission-plan.md §2.3/J3): whether an
  // interview can be scheduled at all. Distinct from a lane's
  // `interviewRequired` — that says "an arrival on this lane is
  // interviewed", this says "no interviews are happening right now".
  recruitmentInterviewsOpen: z.boolean().optional(),
  // The second of the two time-boxed verification windows (§2.2/J2), and
  // the overrule threshold that governs the one exception in §2.6. Both
  // are per-mechanism rather than per-lane on purpose: J2 ruled out
  // stacking nomination and consensus on a lane precisely because two
  // windows means two timers and nobody knows who resolves what.
  recruitmentNominationWindowHours: z.number().int().positive().max(24 * 30).optional(),
  recruitmentObjectionOverrule: z.enum(objectionOverruleModeEnum.enumValues).optional(),
  // Only meaningful in `quorum` mode, and bounded so it can't be set to
  // a number that silently disables the overrule: the mediation page
  // reports "the quorum is N and the body is M" as the *reason* the
  // exception is unavailable, which only works if the number stays
  // somewhere a body could plausibly reach.
  recruitmentObjectionQuorum: z.number().int().min(1).max(50).optional(),
  recruitmentEvaluatorCount: z.number().int().positive().optional(),
  recruitmentDecisionRules: recruitmentDecisionRulesSchema.optional(),
  recruitmentSubscriptionLapseThreshold: z.number().int().positive().optional(),
  recruitmentWiderDiscussionHours: z.number().int().positive().optional(),
  // Null clears it — "surfaced to whoever's about to send an actual
  // decline, never sent automatically."
  recruitmentRejectionTemplate: z.string().nullable().optional(),
  // "Only offered if phases are on" (docs/spec.md's Configuration
  // table) — /settings only renders the checkbox when phasesEnabled is
  // already true, re-checked here too. See src/lib/onsite-mode.ts for
  // what turning it on actually locks.
  onsiteModeEnabled: z.boolean().optional(),
  // "Reply within [N days]" — see src/db/schema/community.ts's own
  // comment and src/lib/tasks/nominations.ts.
  taskNominationResponseDays: z.number().int().positive().optional(),
  // Response tracking thresholds and the call-summary read window —
  // see src/db/schema/community.ts's own comments and
  // src/lib/engagement.ts.
  engagementSoftFlagThreshold: z.number().int().positive().optional(),
  engagementPatternThreshold: z.number().int().positive().optional(),
  callSummaryReadWindowDays: z.number().int().positive().optional(),
  // Community branding — see design_handoff_conventions/README.md. Null
  // clears back to the design tokens' own default accent (design tokens
  // fall back to the documented cobalt/plum pair when either is null).
  accentPrimary: hexColor.nullable().optional(),
  accentSecondary: hexColor.nullable().optional(),
  logoUrl: z.string().url().nullable().optional(),
  // OIDC second auth provider — see src/db/schema/community.ts's own
  // comment and src/lib/oidc.ts. Null clears it back to magic-link
  // only; the client secret itself is never accepted here, it's an env
  // var (OIDC_CLIENT_SECRET).
  oidcIssuerUrl: z.string().url().nullable().optional(),
  oidcClientId: z.string().min(1).nullable().optional(),
  oidcRequiredRole: z.string().min(1).nullable().optional(),
  oidcPrimary: z.boolean().optional(),
});
export type UpdateCommunityInput = z.infer<typeof updateCommunityInput>;

export async function updateCommunity(actor: Member, input: UpdateCommunityInput) {
  const [currentRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!currentRow) {
    throw new NotFoundError("Community not found");
  }

  // The one escape hatch: turning on-site mode off is always allowed
  // even while locked (it's the only way back to normal editing) — any
  // other settings change while it's on, including bundling one into
  // the same submission, is rejected.
  if (input.onsiteModeEnabled !== false) {
    requireNotOnsiteLocked(currentRow);
  }

  if (input.onsiteModeEnabled === true) {
    const effectivePhasesEnabled = input.phasesEnabled ?? currentRow.phasesEnabled;
    if (!effectivePhasesEnabled) {
      throw new AppError("On-site mode requires Phases to be enabled first");
    }
  }

  if (input.cycleInitiationTierId) {
    const [tierRow] = await db
      .select({ id: tier.id, communityId: tier.communityId })
      .from(tier)
      .where(eq(tier.id, input.cycleInitiationTierId));
    if (!tierRow || tierRow.communityId !== actor.communityId) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  if (input.postCycleFeedbackFormId) {
    const [formRow] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.id, input.postCycleFeedbackFormId), eq(form.communityId, actor.communityId)));
    if (!formRow) {
      throw new NotFoundError("Form not found in your community");
    }
  }

  if (input.recruitmentApplicationFormId) {
    const [formRow] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.id, input.recruitmentApplicationFormId), eq(form.communityId, actor.communityId)));
    if (!formRow) {
      throw new NotFoundError("Form not found in your community");
    }
  }

  if (input.recruitmentDecisionRules !== undefined) {
    requireValidDecisionRules(input.recruitmentDecisionRules);
  }

  // The write and its log share one transaction, so a change can never land
  // without its record — the failure mode that makes an audit log worse than
  // none, because the gap is invisible.
  return db.transaction(async (tx) => {
    const [updated] = await tx
      .update(community)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.cyclesEnabled !== undefined && { cyclesEnabled: input.cyclesEnabled }),
        ...(input.phasesEnabled !== undefined && { phasesEnabled: input.phasesEnabled }),
        ...(input.defaultDateDisplayMode !== undefined && { defaultDateDisplayMode: input.defaultDateDisplayMode }),
        ...(input.timeZone !== undefined && { timeZone: input.timeZone }),
        ...(input.cycleInitiationTierId !== undefined && {
          cycleInitiationTierId: input.cycleInitiationTierId,
        }),
        ...(input.defaultCallHasAgenda !== undefined && { defaultCallHasAgenda: input.defaultCallHasAgenda }),
        ...(input.defaultCallNeedsSummary !== undefined && {
          defaultCallNeedsSummary: input.defaultCallNeedsSummary,
        }),
        ...(input.defaultCallRequireRead !== undefined && {
          defaultCallRequireRead: input.defaultCallRequireRead,
        }),
        ...(input.conflictAckWindowHours !== undefined && {
          conflictAckWindowHours: input.conflictAckWindowHours,
        }),
        ...(input.modulesEnabled !== undefined && { modulesEnabled: input.modulesEnabled }),
        ...(input.postCycleFeedbackFormId !== undefined && {
          postCycleFeedbackFormId: input.postCycleFeedbackFormId,
        }),
        ...(input.recruitmentApplicationFormId !== undefined && {
          recruitmentApplicationFormId: input.recruitmentApplicationFormId,
        }),
        ...(input.recruitmentApplicationsOpen !== undefined && {
          recruitmentApplicationsOpen: input.recruitmentApplicationsOpen,
        }),
        ...(input.recruitmentInvitesOpen !== undefined && {
          recruitmentInvitesOpen: input.recruitmentInvitesOpen,
        }),
        ...(input.recruitmentInterviewsOpen !== undefined && {
          recruitmentInterviewsOpen: input.recruitmentInterviewsOpen,
        }),
        ...(input.recruitmentNominationWindowHours !== undefined && {
          recruitmentNominationWindowHours: input.recruitmentNominationWindowHours,
        }),
        ...(input.recruitmentObjectionOverrule !== undefined && {
          recruitmentObjectionOverrule: input.recruitmentObjectionOverrule,
        }),
        ...(input.recruitmentObjectionQuorum !== undefined && {
          recruitmentObjectionQuorum: input.recruitmentObjectionQuorum,
        }),
        ...(input.recruitmentEvaluatorCount !== undefined && {
          recruitmentEvaluatorCount: input.recruitmentEvaluatorCount,
        }),
        ...(input.recruitmentDecisionRules !== undefined && {
          recruitmentDecisionRules: input.recruitmentDecisionRules,
        }),
        ...(input.recruitmentSubscriptionLapseThreshold !== undefined && {
          recruitmentSubscriptionLapseThreshold: input.recruitmentSubscriptionLapseThreshold,
        }),
        ...(input.recruitmentWiderDiscussionHours !== undefined && {
          recruitmentWiderDiscussionHours: input.recruitmentWiderDiscussionHours,
        }),
        ...(input.recruitmentRejectionTemplate !== undefined && {
          recruitmentRejectionTemplate: input.recruitmentRejectionTemplate,
        }),
        ...(input.onsiteModeEnabled !== undefined && { onsiteModeEnabled: input.onsiteModeEnabled }),
        ...(input.taskNominationResponseDays !== undefined && {
          taskNominationResponseDays: input.taskNominationResponseDays,
        }),
        ...(input.engagementSoftFlagThreshold !== undefined && {
          engagementSoftFlagThreshold: input.engagementSoftFlagThreshold,
        }),
        ...(input.engagementPatternThreshold !== undefined && {
          engagementPatternThreshold: input.engagementPatternThreshold,
        }),
        ...(input.callSummaryReadWindowDays !== undefined && {
          callSummaryReadWindowDays: input.callSummaryReadWindowDays,
        }),
        ...(input.accentPrimary !== undefined && { accentPrimary: input.accentPrimary }),
        ...(input.accentSecondary !== undefined && { accentSecondary: input.accentSecondary }),
        ...(input.logoUrl !== undefined && { logoUrl: input.logoUrl }),
        ...(input.oidcIssuerUrl !== undefined && { oidcIssuerUrl: input.oidcIssuerUrl }),
        ...(input.oidcClientId !== undefined && { oidcClientId: input.oidcClientId }),
        ...(input.oidcRequiredRole !== undefined && { oidcRequiredRole: input.oidcRequiredRole }),
        ...(input.oidcPrimary !== undefined && { oidcPrimary: input.oidcPrimary }),
      })
      .where(eq(community.id, actor.communityId))
      .returning();

    // Labelled with the name from AFTER the update, so a row that renamed the
    // community still reads as the community it renamed it to — which is the
    // name someone looking for it later will recognise. Nothing is withheld
    // here: every community column is already member-readable on /settings
    // (see docs/spec.md:430 on assemblies deciding foundational settings), so
    // a diff of them withholds nothing a reader could not already go and read.
    await recordSettingChanges(tx, {
      actor,
      entity: "community",
      action: "updated",
      entityId: actor.communityId,
      entityLabel: updated.name,
      current: currentRow,
      changes: input,
    });

    return updated;
  });
}

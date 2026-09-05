import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cycle, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCommunity } from "./settings/community";
import { isModuleEnabled } from "./modules";
import { listGrantingTaskIds, type PermissionModuleKey } from "./permissions";
import { isCoordinationHolder } from "./coordination";
import { isRecruitmentTaskHolder } from "./recruitment";
import { isEventSchedulingOwner } from "./event-scheduling/conflicts";
import { isSpatialPlanningHolder } from "./spatial-planning";
import { getCurrentBudgetCycle } from "./budget/cycles";
import { isBudgetOwner } from "./budget/voting";
import { listShiftSeries, isShiftCoordinator } from "./shifts/series";
import { getPersonalFeed } from "./dashboard";
import { getCurrentPhase } from "./profile-questions";
import { getMyParticipation } from "./participation";
import { canInitiateCycle, listOpenCycles, resolveDefaultScopeSegment } from "./cycles";

type Member = typeof memberTable.$inferSelect;

// Maps a visibleModules key to the nav item that represents it
// (src/components/nav/nav-config.ts) — the one place this codebase
// translates between the two naming schemes, used both for auto-pin-
// by-task-holdership below and for a Phase's highlightModuleKey.
const MODULE_NAV_ITEM_KEY = {
  eventScheduling: "schedule",
  shifts: "shifts",
  recruitment: "recruitment",
  spatialPlanning: "spatial-planning",
  sensitiveData: "sensitive-data",
  budget: "budget",
  conflictReports: "conflict-reports",
  feedback: "feedback",
} as const;
export type VisibleModuleKey = keyof typeof MODULE_NAV_ITEM_KEY;

// The options a Phase's "highlight this module" picker offers — see
// src/app/(app)/participation/actions.ts's updatePhaseHighlightAction
// and PhaseDatesSection's own form. Every module-shaped nav item is
// offered generically; which ones actually make sense for a given
// Community is a judgment call for whoever's setting it, not something
// worth hardcoding here.
export const HIGHLIGHTABLE_MODULES: { key: VisibleModuleKey; label: string }[] = [
  { key: "recruitment", label: "Recruitment" },
  { key: "shifts", label: "Shifts" },
  { key: "budget", label: "Budget" },
  { key: "eventScheduling", label: "Event schedule" },
  { key: "spatialPlanning", label: "Spatial planning" },
  { key: "conflictReports", label: "Conflict reports" },
  { key: "sensitiveData", label: "Sensitive data" },
  { key: "feedback", label: "Feedback" },
];

// Whether the current viewer currently holds a task granting the given
// PermissionGrant module (conflict_team, feedback_review, ...) — the
// same "access follows the task" join every module's own holder-check
// already does (see e.g. isRecruitmentTaskHolder), duplicated here
// rather than exported from each module, since this is purely a nav-
// decoration signal (what to auto-pin), not an authorization gate.
async function holdsGrantedTask(actor: Member, moduleKey: PermissionModuleKey) {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, moduleKey);
  if (grantingTaskIds.length === 0) return false;
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

async function isAnyShiftCoordinator(actor: Member) {
  const series = await listShiftSeries(actor);
  for (const s of series) {
    if (await isShiftCoordinator(actor, s)) return true;
  }
  return false;
}

async function isAnyBudgetOwner(actor: Member) {
  const cycle = await getCurrentBudgetCycle(actor);
  if (!cycle) return false;
  return isBudgetOwner(actor, cycle);
}

export type NavContext = {
  memberName: string;
  // Community branding for the sidebar wordmark/logo slot — see
  // design_handoff_conventions/README.md's Sidebar component. logoUrl
  // null means "no logo set," not "still loading" — the sidebar falls
  // back to communityName in that case.
  communityName: string;
  communityLogoUrl: string | null;
  badgeCount: number;
  isCoordinator: boolean;
  visibleModules: {
    eventScheduling: boolean;
    shifts: boolean;
    recruitment: boolean;
    spatialPlanning: boolean;
    sensitiveData: boolean;
    budget: boolean;
    conflictReports: boolean;
    feedback: boolean;
  };
  pinnedKeys: string[];
  // Raw member.pinnedModuleKeys, unfiltered — separate from pinnedKeys
  // (which also carries auto-pins) so the sidebar's pin-toggle button
  // can tell "manually pinned by this member" apart from "auto-pinned,
  // not independently toggleable here."
  manualPinnedKeys: string[];
  // Phase 47 — drives the community-wide banner in AppShell.tsx.
  onsiteModeEnabled: boolean;
  // Phase 54 — set by the (app) layout (not this function; see its own
  // call site), which is the one place that knows both the real member
  // and any active View-as target. Drives AppShell's persistent
  // "Viewing as..." banner. Every other field on this context is
  // already computed against whichever actor the layout passes in, so
  // when View-as is active the rest of the nav (badge count, pinned
  // items, module visibility) already renders exactly as the viewed
  // member would see it — this field is only here for the banner text
  // and the "End View-as" button.
  viewAs: { targetId: string; targetName: string } | null;
  // The global cycle-switcher's own data (docs/development-plan.md's
  // Phase 65) — CycleSwitcher.tsx renders from this directly rather
  // than fetching anything itself.
  cycleSwitcher: {
    hasAnyOpenCycle: boolean;
    openCycles: { id: string; name: string }[];
    defaultScopeSegment: string;
    // Only set when defaultScopeSegment is a specific cycle id, not
    // "active" — that cycle might be closed (a valid, deliberate
    // default per Phase 65), so its name can't always be found in
    // openCycles above. Lets the switcher show a real name instead of
    // a generic fallback for the common "my last-viewed selection is a
    // now-closed cycle" case.
    defaultScopeName: string | null;
    canInitiateCycle: boolean;
  };
};

// Computed once per request (in the (app) shell layout) and handed to
// the Sidebar as plain props — everything here reuses each module's
// own existing holder/enablement checks rather than inventing new
// ones, so "who sees what pinned" always tracks the real authorization
// state instead of drifting into a second, nav-only notion of access.
export async function getNavContext(actor: Member): Promise<NavContext> {
  const community = await getCommunity(actor);
  const conflictTeamGrantingTaskIds = await listGrantingTaskIds(community.id, "conflict_team");

  const visibleModules = {
    eventScheduling: isModuleEnabled(community, "event_scheduling"),
    shifts: isModuleEnabled(community, "shifts"),
    recruitment: isModuleEnabled(community, "recruitment"),
    spatialPlanning: isModuleEnabled(community, "spatial_planning"),
    sensitiveData: isModuleEnabled(community, "sensitive_data"),
    budget: isModuleEnabled(community, "budget"),
    conflictReports: conflictTeamGrantingTaskIds.length > 0,
    feedback: community.postCycleFeedbackFormId !== null,
  };

  const [
    isCoordinator,
    holdsConflictTeamTask,
    holdsFeedbackReviewTask,
    isEventOwner,
    isRecruiter,
    isSpatialHolder,
    isBudgetOwnerNow,
    isShiftCoordinatorNow,
    feed,
    openCycles,
    defaultScopeSegment,
    canInitiate,
  ] = await Promise.all([
    isCoordinationHolder(actor, null),
    holdsGrantedTask(actor, "conflict_team"),
    holdsGrantedTask(actor, "feedback_review"),
    visibleModules.eventScheduling ? isEventSchedulingOwner(actor) : Promise.resolve(false),
    visibleModules.recruitment ? isRecruitmentTaskHolder(actor) : Promise.resolve(false),
    visibleModules.spatialPlanning ? isSpatialPlanningHolder(actor, community) : Promise.resolve(false),
    visibleModules.budget ? isAnyBudgetOwner(actor) : Promise.resolve(false),
    visibleModules.shifts ? isAnyShiftCoordinator(actor) : Promise.resolve(false),
    getPersonalFeed(actor),
    listOpenCycles(actor),
    resolveDefaultScopeSegment(actor),
    canInitiateCycle(actor),
  ]);

  const defaultScopeName =
    defaultScopeSegment === "active"
      ? null
      : ((await db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, defaultScopeSegment)))[0]?.name ?? null);

  const pinnedKeys: string[] = [];
  if (isCoordinator) pinnedKeys.push("coordination");
  if (visibleModules.conflictReports && holdsConflictTeamTask) pinnedKeys.push("conflict-reports");
  if (visibleModules.feedback && holdsFeedbackReviewTask) pinnedKeys.push("feedback");
  if (visibleModules.eventScheduling && isEventOwner) pinnedKeys.push("schedule");
  if (visibleModules.recruitment && isRecruiter) pinnedKeys.push("recruitment");
  if (visibleModules.spatialPlanning && isSpatialHolder) pinnedKeys.push("spatial-planning");
  if (visibleModules.budget && isBudgetOwnerNow) pinnedKeys.push("budget");
  if (visibleModules.shifts && isShiftCoordinatorNow) pinnedKeys.push("shifts");

  // "While this Phase is current, pin its highlighted module for
  // everyone actually coming" — e.g. Recruitment during a Recruitment
  // phase so non-holders can still track progress and invite people;
  // Shifts once sign-ups matter, ahead of the event. Reuses
  // getCurrentPhase (src/lib/profile-questions/capacity.ts, already
  // established for Availability's phase-scoped question) rather than
  // a second "what's the current phase" resolution. Never bypasses
  // Community.modulesEnabled — only promotes an already-visible module.
  const currentPhase = await getCurrentPhase(actor.communityId);
  if (currentPhase?.highlightModuleKey) {
    const highlightKey = currentPhase.highlightModuleKey as VisibleModuleKey;
    if (highlightKey in MODULE_NAV_ITEM_KEY && visibleModules[highlightKey]) {
      const myParticipation = await getMyParticipation(actor, currentPhase.cycleId);
      if (myParticipation.status === "coming") {
        pinnedKeys.push(MODULE_NAV_ITEM_KEY[highlightKey]);
      }
    }
  }

  // Manual "pin this for me" overrides — validated for visibility by
  // the caller (src/components/nav/AppShell.tsx), since a stale key
  // (a disabled module, a coordinator-only item after losing that
  // status) should just silently drop rather than needing cleanup here.
  for (const key of actor.pinnedModuleKeys) {
    if (!pinnedKeys.includes(key)) pinnedKeys.push(key);
  }

  const badgeCount =
    feed.pendingJoinRequests.length +
    feed.upcomingCheckins.length +
    feed.flaggedHeldTasks.length +
    feed.recruitmentNeedsAction.length +
    feed.placementInvites.length +
    feed.myLinkedPendingPlacements.length +
    feed.placementRevertNotices.length +
    feed.placementPendingReviews.length +
    feed.calendarEventInvites.length +
    // Phase 46's own feed section — missed when it was first added
    // here, caught while touching this same return block for Phase 47.
    feed.emergencyAccessActivity.length +
    // Phase 49's four new sections — added at the same time as the
    // feed fields themselves this time, per Phase 47's own "caught
    // while touching this same return block" lesson.
    feed.budgetNeedsAction.length +
    feed.eventSchedulingNeedsAction.length +
    feed.shiftCoordinatorNeedsAction.length +
    feed.myShiftsNeedingCompletion.length +
    feed.conflictNeedsAction.length +
    // Phase 51's own two new feed sections — added at the same time as
    // the feed fields themselves, same discipline Phase 49 established
    // after Phase 46/47's own miss here.
    feed.pendingNominations.length +
    feed.expiredNominations.length;

  return {
    memberName: actor.name,
    communityName: community.name,
    communityLogoUrl: community.logoUrl,
    badgeCount,
    isCoordinator,
    visibleModules,
    pinnedKeys,
    manualPinnedKeys: actor.pinnedModuleKeys,
    onsiteModeEnabled: community.onsiteModeEnabled,
    viewAs: null,
    cycleSwitcher: {
      hasAnyOpenCycle: openCycles.length > 0,
      openCycles: openCycles.map((c) => ({ id: c.id, name: c.name })),
      defaultScopeSegment,
      defaultScopeName,
      canInitiateCycle: canInitiate,
    },
  };
}

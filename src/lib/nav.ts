import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { cycle, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCommunity } from "./settings/community";
import { isModuleEnabled } from "./modules";
import {
  isModuleOpenToEveryone,
  listGrantingTaskIds,
  listOpenModuleKeys,
  type PermissionModuleKey,
} from "./permissions";
import { isCoordinationHolder } from "./coordination";
import { isRecruitmentTaskHolder } from "./recruitment";
import { isEventSchedulingOwner } from "./event-scheduling/conflicts";
import { isSpatialPlanningHolder } from "./spatial-planning";
import { getCurrentBudgetCycle } from "./budget/cycles";
import { isBudgetOwner } from "./budget/voting";
import { listShiftSeries, isShiftCoordinator } from "./shifts/series";
import { isKitchenOwner } from "./kitchen";
import { getPersonalFeed } from "./dashboard";
import { getCurrentPhase } from "./profile-questions";
import { listOutstandingRequiredQuestions } from "./profile-questions";
import { getMyParticipation } from "./participation";
import { canInitiateCycle, listOpenCycles, resolveDefaultScopeSegment } from "./cycles";
import { listOpenAssemblies } from "./assemblies";

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
  kitchen: "kitchen",
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
  { key: "eventScheduling", label: "Programme" },
  { key: "spatialPlanning", label: "Spatial planning" },
  { key: "conflictReports", label: "Conflict reports" },
  { key: "sensitiveData", label: "Sensitive data" },
  { key: "feedback", label: "Feedback" },
  { key: "kitchen", label: "Kitchen" },
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
  // The two-center attention split (Communication Inbox vs the task
  // feed): the old single badgeCount split into two scoped counts so
  // each sidebar surface's badge reflects exactly its own center's
  // items — taskBadgeCount rides the Dashboard nav item (the home of
  // the task feed), communicationBadgeCount the Communication group
  // header (the Inbox). See nav-config.ts + AppShell.tsx.
  communicationBadgeCount: number;
  taskBadgeCount: number;
  // Open Assemblies this member still owes an answer to — rides the
  // Community group header, alongside the other two centers' badges.
  // Counted by isAwaitingMyAnswer, so it is strictly "voting is open and
  // you haven't finished answering", never "an Assembly exists": see
  // that function's comment for why a badge for every open Assembly
  // would work against spec.md's "no built-in urgent notification, on
  // purpose" rule, and get ignored inside a week.
  communityBadgeCount: number;
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
    kitchen: boolean;
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
  // An open `conflict_team` makes the module configured even with no granting
  // task (D7). Keying this off grant existence alone — as this did — hid the
  // Conflict-reports nav item for exactly the Community that had opened the
  // team, leaving it able to file and handle reports with nowhere to go.
  const conflictTeamOpen = await isModuleOpenToEveryone(community.id, "conflict_team");

  const visibleModules = {
    eventScheduling: isModuleEnabled(community, "event_scheduling"),
    shifts: isModuleEnabled(community, "shifts"),
    recruitment: isModuleEnabled(community, "recruitment"),
    spatialPlanning: isModuleEnabled(community, "spatial_planning"),
    sensitiveData: isModuleEnabled(community, "sensitive_data"),
    budget: isModuleEnabled(community, "budget"),
    conflictReports: conflictTeamGrantingTaskIds.length > 0 || conflictTeamOpen,
    feedback: community.postCycleFeedbackFormId !== null,
    kitchen: isModuleEnabled(community, "kitchen"),
  };

  // The Community's open modules, fetched once (docs/open-permissions-plan.md
  // D5). Two jobs, and both are about *not* doing work:
  //
  //  1. A pin means "you have outstanding work here". An open module has no
  //     such person — everyone can act, no one is on the hook — so an open
  //     module must not pin. Without this, Step 4's open-aware resolvers
  //     would have made every member's sidebar change identically, losing
  //     the signal for whoever is actually doing the work.
  //  2. The holder probes below are then skipped outright for an open
  //     module, so an open Community doesn't pay nine resolver queries per
  //     page load to compute pins nobody receives.
  const openModuleKeys = await listOpenModuleKeys(actor.communityId);
  const isOpen = (moduleKey: PermissionModuleKey) => openModuleKeys.has(moduleKey);

  const [
    isCoordinator,
    holdsConflictTeamTask,
    holdsFeedbackReviewTask,
    isEventOwner,
    isRecruiter,
    isSpatialHolder,
    isBudgetOwnerNow,
    isShiftCoordinatorNow,
    isKitchenOwnerNow,
    feed,
    openCycles,
    defaultScopeSegment,
    canInitiate,
    openAssemblies,
  ] = await Promise.all([
    // NOT gated on open, unlike the eight below. isCoordinator is two things:
    // the Coordination *pin*, and — via NavContext.isCoordinator — the
    // `coordinatorOnly` nav items' visibility (nav-config.ts's isItemVisible).
    // Suppressing it for an open module would hide the Coordination
    // destination from everyone rather than merely unpinning it, so the pin
    // below is suppressed instead and this stays an accurate capability
    // answer.
    isCoordinationHolder(actor, null),
    isOpen("conflict_team") ? Promise.resolve(false) : holdsGrantedTask(actor, "conflict_team"),
    isOpen("feedback_review") ? Promise.resolve(false) : holdsGrantedTask(actor, "feedback_review"),
    visibleModules.eventScheduling && !isOpen("event_scheduling_owner")
      ? isEventSchedulingOwner(actor)
      : Promise.resolve(false),
    visibleModules.recruitment && !isOpen("recruitment")
      ? isRecruitmentTaskHolder(actor)
      : Promise.resolve(false),
    visibleModules.spatialPlanning && !isOpen("spatial_planning")
      ? isSpatialPlanningHolder(actor, community)
      : Promise.resolve(false),
    visibleModules.budget && !isOpen("budget") ? isAnyBudgetOwner(actor) : Promise.resolve(false),
    visibleModules.shifts && !isOpen("shift_management")
      ? isAnyShiftCoordinator(actor)
      : Promise.resolve(false),
    visibleModules.kitchen && !isOpen("kitchen") ? isKitchenOwner(actor) : Promise.resolve(false),
    getPersonalFeed(actor),
    listOpenCycles(actor),
    resolveDefaultScopeSegment(actor),
    canInitiateCycle(actor),
    // The Community group's badge. One extra query pair (assemblies +
    // their per-member participation), and it's the same call the
    // /community hub page makes for its own listing — so the badge is
    // always exactly a count of what that page shows.
    listOpenAssemblies(actor),
  ]);

  const defaultScopeName =
    defaultScopeSegment === "active"
      ? null
      : ((await db.select({ name: cycle.name }).from(cycle).where(eq(cycle.id, defaultScopeSegment)))[0]?.name ?? null);

  const pinnedKeys: string[] = [];
  // An open coordination module still satisfies isCoordinator — it just
  // doesn't earn a pin, for the reason above.
  const coordinationIsOpen =
    isOpen("branch_coordination") || isOpen("community_coordination");
  if (isCoordinator && !coordinationIsOpen) pinnedKeys.push("coordination");
  if (visibleModules.conflictReports && holdsConflictTeamTask) pinnedKeys.push("conflict-reports");
  if (visibleModules.feedback && holdsFeedbackReviewTask) pinnedKeys.push("feedback");
  if (visibleModules.eventScheduling && isEventOwner) pinnedKeys.push("schedule");
  if (visibleModules.recruitment && isRecruiter) pinnedKeys.push("recruitment");
  if (visibleModules.spatialPlanning && isSpatialHolder) pinnedKeys.push("spatial-planning");
  if (visibleModules.budget && isBudgetOwnerNow) pinnedKeys.push("budget");
  if (visibleModules.shifts && isShiftCoordinatorNow) pinnedKeys.push("shifts");
  if (visibleModules.kitchen && isKitchenOwnerNow) pinnedKeys.push("kitchen");

  // "While this Phase is current, pin its highlighted module for
  // everyone actually coming" — e.g. Recruitment during a Recruitment
  // phase so non-holders can still track progress and invite people;
  // Shifts once sign-ups matter, ahead of the event. Reuses
  // getCurrentPhase (src/lib/profile-questions/capacity.ts, already
  // established for Availability's phase-scoped question) rather than
  // a second "what's the current phase" resolution. Never bypasses
  // Community.modulesEnabled — only promotes an already-visible module.
  const outstandingRequiredQuestions = await listOutstandingRequiredQuestions(actor);

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

  // "The count on communication should include everything that is
  // included in communication" — the six Inbox types (input rounds,
  // messages, feedback, nominations, date invites, scheduling polls).
  // Every one of them is carried on the feed itself (see
  // src/lib/dashboard.ts), so this sum can never drift from what
  // /communication actually shows.
  const communicationBadgeCount =
    feed.pendingNominations.length +
    feed.calendarEventInvites.length +
    feed.inboxUnansweredQuestions.length +
    feed.inboxVisibleMessages.length +
    (feed.inboxFeedbackOpen ? 1 : 0) +
    feed.inboxFeedbackReviewCount +
    feed.inboxPollsNeedingMe.length;

  // Required profile questions this member still owes a real answer to.
  // Folded into taskBadgeCount below (so it rides the Dashboard badge
  // rather than earning a nav item of its own) but computed separately,
  // because the Dashboard's own element needs the real number to say "N
  // questions" rather than a task-feed total. This is also what makes the
  // one-click "I'm coming" on the Dashboard/Community event cards safe to
  // offer as a single click: recording participation without walking
  // someone through that event's questions would otherwise drop required
  // information on the floor with nothing chasing it. See
  // listOutstandingRequiredQuestions for exactly what counts.
  // Everything else on the feed is task-side — "your held-task
  // obligations": check-ins, attention flags, join requests into tasks
  // you hold (person-initiated but answered on the task page, so it
  // lives here), module-holder upkeep, and the coordinator-facing
  // expired-nomination notices. Rides the Dashboard nav item.
  //
  // The six module needs-action lists contribute their **personal** items
  // only (docs/open-permissions-plan.md D12). A `shared` item — outstanding
  // for the Community because its module is open, which nobody in particular
  // opted into — is not one of *your* held-task obligations, and summing both
  // would multiply the badge for every member of an open Community while
  // meaning something different for each of them.
  const taskBadgeCount =
    outstandingRequiredQuestions.length +
    feed.pendingJoinRequests.length +
    feed.upcomingCheckins.length +
    feed.flaggedHeldTasks.length +
    feed.recruitmentNeedsAction.personal.length +
    feed.placementInvites.length +
    feed.myLinkedPendingPlacements.length +
    feed.placementRevertNotices.length +
    feed.placementPendingReviews.length +
    feed.emergencyAccessActivity.length +
    feed.budgetNeedsAction.personal.length +
    feed.eventSchedulingNeedsAction.personal.length +
    feed.shiftCoordinatorNeedsAction.personal.length +
    feed.myShiftsNeedingCompletion.length +
    feed.conflictNeedsAction.personal.length +
    feed.kitchenNeedsAction.personal.length +
    feed.expiredNominations.length;

  return {
    memberName: actor.name,
    communityName: community.name,
    communityLogoUrl: community.logoUrl,
    communicationBadgeCount,
    taskBadgeCount,
    communityBadgeCount: openAssemblies.filter((a) => a.needsMyAnswer).length,
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

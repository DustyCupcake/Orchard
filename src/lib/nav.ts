import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCommunity } from "./settings/community";
import { isModuleEnabled } from "./modules";
import { isCoordinationHolder } from "./coordination";
import { isRecruitmentTaskHolder } from "./recruitment";
import { isEventSchedulingOwner } from "./event-scheduling/conflicts";
import { isSpatialPlanningHolder } from "./spatial-planning";
import { getCurrentBudgetCycle } from "./budget/cycles";
import { isBudgetOwner } from "./budget/voting";
import { listShiftSeries, isShiftCoordinator } from "./shifts/series";
import { getPersonalFeed } from "./dashboard";

type Member = typeof memberTable.$inferSelect;

// Whether the current viewer currently holds a given Community-level
// task pointer (conflictTeamTaskId, feedbackReviewTaskId, ...) — the
// same "access follows the task" join every module's own holder-check
// already does (see e.g. isRecruitmentTaskHolder), duplicated here
// rather than exported from each module, since this is purely a nav-
// decoration signal (what to auto-pin), not an authorization gate.
async function holdsTask(actor: Member, taskId: string | null) {
  if (!taskId) return false;
  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(eq(task.id, taskId), eq(taskAssignment.memberId, actor.id), eq(taskAssignment.isShadow, false)),
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
};

// Computed once per request (in the (app) shell layout) and handed to
// the Sidebar as plain props — everything here reuses each module's
// own existing holder/enablement checks rather than inventing new
// ones, so "who sees what pinned" always tracks the real authorization
// state instead of drifting into a second, nav-only notion of access.
export async function getNavContext(actor: Member): Promise<NavContext> {
  const community = await getCommunity(actor);

  const visibleModules = {
    eventScheduling: isModuleEnabled(community, "event_scheduling"),
    shifts: isModuleEnabled(community, "shifts"),
    recruitment: isModuleEnabled(community, "recruitment"),
    spatialPlanning: isModuleEnabled(community, "spatial_planning"),
    sensitiveData: isModuleEnabled(community, "sensitive_data"),
    budget: isModuleEnabled(community, "budget"),
    conflictReports: community.conflictTeamTaskId !== null,
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
  ] = await Promise.all([
    isCoordinationHolder(actor, null),
    holdsTask(actor, community.conflictTeamTaskId),
    holdsTask(actor, community.feedbackReviewTaskId),
    visibleModules.eventScheduling ? isEventSchedulingOwner(actor) : Promise.resolve(false),
    visibleModules.recruitment ? isRecruitmentTaskHolder(actor) : Promise.resolve(false),
    visibleModules.spatialPlanning ? isSpatialPlanningHolder(actor, community) : Promise.resolve(false),
    visibleModules.budget ? isAnyBudgetOwner(actor) : Promise.resolve(false),
    visibleModules.shifts ? isAnyShiftCoordinator(actor) : Promise.resolve(false),
    getPersonalFeed(actor),
  ]);

  const pinnedKeys: string[] = [];
  if (isCoordinator) pinnedKeys.push("coordination");
  if (visibleModules.conflictReports && holdsConflictTeamTask) pinnedKeys.push("conflict-reports");
  if (visibleModules.feedback && holdsFeedbackReviewTask) pinnedKeys.push("feedback");
  if (visibleModules.eventScheduling && isEventOwner) pinnedKeys.push("schedule");
  if (visibleModules.recruitment && isRecruiter) pinnedKeys.push("recruitment");
  if (visibleModules.spatialPlanning && isSpatialHolder) pinnedKeys.push("spatial-planning");
  if (visibleModules.budget && isBudgetOwnerNow) pinnedKeys.push("budget");
  if (visibleModules.shifts && isShiftCoordinatorNow) pinnedKeys.push("shifts");

  const badgeCount =
    feed.pendingJoinRequests.length +
    feed.upcomingCheckins.length +
    feed.flaggedHeldTasks.length +
    feed.recruitmentNeedsAction.length +
    feed.placementInvites.length +
    feed.myLinkedPendingPlacements.length +
    feed.placementRevertNotices.length +
    feed.placementPendingReviews.length +
    feed.calendarEventInvites.length;

  return { memberName: actor.name, badgeCount, isCoordinator, visibleModules, pinnedKeys };
}

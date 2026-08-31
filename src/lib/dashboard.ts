import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, participation, task, taskAssignment, taskJoinRequest } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCurrentCycle } from "./profile-questions";
import { isCoordinationHolder } from "./coordination";
import { getCompositionBreakdown } from "./composition";
import { listMyCalendarEventInvites } from "./calendar-events";
import { isModuleEnabled } from "./modules";
import { getCommunityRow, isRecruitmentTaskHolder, listRecruitmentActionItems } from "./recruitment";
import {
  isSpatialPlanningHolder,
  listMyLinkedPendingPlacements,
  listMyPlacementInvites,
  listMyRevertNotices,
  listPendingPlacementReviews,
} from "./spatial-planning";

type Member = typeof memberTable.$inferSelect;

// The personalized feed — "what's next on them," reading off state
// Phases 3/10/12 already produce, plus Recruitment's own needs-action
// signal for whoever holds that task (Phase 35) and, as of Phase 38,
// Spatial planning's own approvals/invites — closing this comment's
// own previously-deferred line. Onboarding progress is still out of
// scope; that subsystem doesn't exist yet. See docs/spec.md's
// Dashboard section ("Anyone invited to share a Placement sees that
// invite... anyone linked to a Placement that moves sees that too").
export async function getPersonalFeed(actor: Member) {
  const heldTaskRows = await db
    .select({
      taskId: task.id,
      title: task.title,
      status: task.status,
      attentionLevel: task.attentionLevel,
      nextCheckinAt: task.nextCheckinAt,
      branchName: branch.name,
    })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
        ne(task.status, "done"),
      ),
    );

  const flaggedHeldTasks = heldTaskRows
    .filter((t) => t.attentionLevel !== "ok")
    .map((t) => ({
      id: t.taskId,
      title: t.title,
      branchName: t.branchName,
      attentionLevel: t.attentionLevel,
    }));

  // "Waiting nudges due, upcoming check-ins" — one ordered list of
  // currently-Waiting held tasks with a check-in date set, soonest
  // first; the UI marks a past date as overdue rather than this
  // splitting into two separate lists.
  const upcomingCheckins = heldTaskRows
    .filter((t): t is typeof t & { nextCheckinAt: Date } => t.status === "waiting" && t.nextCheckinAt !== null)
    .map((t) => ({ id: t.taskId, title: t.title, branchName: t.branchName, nextCheckinAt: t.nextCheckinAt }))
    .sort((a, b) => a.nextCheckinAt.getTime() - b.nextCheckinAt.getTime());

  const heldTaskIds = heldTaskRows.map((t) => t.taskId);
  const pendingJoinRequests =
    heldTaskIds.length === 0
      ? []
      : await db
          .select({
            id: taskJoinRequest.id,
            taskId: taskJoinRequest.taskId,
            taskTitle: task.title,
            requestedByName: member.name,
            requestedAt: taskJoinRequest.requestedAt,
          })
          .from(taskJoinRequest)
          .innerJoin(task, eq(taskJoinRequest.taskId, task.id))
          .innerJoin(member, eq(taskJoinRequest.memberId, member.id))
          .where(
            and(inArray(taskJoinRequest.taskId, heldTaskIds), eq(taskJoinRequest.status, "pending")),
          )
          .orderBy(desc(taskJoinRequest.requestedAt));

  // "The needs-action signal... surfaced on the dashboard for anyone
  // holding a recruitment task" — closes Phase 24's own explicitly-
  // deferred "recruitment-facing feed items" line. Gated on both the
  // module being on and the actor currently holding the recruitment
  // task, checked here (not just left to listRecruitmentActionItems'
  // own throwing guard) so a non-holder's feed just omits the section
  // rather than needing a try/catch around it.
  const communityRow = await getCommunityRow(actor.communityId);
  const recruitmentNeedsAction =
    isModuleEnabled(communityRow, "recruitment") && (await isRecruitmentTaskHolder(actor))
      ? await listRecruitmentActionItems(actor)
      : [];

  // Same "check the gate here, not inside a try/catch" posture as
  // recruitmentNeedsAction just above — a non-holder's feed simply
  // omits placementPendingReviews rather than needing to catch
  // listPendingPlacementReviews' own throwing guard.
  const spatialPlanningOn = isModuleEnabled(communityRow, "spatial_planning");
  const isSpatialHolder = spatialPlanningOn && (await isSpatialPlanningHolder(actor, communityRow));
  const [placementInvites, myLinkedPendingPlacements, placementRevertNotices, placementPendingReviews] =
    spatialPlanningOn
      ? await Promise.all([
          listMyPlacementInvites(actor),
          listMyLinkedPendingPlacements(actor),
          listMyRevertNotices(actor),
          isSpatialHolder ? listPendingPlacementReviews(actor) : Promise.resolve([]),
        ])
      : [[], [], [], []];

  // Core, not module-gated — see docs/development-plan.md's Phase 42.
  const calendarEventInvites = await listMyCalendarEventInvites(actor);

  return {
    pendingJoinRequests,
    upcomingCheckins,
    flaggedHeldTasks,
    recruitmentNeedsAction,
    placementInvites,
    myLinkedPendingPlacements,
    placementRevertNotices,
    placementPendingReviews,
    calendarEventInvites,
  };
}

export type BranchHealthStatus = "on_track" | "attention_needed" | "struggling";

// A resolved interpretation, not numerically specified in spec (same
// kind of call src/lib/profile-questions/capacity.ts already makes for
// its own has_room/about_right/over thresholds): any hard-flagged or
// escalated task makes a branch "struggling" — those are already the
// two most serious attention levels Phase 10 produces; a soft flag
// with nothing worse is "attention needed"; no flags at all (or no
// active tasks) is "on track."
function deriveBranchHealthStatus(counts: { soft: number; hard: number; escalated: number }): BranchHealthStatus {
  if (counts.hard > 0 || counts.escalated > 0) return "struggling";
  if (counts.soft > 0) return "attention_needed";
  return "on_track";
}

// The always-visible Community snapshot panel — aggregate, anonymized,
// never broken out by individual. The community-average-contribution
// line is Phase 23/`/contribution`'s own TODO to close, not this
// panel's — see src/lib/contribution.ts's getContributionCommunityAverage.
export async function getCommunitySnapshot(actor: Member) {
  const [composition, activeTasks, isCoordHolder, currentCycle] = await Promise.all([
    getCompositionBreakdown(actor),
    db
      .select({ branchId: task.branchId, attentionLevel: task.attentionLevel })
      .from(task)
      .where(and(eq(task.communityId, actor.communityId), ne(task.status, "done"))),
    isCoordinationHolder(actor, null),
    getCurrentCycle(actor.communityId),
  ]);

  // Null (not zero) when there's no current cycle at all — a community
  // with cycles off, or none created yet, has no Participation concept
  // to count, which is a real, honest state, not zero people coming.
  const activeMemberCount = currentCycle
    ? (
        await db
          .select({ memberId: participation.memberId })
          .from(participation)
          .where(and(eq(participation.cycleId, currentCycle.id), eq(participation.status, "coming")))
      ).length
    : null;

  // Tier/Branch composition itself now lives in getCompositionBreakdown
  // (src/lib/composition.ts) — extracted so Recruitment's pipeline view
  // (Phase 35) can reuse it without importing this module back.
  // branchSpread's own {id, name} rows double as the branch list for
  // Branch health below, rather than a second branch query.
  const branchHealth = composition.branchSpread.map((b) => {
    const inBranch = activeTasks.filter((t) => t.branchId === b.id);
    const counts = {
      soft: inBranch.filter((t) => t.attentionLevel === "soft").length,
      hard: inBranch.filter((t) => t.attentionLevel === "hard").length,
      escalated: inBranch.filter((t) => t.attentionLevel === "escalated").length,
    };
    return {
      id: b.id,
      name: b.name,
      status: deriveBranchHealthStatus(counts),
      // Real flag counts only for coordination-view holders — see
      // docs/spec.md's Branch health: "the same signal without
      // exposing a number nobody agreed to publish" split already
      // used for capacity visibility.
      counts: isCoordHolder ? counts : null,
    };
  });

  return { tierCounts: composition.tierCounts, branchSpread: composition.branchSpread, branchHealth, activeMemberCount };
}

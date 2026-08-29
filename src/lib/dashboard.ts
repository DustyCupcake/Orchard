import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, participation, task, taskAssignment, taskJoinRequest, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { getCurrentCycle } from "./profile-questions";
import { isCoordinationHolder } from "./coordination";

type Member = typeof memberTable.$inferSelect;

// The personalized feed — "what's next on them," reading off state
// Phases 3/10/12 already produce. See docs/spec.md's Dashboard section.
// Recruitment-facing items, onboarding progress, and Spatial-planning
// approvals/invites stay out of scope per docs/development-plan.md's
// Phase 24 — none of those subsystems exist yet (Spatial planning is
// paused).
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

  return { pendingJoinRequests, upcomingCheckins, flaggedHeldTasks };
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
  const [branches, tiers, members, activeTasks, holdings, isCoordHolder, currentCycle] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, actor.communityId)),
    db.select().from(tier).where(eq(tier.communityId, actor.communityId)),
    db.select({ id: member.id, tierIds: member.tierIds }).from(member).where(eq(member.communityId, actor.communityId)),
    db
      .select({ branchId: task.branchId, attentionLevel: task.attentionLevel })
      .from(task)
      .where(and(eq(task.communityId, actor.communityId), ne(task.status, "done"))),
    db
      .select({ branchId: task.branchId, memberId: taskAssignment.memberId })
      .from(taskAssignment)
      .innerJoin(task, eq(taskAssignment.taskId, task.id))
      .where(
        and(
          eq(task.communityId, actor.communityId),
          eq(taskAssignment.isShadow, false),
          ne(task.status, "done"),
        ),
      ),
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

  const tierCounts = tiers.map((t) => ({
    id: t.id,
    name: t.name,
    count: members.filter((m) => m.tierIds.includes(t.id)).length,
  }));

  // Branch spread — a resolved interpretation: spec pairs this with
  // Tier/experience distribution as member *composition*, not task
  // volume (which Branch health, right below it, already covers) — so
  // this counts distinct members currently holding a real task in each
  // branch, not a task count. Branch membership itself is emergent
  // (no roster) per docs/spec.md's Branch section, so "who's in this
  // branch right now" only exists as a read of current holdings.
  const branchSpread = branches.map((b) => ({
    id: b.id,
    name: b.name,
    memberCount: new Set(holdings.filter((h) => h.branchId === b.id).map((h) => h.memberId)).size,
  }));

  const branchHealth = branches.map((b) => {
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

  return { tierCounts, branchSpread, branchHealth, activeMemberCount };
}

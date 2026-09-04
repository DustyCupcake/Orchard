import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { listGrantingTaskIds } from "../permissions";
import { getCommunity } from "./community";

type Member = typeof memberTable.$inferSelect;

// The first real access gate in the system — see docs/spec.md's
// "Community settings & Admins". "The Admins task" isn't a dedicated
// relationship; it's whichever community_endorsed task(s) have a real
// `admin`-module PermissionGrant row (docs/development-plan.md's Phase
// 63 — previously a Task.tags match against Community.adminsTag).
// Before any such task has ever actually been claimed, this falls back
// to "any member" — otherwise a fresh install would lock itself out of
// the one screen that could grant an Admins task into existence in the
// first place.
export async function requireAdmins(actor: Member) {
  const communityRow = await getCommunity(actor);
  if (!communityRow.adminsEverClaimed) {
    return;
  }

  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "admin");
  if (grantingTaskIds.length === 0) {
    throw new ForbiddenError("Only a current Admins holder can change community settings");
  }

  const [holding] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(task.communityId, actor.communityId),
        eq(task.openness, "community_endorsed"),
        inArray(taskAssignment.taskId, grantingTaskIds),
      ),
    );
  if (!holding) {
    throw new ForbiddenError("Only a current Admins holder can change community settings");
  }
}

// Non-throwing form — see docs/spec.md's "Create new branch" needs its
// own check" (Pack import review, Phase 55): whether a pack-importing
// actor holds Admins decides whether a newly-created branch resolves
// `confirmed` immediately or lands `pending` for later review, a
// branch rather than a rejection either way. Same canInitiateCycle-
// style try/catch wrapper this codebase already uses for the identical
// throw-vs-boolean split.
export async function isAdmin(actor: Member): Promise<boolean> {
  try {
    await requireAdmins(actor);
    return true;
  } catch {
    return false;
  }
}

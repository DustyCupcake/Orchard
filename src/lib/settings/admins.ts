import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { isModuleOpenToEveryone, listGrantingTaskIds } from "../permissions";
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
//
// The open-flag check goes **first, above the bootstrap** (D2). Both the
// bootstrap and an explicit open flag mean "every member may", so the
// order between them cannot change the answer today — but putting the
// deliberate setting first means a Community that opens Admin has said so
// explicitly and doesn't read as an artefact of never having claimed the
// task. It also means opening Admin is a way to *stop* relying on the
// bootstrap: a Community whose Admins task is unclaimed and unopen keeps
// the lockout guard, and one that opens Admin has chosen its state.
//
// Worth remembering when reading the rest of this gate: `admin` was never
// really single-holder. The granting task must be `community_endorsed`,
// and a community_endorsed task is created with `capacity: null`
// (tasks/crud.ts) — which is *unlimited* holders, since the capacity check
// is skipped for a null. So several people can already hold Admins
// simultaneously, and any one of them passes this gate.
export async function requireAdmins(actor: Member) {
  if (await isModuleOpenToEveryone(actor.communityId, "admin")) {
    return;
  }

  // No Admins grant at all means no Admins task exists to hold, which is
  // the same state as before the first one was ever made — and gets the
  // same answer: every member may. It has to, because otherwise it is a
  // trap with no way out. This used to be checked *after* the
  // ever-claimed latch and threw, so a community that removed its last
  // Admins grant (or whose granting task was deleted) was locked out of
  // the one screen that could make a new one, for ever, with no recovery
  // short of editing the database. A grant that exists but has nobody
  // holding it right now is a different state and stays gated: that is a
  // role waiting to be claimed, and the endorsement process is the way back.
  //
  // Removing the last grant is therefore a real decision, and
  // removePermissionGrant refuses to do it without being told it is meant.
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "admin");
  if (grantingTaskIds.length === 0) {
    return;
  }

  const communityRow = await getCommunity(actor);
  if (!communityRow.adminsEverClaimed) {
    return;
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

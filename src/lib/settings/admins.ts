import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError } from "../errors";
import { getCommunity } from "./community";

type Member = typeof memberTable.$inferSelect;

// The first real access gate in the system — see docs/spec.md's
// "Community settings & Admins". "The Admins task" isn't a dedicated
// relationship (see community.ts's schema comment on why); it's
// whichever community_endorsed task(s) carry the Community's
// adminsTag. Before any such task has ever actually been claimed, this
// falls back to "any member" — otherwise a fresh install would lock
// itself out of the one screen that could tag an Admins task into
// existence in the first place.
export async function requireAdmins(actor: Member) {
  const communityRow = await getCommunity(actor);
  if (!communityRow.adminsEverClaimed) {
    return;
  }

  const holdings = await db
    .select({ tags: task.tags })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(task.communityId, actor.communityId),
        eq(task.openness, "community_endorsed"),
      ),
    );

  const holdsAdmins = holdings.some((h) => h.tags.includes(communityRow.adminsTag));
  if (!holdsAdmins) {
    throw new ForbiddenError("Only a current Admins holder can change community settings");
  }
}

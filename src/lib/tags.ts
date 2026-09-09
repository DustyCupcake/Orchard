import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

// The shared suggestion source for every tag input in the app (member
// tags at /profile, task tags at /propose and proposal activation) — a
// member typing a skill should see tags already in use by *either*
// people or tasks, so the two vocabularies converge instead of drifting
// apart. Still just a suggestion (an autocomplete <datalist>), never a
// hard gate — free text is always accepted alongside these.
export async function listAllDistinctTags(actor: Member): Promise<string[]> {
  const [memberRows, taskRows] = await Promise.all([
    db.select({ tags: member.tags }).from(member).where(eq(member.communityId, actor.communityId)),
    db.select({ tags: task.tags }).from(task).where(eq(task.communityId, actor.communityId)),
  ]);
  const all = [...memberRows.flatMap((r) => r.tags), ...taskRows.flatMap((r) => r.tags)];
  return [...new Set(all)].sort();
}

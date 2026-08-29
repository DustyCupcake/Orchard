import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { branch, member, task, taskAssignment, tier } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";

type Member = typeof memberTable.$inferSelect;

// Tier and Branch composition — "who's already confirmed," by Tier or
// Branch. Extracted out of Phase 24's getCommunitySnapshot so it's a
// genuinely shared primitive rather than one module importing the
// other: the Recruitment pipeline view (Phase 35) shows the same
// breakdown alongside candidates in flight, per docs/spec.md's
// "informational context for keeping the group balanced, not a
// scoring formula" — reusing this instead of recomputing it.
export async function getCompositionBreakdown(actor: Member) {
  const [branches, tiers, members, holdings] = await Promise.all([
    db.select().from(branch).where(eq(branch.communityId, actor.communityId)),
    db.select().from(tier).where(eq(tier.communityId, actor.communityId)),
    db
      .select({ id: member.id, tierIds: member.tierIds })
      .from(member)
      .where(eq(member.communityId, actor.communityId)),
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
  ]);

  const tierCounts = tiers.map((t) => ({
    id: t.id,
    name: t.name,
    count: members.filter((m) => m.tierIds.includes(t.id)).length,
  }));

  // Distinct members currently holding a real task in each branch —
  // see getCommunitySnapshot's original comment (now here) for why
  // this is a holdings count, not a task tally: Branch membership
  // itself is emergent, no roster, per docs/spec.md's Branch section.
  const branchSpread = branches.map((b) => ({
    id: b.id,
    name: b.name,
    memberCount: new Set(holdings.filter((h) => h.branchId === b.id).map((h) => h.memberId)).size,
  }));

  return { tierCounts, branchSpread };
}

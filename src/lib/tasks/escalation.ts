import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { branch, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { requireCoordinationHolder } from "../coordination";

type Member = typeof memberTable.$inferSelect;

// "Unplaceable tasks surface in a shared 'needs an owner' view visible
// to all coordinators, with cross-branch placement encouraged" — see
// docs/spec.md's "Escalation" (Coordination mechanics). "Unplaceable"
// is read literally off Phase 10's attention_level: `escalated` is
// already the name that tier uses for exactly this — a critical task
// with no owner past its deadline (or a hard-flag past its own
// deadline, with phases off). Visible community-wide (branchId=null),
// not scoped to one branch, matching "cross-branch placement
// encouraged."
export async function listEscalatedTasks(actor: Member) {
  await requireCoordinationHolder(actor, null);

  return db
    .select({
      id: task.id,
      title: task.title,
      status: task.status,
      branchId: task.branchId,
      branchName: branch.name,
      critical: task.critical,
      createdAt: task.createdAt,
    })
    .from(task)
    .innerJoin(branch, eq(task.branchId, branch.id))
    .where(and(eq(task.communityId, actor.communityId), eq(task.attentionLevel, "escalated")))
    .orderBy(task.createdAt);
}

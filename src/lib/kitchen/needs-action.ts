import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { foodIdea, menuPlan, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { listGrantingTaskIds } from "../permissions";
import { isKitchenOwner } from "./access";

type Member = typeof memberTable.$inferSelect;

export type KitchenNeedsAction =
  | { kind: "draft_unpublished"; menuPlanId: string; title: string; cycleId: string | null }
  | { kind: "ideas_awaiting_review"; menuPlanId: string; title: string; openCount: number; cycleId: string | null };

// The scopes this holder actually owns, derived once from their held
// granting tasks' placements — the difference between "is a kitchen
// holder somewhere" (isKitchenOwner) and "can act on THIS plan".
async function ownedKitchenScopeIds(actor: Member): Promise<Set<string | null>> {
  const grantingTaskIds = await listGrantingTaskIds(actor.communityId, "kitchen");
  if (grantingTaskIds.length === 0) return new Set();
  const rows = await db
    .select({ cycleId: task.cycleId })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return new Set(rows.map((r) => r.cycleId));
}

// Dashboard's own needs-action surface — same graceful-[]-for-non-
// holders posture as listEventSchedulingNeedsAction: every member's
// Dashboard renders, but only a kitchen holder gets rows. Two flavors:
// a draft menu in an owned scope awaiting publish, and open ideas
// queued on a draft the holder can still act on (published plans lock
// adoption, so their ideas don't resurface here — the holder starts a
// new draft for them).
export async function listKitchenNeedsAction(actor: Member): Promise<KitchenNeedsAction[]> {
  if (!(await isKitchenOwner(actor))) return [];

  const ownedScopes = await ownedKitchenScopeIds(actor);
  const plans = await db.select().from(menuPlan).where(eq(menuPlan.communityId, actor.communityId));
  const drafts = plans.filter((p) => !p.publishedAt && ownedScopes.has(p.cycleId));
  const results: KitchenNeedsAction[] = [];

  for (const plan of drafts) {
    results.push({ kind: "draft_unpublished", menuPlanId: plan.id, title: plan.title, cycleId: plan.cycleId });
  }

  if (drafts.length > 0) {
    const draftIds = drafts.map((p) => p.id);
    const openIdeas = await db
      .select({ menuPlanId: foodIdea.menuPlanId })
      .from(foodIdea)
      .where(and(inArray(foodIdea.menuPlanId, draftIds), eq(foodIdea.status, "open")));
    const counts = new Map<string, number>();
    for (const idea of openIdeas) {
      counts.set(idea.menuPlanId, (counts.get(idea.menuPlanId) ?? 0) + 1);
    }
    for (const plan of drafts) {
      const openCount = counts.get(plan.id) ?? 0;
      if (openCount > 0) {
        results.push({ kind: "ideas_awaiting_review", menuPlanId: plan.id, title: plan.title, openCount, cycleId: plan.cycleId });
      }
    }
  }

  return results;
}
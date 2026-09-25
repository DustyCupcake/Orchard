import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { task, taskResource } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { isKitchenOwner } from "./access";

type Member = typeof memberTable.$inferSelect;

// The ordering/equipment lens (D7): tasks in the menu's scope that look
// like supply work, with their Task resources visible. The reference
// case (Fruit) tags its ordering/equipment tasks — the community
// defines those tags freely, and this is the baseline vocabulary that
// keeps the lens alive without hardcoding any one community's tags
// (docs/food-drinks-module-plan.md's D7). Extending it is a one-line
// change here.
const SUPPLY_TAG_KEYWORDS = ["ordering", "equipment", "supply", "shopping"];

function isSupplyTask(tags: string[]): boolean {
  return tags.some((tag) => SUPPLY_TAG_KEYWORDS.some((kw) => tag.toLowerCase().includes(kw)));
}

export type SupplyTaskRow = typeof task.$inferSelect & {
  resources: (typeof taskResource.$inferSelect)[];
};

// Owner-only lens: "the cook's view of the ordering/equipment tasks
// sitting alongside the menu." Gated so a member browsing the published
// menu doesn't see the supply logistics unless they hold the task.
export async function listSupplyTasks(actor: Member, cycleId?: string | null): Promise<SupplyTaskRow[]> {
  if (!(await isKitchenOwner(actor, cycleId))) return [];

  const conditions = [
    eq(task.communityId, actor.communityId),
    ne(task.status, "done"),
    cycleId === undefined ? undefined : cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
  ].filter((c) => c !== undefined);

  const openTasks = await db.select().from(task).where(and(...conditions));
  const supply = openTasks.filter((t) => isSupplyTask(t.tags));
  if (supply.length === 0) return [];

  const resources = await db
    .select()
    .from(taskResource)
    .where(inArray(taskResource.taskId, supply.map((t) => t.id)));
  const byTask = new Map<string, (typeof taskResource.$inferSelect)[]>();
  for (const r of resources) {
    const list = byTask.get(r.taskId) ?? [];
    list.push(r);
    byTask.set(r.taskId, list);
  }
  return supply.map((t) => ({ ...t, resources: byTask.get(t.id) ?? [] }));
}
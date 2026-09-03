import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  branch,
  cycle,
  phase,
  requirement,
  task,
  taskMilestone,
  taskPack,
  taskResource,
  taskWikiRevision,
  packPhase,
  taskPackItem,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { NotFoundError } from "../errors";
import { requireCycleInitiationEligibility, startBoundaryOf, endBoundaryOf } from "../cycles";
import { deriveClonedBoundaryRecipe } from "../dates";
import { packManifestInput } from "./crud";

type Member = typeof memberTable.$inferSelect;

export const exportCycleAsTaskPackInput = packManifestInput.extend({
  // Omit or empty = export every task currently in the cycle. Non-empty
  // = the hand-picked subset from the board's own bulk-selection
  // checkboxes (Phase 15) — reused as-is, not a second selection UI.
  taskIds: z.array(z.string().uuid()).optional(),
});
export type ExportCycleAsTaskPackInput = z.infer<typeof exportCycleAsTaskPackInput>;

// The same authority gate starting or cloning a cycle already uses —
// exporting is just "read out what's here," but treating it as
// equivalent to cycle-initiation eligibility matches this codebase's
// existing posture that whoever's trusted to shape a cycle is trusted
// to package it up too.
export async function exportCycleAsTaskPack(actor: Member, cycleId: string, input: ExportCycleAsTaskPackInput) {
  await requireCycleInitiationEligibility(actor);

  const [cycleRow] = await db.select().from(cycle).where(eq(cycle.id, cycleId));
  if (!cycleRow || cycleRow.communityId !== actor.communityId) {
    throw new NotFoundError("Cycle not found");
  }

  const phases = await db.select().from(phase).where(eq(phase.cycleId, cycleId)).orderBy(phase.order);
  // Real Phase.id -> the PackPhase.order it exports as, so tasks and
  // milestones anchored to a Phase can resolve their own phaseRef
  // below — every phase in the cycle is always exported regardless of
  // which tasks were picked, so this map is always complete for any
  // task actually in this cycle.
  const phaseOrderById = new Map(phases.map((p) => [p.id, p.order]));

  const allTasks = await db.select().from(task).where(eq(task.cycleId, cycleId));
  const selectedTaskIds = input.taskIds && input.taskIds.length > 0 ? new Set(input.taskIds) : null;
  const tasksToExport = selectedTaskIds ? allTasks.filter((t) => selectedTaskIds.has(t.id)) : allTasks;
  if (tasksToExport.length === 0) {
    throw new NotFoundError("No tasks to export — the cycle (or the selected subset) is empty");
  }

  const branchRows = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(eq(branch.communityId, actor.communityId));
  const branchNameById = new Map(branchRows.map((b) => [b.id, b.name]));

  const taskIdsToExport = tasksToExport.map((t) => t.id);
  const allRequirements = await db
    .select()
    .from(requirement)
    .where(inArray(requirement.taskId, taskIdsToExport));
  const requirementsByTask = new Map<string, typeof allRequirements>();
  for (const r of allRequirements) {
    const list = requirementsByTask.get(r.taskId) ?? [];
    list.push(r);
    requirementsByTask.set(r.taskId, list);
  }

  const allResources = await db.select().from(taskResource).where(inArray(taskResource.taskId, taskIdsToExport));
  const resourcesByTask = new Map<string, typeof allResources>();
  for (const res of allResources) {
    const list = resourcesByTask.get(res.taskId) ?? [];
    list.push(res);
    resourcesByTask.set(res.taskId, list);
  }

  // Only the current (latest) revision seeds the pack — same "carry the
  // summary, not the whole edit history" rule cloneWikiAndResources
  // already established for clone-previous-cycle.
  const allRevisions = await db
    .select()
    .from(taskWikiRevision)
    .where(inArray(taskWikiRevision.taskId, taskIdsToExport))
    .orderBy(desc(taskWikiRevision.editedAt));
  const currentWikiByTask = new Map<string, string>();
  for (const rev of allRevisions) {
    if (!currentWikiByTask.has(rev.taskId)) currentWikiByTask.set(rev.taskId, rev.content);
  }

  // Same relative-only, confirmed-only carry rule as
  // src/lib/cycles/crud.ts's cloneTaskMilestones — an absolute or still-
  // pending milestone doesn't survive export.
  const allMilestones = await db
    .select()
    .from(taskMilestone)
    .where(inArray(taskMilestone.taskId, taskIdsToExport));
  const carriedMilestonesByTask = new Map<string, typeof allMilestones>();
  for (const m of allMilestones) {
    if (m.dateType !== "relative" || m.status !== "confirmed") continue;
    const list = carriedMilestonesByTask.get(m.taskId) ?? [];
    list.push(m);
    carriedMilestonesByTask.set(m.taskId, list);
  }

  return db.transaction(async (tx) => {
    const [pack] = await tx
      .insert(taskPack)
      .values({
        communityId: actor.communityId,
        name: input.name,
        description: input.description ?? null,
        source: input.source ?? null,
        version: input.version ?? "1",
        domainTags: input.domainTags ?? [],
        createdBy: actor.id,
      })
      .returning();

    if (phases.length > 0) {
      await tx.insert(packPhase).values(
        phases.map((p) => {
          const start = deriveClonedBoundaryRecipe(startBoundaryOf(p), cycleRow.startDate);
          const end = deriveClonedBoundaryRecipe(endBoundaryOf(p), cycleRow.startDate);
          return {
            packId: pack.id,
            name: p.name,
            order: p.order,
            startRelativeMode: start.relativeMode,
            startOffsetAnchor: start.offsetAnchor,
            startOffsetDays: start.offsetDays,
            startPercent: start.percent,
            endRelativeMode: end.relativeMode,
            endOffsetAnchor: end.offsetAnchor,
            endOffsetDays: end.offsetDays,
            endPercent: end.percent,
          };
        }),
      );
    }

    await tx.insert(taskPackItem).values(
      tasksToExport.map((t) => ({
        packId: pack.id,
        branchNameHint: branchNameById.get(t.branchId) ?? "Unknown",
        phaseRef: t.phaseId ? (phaseOrderById.get(t.phaseId) ?? null) : null,
        title: t.title,
        description: t.description,
        tags: t.tags,
        effort: t.effort,
        effortMagnitude: t.effortMagnitude as object,
        critical: t.critical,
        capacity: t.capacity,
        openness: t.openness,
        endorsementThreshold: t.endorsementThreshold,
        requirements: (requirementsByTask.get(t.id) ?? []).map((r) => ({
          type: r.type,
          mode: r.mode,
          value: r.value,
        })),
        wikiSummarySeed: currentWikiByTask.get(t.id) ?? null,
        resources: (resourcesByTask.get(t.id) ?? []).map((res) => ({
          label: res.label,
          url: res.url,
          tag: res.tag,
        })),
        milestones: (carriedMilestonesByTask.get(t.id) ?? []).map((m) => ({
          label: m.label,
          anchorType: m.anchorType,
          relativeMode: m.relativeMode,
          offsetDays: m.offsetDays,
          percent: m.percent,
          phaseRef: m.phaseId ? (phaseOrderById.get(m.phaseId) ?? null) : null,
        })),
      })),
    );

    return pack;
  });
}

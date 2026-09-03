import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { branch, cycle, phase, requirement, task, taskMilestone, taskResource, taskWikiRevision } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "../errors";
import {
  requireCycleInitiationEligibility,
  requireCycleTypeInCommunity,
  type ClonePreview,
  type ClonePreviewMilestone,
  type ClonePreviewPhase,
} from "../cycles";
import { recomputeBoundary, type StoredBoundary } from "../dates";
import { isAdmin } from "../settings/admins";
import { getTaskPack } from "./crud";

type Member = typeof memberTable.$inferSelect;
type PackItemRow = Awaited<ReturnType<typeof getTaskPack>>["items"][number];
type PackPhaseRow = Awaited<ReturnType<typeof getTaskPack>>["phases"][number];

// --- Branch reconciliation preview ---
//
// See docs/spec.md's "Pack import review": grouped by distinct hint
// value, not by task — a 45-task/4-branch pack shows 4 rows. Each row
// starts pre-filled with an exact, case-insensitive name match against
// the destination's existing branches, or null (the review screen
// itself pre-populates "create new" with the hint text when this comes
// back null — nothing here needs to know that).
export interface BranchHintSuggestion {
  hint: string;
  suggestedBranchId: string | null;
}

export async function previewPackImportBranches(actor: Member, packId: string): Promise<BranchHintSuggestion[]> {
  const { items } = await getTaskPack(actor, packId);
  const distinctHints = [...new Set(items.map((i) => i.branchNameHint))];

  const existingBranches = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(eq(branch.communityId, actor.communityId));
  const byLowerName = new Map(existingBranches.map((b) => [b.name.toLowerCase(), b.id]));

  return distinctHints.map((hint) => ({
    hint,
    suggestedBranchId: byLowerName.get(hint.toLowerCase()) ?? null,
  }));
}

// --- Date preview ---
//
// Non-mutating — the pack-import counterpart to
// src/lib/cycles/crud.ts's previewClonePreviousCycle, computing exactly
// what commitPackImport below would produce, against a hypothetical
// destination start/end nobody's committed to yet. Sourced from a
// pack's own PackPhase/TaskPackItem rows (names, not live ids) rather
// than a live previous cycle, since this is the general cross-
// community case that function was deliberately never built for (see
// docs/development-plan.md's Phase 6 scope note). Reuses the exact
// same recomputeBoundary primitive, so a preview's numbers are
// guaranteed to match what actually lands.
function packBoundary(
  relativeMode: PackPhaseRow["startRelativeMode"],
  offsetAnchor: PackPhaseRow["startOffsetAnchor"],
  offsetDays: number | null,
  percent: number | null,
): StoredBoundary {
  if (!relativeMode) {
    return { dateType: "absolute", date: null, relativeMode: null, offsetAnchor: null, offsetDays: null, percent: null };
  }
  return { dateType: "relative", date: null, relativeMode, offsetAnchor, offsetDays, percent };
}

export async function previewPackImportDates(
  actor: Member,
  packId: string,
  hypotheticalStart: string | null,
  hypotheticalEnd: string | null,
): Promise<ClonePreview> {
  const { pack, phases, items } = await getTaskPack(actor, packId);

  const previewPhases: ClonePreviewPhase[] = phases.map((p) => {
    const start = recomputeBoundary(
      packBoundary(p.startRelativeMode, p.startOffsetAnchor, p.startOffsetDays, p.startPercent),
      hypotheticalStart,
      hypotheticalEnd,
    );
    const end = recomputeBoundary(
      packBoundary(p.endRelativeMode, p.endOffsetAnchor, p.endOffsetDays, p.endPercent),
      hypotheticalStart,
      hypotheticalEnd,
    );
    return { name: p.name, order: p.order, start: start.date, end: end.date };
  });
  const previewByOrder = new Map(previewPhases.map((p) => [p.order, p]));

  const previewMilestones: ClonePreviewMilestone[] = [];
  for (const item of items) {
    const milestones = item.milestones as {
      label: string;
      anchorType: string | null;
      relativeMode: "offset" | "percent" | null;
      offsetDays: number | null;
      percent: number | null;
      phaseRef: number | null;
    }[];
    for (const m of milestones) {
      const isPhaseAnchor = m.anchorType === "phase_start" || m.anchorType === "phase_end";
      const previewPhase = isPhaseAnchor && m.phaseRef !== null ? previewByOrder.get(m.phaseRef) : undefined;
      const start = isPhaseAnchor ? (previewPhase?.start ?? null) : hypotheticalStart;
      const end = isPhaseAnchor ? (previewPhase?.end ?? null) : hypotheticalEnd;
      const directionalAnchor = m.anchorType === "phase_start" || m.anchorType === "cycle_start" ? "cycle_start" : "cycle_end";
      const date = m.relativeMode
        ? recomputeBoundary(
            { dateType: "relative", date: null, relativeMode: m.relativeMode, offsetAnchor: directionalAnchor, offsetDays: m.offsetDays, percent: m.percent },
            start,
            end,
          ).date
        : null;
      previewMilestones.push({ taskTitle: item.title, label: m.label, phaseName: previewPhase?.name ?? null, date });
    }
  }

  return { sourceCycleName: pack.name, phases: previewPhases, milestones: previewMilestones };
}

// --- Commit ---

const hintResolution = z.discriminatedUnion("action", [
  z.object({ action: z.literal("use_existing"), branchId: z.string().uuid() }),
  z.object({ action: z.literal("create_new") }),
]);

export const commitPackImportInput = z.object({
  packId: z.string().uuid(),
  cycleName: z.string().min(1),
  cycleTypeId: z.string().uuid().nullable().optional(),
  // Covers every distinct branchNameHint not individually overridden
  // below. A hint left out here is only valid if every one of its
  // items has an entry in itemBranchOverrides instead (the declined-
  // then-reassigned path — see docs/spec.md's "Screen two").
  hintResolutions: z.record(z.string(), hintResolution),
  // Per-item branch pick — only meaningful for an item whose hint was
  // declined in review; takes precedence over hintResolutions for
  // that one item. Keyed by TaskPackItem.id.
  itemBranchOverrides: z.record(z.string().uuid(), z.string().uuid()).optional(),
});
export type CommitPackImportInput = z.infer<typeof commitPackImportInput>;

async function resolvePhaseRows(tx: Tx, newCycleId: string, phases: PackPhaseRow[]) {
  const phaseIdByOrder = new Map<number, string>();
  for (const p of phases) {
    const startRel = p.startRelativeMode !== null;
    const endRel = p.endRelativeMode !== null;
    const [newPhase] = await tx
      .insert(phase)
      .values({
        cycleId: newCycleId,
        name: p.name,
        order: p.order,
        startDateType: startRel ? "relative" : "absolute",
        startRelativeMode: p.startRelativeMode,
        startOffsetAnchor: p.startOffsetAnchor,
        startOffsetDays: p.startOffsetDays,
        startPercent: p.startPercent,
        endDateType: endRel ? "relative" : "absolute",
        endRelativeMode: p.endRelativeMode,
        endOffsetAnchor: p.endOffsetAnchor,
        endOffsetDays: p.endOffsetDays,
        endPercent: p.endPercent,
      })
      .returning();
    phaseIdByOrder.set(p.order, newPhase.id);
  }
  return phaseIdByOrder;
}

// Gated the same way starting (or exporting) a cycle already is —
// importing a pack is just another way of starting one. Whether a
// newly-created branch resolves confirmed or pending is a *separate*
// gate (Admins), checked once per commit and applied to every "create
// new" resolution in it — see docs/spec.md's "'Create new branch'
// needs its own check."
export async function commitPackImport(actor: Member, input: CommitPackImportInput) {
  await requireCycleInitiationEligibility(actor);
  if (input.cycleTypeId) {
    await requireCycleTypeInCommunity(actor.communityId, input.cycleTypeId);
  }

  const { pack, phases, items } = await getTaskPack(actor, input.packId);
  const actorIsAdmin = await isAdmin(actor);
  const existingBranches = await db
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.communityId, actor.communityId));
  const existingBranchIds = new Set(existingBranches.map((b) => b.id));

  return db.transaction(async (tx) => {
    const [newCycle] = await tx
      .insert(cycle)
      .values({
        communityId: actor.communityId,
        name: input.cycleName,
        status: "active",
        startedBy: actor.id,
        startedAt: new Date(),
        sourceType: "pack",
        sourcePackId: pack.id,
        cycleTypeId: input.cycleTypeId ?? null,
      })
      .returning();

    const phaseIdByOrder = await resolvePhaseRows(tx, newCycle.id, phases);

    // Resolved (or created) lazily, once per distinct hint — several
    // items sharing a hint all land on the same branch.
    const branchIdByHint = new Map<string, string>();

    async function resolveBranchForItem(item: PackItemRow): Promise<string> {
      const override = input.itemBranchOverrides?.[item.id];
      if (override) {
        if (!existingBranchIds.has(override)) {
          throw new NotFoundError("Reassigned branch not found in your community");
        }
        return override;
      }

      const cached = branchIdByHint.get(item.branchNameHint);
      if (cached) return cached;

      const resolution = input.hintResolutions[item.branchNameHint];
      if (!resolution) {
        throw new AppError(`No branch resolution given for "${item.branchNameHint}"`);
      }

      if (resolution.action === "use_existing") {
        if (!existingBranchIds.has(resolution.branchId)) {
          throw new NotFoundError("Branch not found in your community");
        }
        branchIdByHint.set(item.branchNameHint, resolution.branchId);
        return resolution.branchId;
      }

      const [created] = await tx
        .insert(branch)
        .values({
          communityId: actor.communityId,
          name: item.branchNameHint,
          status: actorIsAdmin ? "confirmed" : "pending",
        })
        .returning();
      branchIdByHint.set(item.branchNameHint, created.id);
      return created.id;
    }

    for (const item of items) {
      const branchId = await resolveBranchForItem(item);

      const [newTask] = await tx
        .insert(task)
        .values({
          communityId: actor.communityId,
          branchId,
          cycleId: newCycle.id,
          phaseId: item.phaseRef !== null ? (phaseIdByOrder.get(item.phaseRef) ?? null) : null,
          title: item.title,
          description: item.description,
          tags: item.tags,
          effort: item.effort,
          effortMagnitude: item.effortMagnitude as object,
          critical: item.critical,
          capacity: item.capacity,
          openness: item.openness,
          endorsementThreshold: item.endorsementThreshold,
          createdBy: actor.id,
        })
        .returning();

      const requirements = item.requirements as { type: string; mode: string; value: unknown }[];
      if (requirements.length > 0) {
        await tx.insert(requirement).values(
          requirements.map((r) => ({
            taskId: newTask.id,
            // Cast: requirement.type/mode are real enums; a pack's own
            // items were only ever populated by exportCycleAsTaskPack
            // or a zod-validated file upload, both already constrained
            // to these enums.
            type: r.type as (typeof requirement.$inferInsert)["type"],
            mode: r.mode as (typeof requirement.$inferInsert)["mode"],
            value: r.value as object,
          })),
        );
      }

      // Same "unmappable phase -> drop the milestone rather than
      // silently reinterpreting it as cycle-anchored" rule
      // src/lib/cycles/crud.ts's cloneTaskMilestones already applies.
      const milestones = item.milestones as {
        label: string;
        anchorType: "phase_start" | "phase_end" | "cycle_start" | "cycle_end" | null;
        relativeMode: "offset" | "percent" | null;
        offsetDays: number | null;
        percent: number | null;
        phaseRef: number | null;
      }[];
      const milestoneRows = milestones
        .map((m) => {
          const isPhaseAnchor = m.anchorType === "phase_start" || m.anchorType === "phase_end";
          const newPhaseId = m.phaseRef !== null ? phaseIdByOrder.get(m.phaseRef) : undefined;
          if (isPhaseAnchor && m.phaseRef !== null && !newPhaseId) return null;
          return {
            taskId: newTask.id,
            label: m.label,
            dateType: "relative" as const,
            absoluteDate: null,
            relativeMode: m.relativeMode,
            anchorType: m.anchorType,
            offsetDays: m.offsetDays,
            percent: m.percent,
            phaseId: isPhaseAnchor ? (newPhaseId ?? null) : null,
            status: "confirmed" as const,
            proposedBy: actor.id,
            createdBy: actor.id,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
      if (milestoneRows.length > 0) {
        await tx.insert(taskMilestone).values(milestoneRows);
      }

      // Attribution falls to the importing actor, never a member id
      // carried in the pack — the pack stores no such reference in
      // the first place (see task-pack.ts's own comment).
      if (item.wikiSummarySeed) {
        await tx.insert(taskWikiRevision).values({ taskId: newTask.id, content: item.wikiSummarySeed, editedBy: actor.id });
      }

      const resources = item.resources as { label: string; url: string; tag: string | null }[];
      if (resources.length > 0) {
        await tx.insert(taskResource).values(
          resources.map((r) => ({ taskId: newTask.id, addedBy: actor.id, label: r.label, url: r.url, tag: r.tag })),
        );
      }
    }

    return newCycle;
  });
}

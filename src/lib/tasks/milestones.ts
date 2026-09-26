import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { cycle, phase, task, taskAssignment, taskMilestone } from "@/db/schema";
import type { member as memberTable, task as taskTable, taskAssignment as taskAssignmentTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { normalizeBoundary, recomputeBoundary, toStoredBoundary, type RelativeBasis, type StoredBoundary } from "../dates";
import { getTask } from "./crud";

type Member = typeof memberTable.$inferSelect;
type TaskRow = typeof taskTable.$inferSelect & { assignments: (typeof taskAssignmentTable.$inferSelect)[] };
type MilestoneRow = typeof taskMilestone.$inferSelect;
type ParentType = "cycle" | "phase";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD");
const relativeBasis = z.enum(["start", "end", "between"]);

export const milestoneDateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("absolute"), date: isoDate }),
  z
    .object({
      type: z.literal("relative"),
      date: isoDate,
      parent: z.enum(["cycle", "phase"]),
      phaseId: z.string().uuid().nullable().optional(),
      basis: relativeBasis.optional(),
      value: z.number().int().optional(),
    })
    .refine((v) => (v.basis === undefined) === (v.value === undefined), {
      message: "relative basis and value must be supplied together",
    }),
]);
export type MilestoneDateInput = z.infer<typeof milestoneDateInput>;

export const createTaskMilestoneInput = z.object({
  label: z.string().min(1),
  date: milestoneDateInput,
  isDeadline: z.boolean().optional(),
});
export type CreateTaskMilestoneInput = z.infer<typeof createTaskMilestoneInput>;

export const updateTaskMilestoneInput = z.object({
  label: z.string().min(1).optional(),
  date: milestoneDateInput.optional(),
  isDeadline: z.boolean().optional(),
});
export type UpdateTaskMilestoneInput = z.infer<typeof updateTaskMilestoneInput>;

// At most one milestone per task carries isDeadline — auto-transferred,
// not blocked with an error: unlike Form fields, milestones are added/edited
// one at a time with no natural "unset the old one first" step.
async function clearOtherDeadlines(tx: Tx, taskId: string, keepMilestoneId: string | null) {
  await tx
    .update(taskMilestone)
    .set({ isDeadline: false })
    .where(
      keepMilestoneId
        ? and(eq(taskMilestone.taskId, taskId), ne(taskMilestone.id, keepMilestoneId))
        : eq(taskMilestone.taskId, taskId),
    );
}

async function fetchParentBoundary(
  taskRow: { cycleId: string | null },
  parent: ParentType,
  effectivePhaseId: string | null,
): Promise<{ start: string | null; end: string | null }> {
  if (parent === "phase") {
    if (!effectivePhaseId) return { start: null, end: null };
    const [phaseRow] = await db
      .select({ startDate: phase.startDate, endDate: phase.endDate })
      .from(phase)
      .where(eq(phase.id, effectivePhaseId));
    return { start: phaseRow?.startDate ?? null, end: phaseRow?.endDate ?? null };
  }
  if (!taskRow.cycleId) return { start: null, end: null };
  const [cycleRow] = await db
    .select({ startDate: cycle.startDate, endDate: cycle.endDate })
    .from(cycle)
    .where(eq(cycle.id, taskRow.cycleId));
  return { start: cycleRow?.startDate ?? null, end: cycleRow?.endDate ?? null };
}

// Write-time only: resolves the effective Phase (defaulting to the task's
// own) and enforces the one cross-Cycle constraint.
async function resolveAndValidateParent(
  taskRow: { cycleId: string | null; phaseId: string | null },
  parent: ParentType,
  requestedPhaseId: string | null | undefined,
): Promise<{ start: string | null; end: string | null; phaseId: string | null }> {
  if (parent === "cycle") {
    const { start, end } = await fetchParentBoundary(taskRow, parent, null);
    return { start, end, phaseId: null };
  }

  const phaseId = requestedPhaseId ?? taskRow.phaseId ?? null;
  if (!phaseId) return { start: null, end: null, phaseId: null };

  const [phaseRow] = await db.select().from(phase).where(eq(phase.id, phaseId));
  if (!phaseRow) throw new NotFoundError("Phase not found");
  if (taskRow.cycleId && phaseRow.cycleId !== taskRow.cycleId) {
    throw new ConflictError("A milestone's Phase must belong to the task's own event");
  }
  return { start: phaseRow.startDate, end: phaseRow.endDate, phaseId };
}

interface MilestoneColumns {
  dateType: "absolute" | "relative";
  absoluteDate: string | null;
  relativeBasis: RelativeBasis | null;
  relativeValue: number | null;
  parentType: ParentType | null;
  phaseId: string | null;
}

async function columnsFromInput(
  taskRow: { cycleId: string | null; phaseId: string | null },
  input: MilestoneDateInput,
): Promise<MilestoneColumns> {
  if (input.type === "absolute") {
    return {
      dateType: "absolute",
      absoluteDate: input.date,
      relativeBasis: null,
      relativeValue: null,
      parentType: null,
      phaseId: null,
    };
  }

  const { start, end } = await resolveAndValidateParent(taskRow, input.parent, input.phaseId);
  const boundary = toStoredBoundary(
    {
      type: "relative",
      date: input.date,
      ...(input.basis !== undefined && input.value !== undefined
        ? { basis: input.basis, value: input.value }
        : {}),
    },
    start,
    end,
  );
  return {
    dateType: "relative",
    absoluteDate: null,
    relativeBasis: boundary.relativeBasis,
    relativeValue: boundary.relativeValue,
    parentType: input.parent,
    // null means the task's own Phase; only an explicit cross-Phase
    // choice is materialized as a live phaseId.
    phaseId: input.parent === "phase" ? (input.phaseId ?? null) : null,
  };
}

function storedBoundaryOf(m: MilestoneRow): StoredBoundary {
  return {
    dateType: m.dateType,
    date: m.absoluteDate,
    relativeBasis: m.relativeBasis,
    relativeValue: m.relativeValue,
  };
}

export interface MilestoneResolution {
  resolvedDate: string | null;
}

export async function resolveMilestone(
  taskRow: { cycleId: string | null; phaseId: string | null },
  m: MilestoneRow,
): Promise<MilestoneResolution> {
  if (m.dateType === "absolute") return { resolvedDate: m.absoluteDate };
  if (!m.parentType || !m.relativeBasis || m.relativeValue === null) return { resolvedDate: null };

  const effectivePhaseId = m.parentType === "phase" ? (m.phaseId ?? taskRow.phaseId ?? null) : null;
  const { start, end } = await fetchParentBoundary(taskRow, m.parentType, effectivePhaseId);
  return { resolvedDate: recomputeBoundary(storedBoundaryOf(m), start, end).date };
}

function currentlyHolds(taskRow: TaskRow, actorId: string): boolean {
  return taskRow.assignments.some((a) => a.memberId === actorId && !a.isShadow);
}

function hasAnyHolder(taskRow: TaskRow): boolean {
  return taskRow.assignments.some((a) => !a.isShadow);
}

export async function listTaskMilestones(actor: Member, taskId: string) {
  const taskRow = await getTask(actor, taskId);
  const rows = await db.select().from(taskMilestone).where(eq(taskMilestone.taskId, taskId)).orderBy(taskMilestone.createdAt);
  const resolved = await Promise.all(rows.map(async (m) => ({ ...m, ...(await resolveMilestone(taskRow, m)) })));
  resolved.sort((a, b) => {
    if (a.resolvedDate === null && b.resolvedDate === null) return a.createdAt.getTime() - b.createdAt.getTime();
    if (a.resolvedDate === null) return 1;
    if (b.resolvedDate === null) return -1;
    if (a.resolvedDate !== b.resolvedDate) return a.resolvedDate < b.resolvedDate ? -1 : 1;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });
  return resolved;
}

export async function listMyTaskMilestones(actor: Member) {
  const heldTasks = await db
    .select({ taskId: task.id, title: task.title, cycleId: task.cycleId, phaseId: task.phaseId })
    .from(taskAssignment)
    .innerJoin(task, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
        eq(task.communityId, actor.communityId),
        ne(task.status, "done"),
      ),
    );
  if (heldTasks.length === 0) return [];

  const taskById = new Map(heldTasks.map((t) => [t.taskId, t]));
  const rows = await db
    .select()
    .from(taskMilestone)
    .where(and(inArray(taskMilestone.taskId, [...taskById.keys()]), eq(taskMilestone.status, "confirmed")));

  return Promise.all(
    rows.map(async (m) => {
      const t = taskById.get(m.taskId)!;
      return {
        ...m,
        taskTitle: t.title,
        taskCycleId: t.cycleId,
        taskPhaseId: t.phaseId,
        ...(await resolveMilestone(t, m)),
      };
    }),
  );
}

export async function createTaskMilestone(actor: Member, taskId: string, rawInput: CreateTaskMilestoneInput) {
  const input = createTaskMilestoneInput.parse(rawInput);
  const taskRow = await getTask(actor, taskId);
  const columns = await columnsFromInput(taskRow, input.date);
  const status = currentlyHolds(taskRow, actor.id) || !hasAnyHolder(taskRow) ? "confirmed" : "pending";
  const isDeadline = input.isDeadline ?? false;

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(taskMilestone)
      .values({ taskId, label: input.label, ...columns, isDeadline, status, proposedBy: actor.id, createdBy: actor.id })
      .returning();
    if (isDeadline) await clearOtherDeadlines(tx, taskId, row.id);
    return row;
  });
  return { ...created, ...(await resolveMilestone(taskRow, created)) };
}

export async function updateTaskMilestone(actor: Member, milestoneId: string, rawInput: UpdateTaskMilestoneInput) {
  const input = updateTaskMilestoneInput.parse(rawInput);
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) throw new NotFoundError("Milestone not found");
  const taskRow = await getTask(actor, existing.taskId);
  if (!currentlyHolds(taskRow, actor.id)) {
    throw new ForbiddenError("Only a current holder of this task can edit a milestone");
  }

  let columns: MilestoneColumns | undefined;
  if (input.date) {
    const relativeInput = input.date.type === "relative" ? input.date : null;
    let preserved: StoredBoundary | null = null;
    if (relativeInput && existing.dateType === "relative" && relativeInput.parent === existing.parentType) {
      const requestedPhase = relativeInput.parent === "phase" ? (relativeInput.phaseId ?? taskRow.phaseId) : null;
      const existingPhase = existing.parentType === "phase" ? (existing.phaseId ?? taskRow.phaseId) : null;
      if (requestedPhase === existingPhase) {
        const parent = await resolveAndValidateParent(taskRow, relativeInput.parent, relativeInput.phaseId);
        preserved = normalizeBoundary(storedBoundaryOf(existing), parent.start, parent.end);
      }
    }
    const preserveRecipe =
      preserved !== null && relativeInput?.date === preserved.date && relativeInput.basis === undefined;
    columns = preserveRecipe
      ? {
          dateType: "relative",
          absoluteDate: null,
          relativeBasis: preserved!.relativeBasis,
          relativeValue: preserved!.relativeValue,
          parentType: existing.parentType,
          phaseId: existing.phaseId,
        }
      : await columnsFromInput(taskRow, input.date);
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(taskMilestone)
      .set({
        ...(input.label !== undefined && { label: input.label }),
        ...(columns ?? {}),
        ...(input.isDeadline !== undefined && { isDeadline: input.isDeadline }),
      })
      .where(eq(taskMilestone.id, milestoneId))
      .returning();
    if (input.isDeadline) await clearOtherDeadlines(tx, existing.taskId, row.id);
    return row;
  });
  return { ...updated, ...(await resolveMilestone(taskRow, updated)) };
}

export async function deleteTaskMilestone(actor: Member, milestoneId: string) {
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) throw new NotFoundError("Milestone not found");
  const taskRow = await getTask(actor, existing.taskId);
  if (!currentlyHolds(taskRow, actor.id)) throw new ForbiddenError("Only a current holder of this task can remove a milestone");
  await db.delete(taskMilestone).where(eq(taskMilestone.id, milestoneId));
}

export async function confirmTaskMilestone(actor: Member, milestoneId: string) {
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) throw new NotFoundError("Milestone not found");
  if (existing.status !== "pending") throw new ConflictError("This milestone has no pending change to confirm");
  const taskRow = await getTask(actor, existing.taskId);
  if (!currentlyHolds(taskRow, actor.id)) throw new ForbiddenError("Only a current holder of this task can confirm a milestone");
  const [updated] = await db
    .update(taskMilestone)
    .set({ status: "confirmed", createdBy: actor.id })
    .where(eq(taskMilestone.id, milestoneId))
    .returning();
  return { ...updated, ...(await resolveMilestone(taskRow, updated)) };
}

export async function getTaskDeadline(
  taskRow: { cycleId: string | null; phaseId: string | null },
  deadlineMilestone: MilestoneRow | null,
  phaseEndDate: string | null,
): Promise<string | null> {
  if (deadlineMilestone) {
    const { resolvedDate } = await resolveMilestone(taskRow, deadlineMilestone);
    if (resolvedDate) return resolvedDate;
  }
  return phaseEndDate;
}

// Re-canonicalize milestone recipes when a parent period gains its second
// boundary. Ordinary moves of an already-bounded parent do not need this
// call: percent and signed outside-offset recipes remain canonical.
export async function normalizeTaskMilestonesForCycle(cycleId: string) {
  const cyclePhases = await db.select({ id: phase.id }).from(phase).where(eq(phase.cycleId, cycleId));
  const phaseIds = cyclePhases.map((p) => p.id);
  const tasks = await db
    .select({ id: task.id, cycleId: task.cycleId, phaseId: task.phaseId })
    .from(task)
    .where(eq(task.cycleId, cycleId));
  const extraTasks = phaseIds.length
    ? await db
        .select({ id: task.id, cycleId: task.cycleId, phaseId: task.phaseId })
        .from(task)
        .where(inArray(task.phaseId, phaseIds))
    : [];
  const taskRows = [...tasks, ...extraTasks.filter((t) => !tasks.some((x) => x.id === t.id))];
  if (taskRows.length === 0) return;
  const rows = await db
    .select()
    .from(taskMilestone)
    .where(and(inArray(taskMilestone.taskId, taskRows.map((t) => t.id)), eq(taskMilestone.dateType, "relative")));
  for (const row of rows) {
    const taskRow = taskRows.find((t) => t.id === row.taskId);
    if (!taskRow) continue;
    await normalizeMilestoneRow(taskRow, row);
  }
}

export async function normalizeTaskMilestonesForPhase(phaseId: string) {
  const taskRows = await db
    .select({ id: task.id, cycleId: task.cycleId, phaseId: task.phaseId })
    .from(task)
    .where(eq(task.phaseId, phaseId));
  const explicitRows = await db
    .select({ taskId: taskMilestone.taskId })
    .from(taskMilestone)
    .where(and(eq(taskMilestone.phaseId, phaseId), eq(taskMilestone.dateType, "relative")));
  const all = [...taskRows];
  for (const { taskId } of explicitRows) {
    if (all.some((t) => t.id === taskId)) continue;
    const [row] = await db.select({ id: task.id, cycleId: task.cycleId, phaseId: task.phaseId }).from(task).where(eq(task.id, taskId));
    if (row) all.push(row);
  }
  if (all.length === 0) return;
  const rows = await db
    .select()
    .from(taskMilestone)
    .where(and(inArray(taskMilestone.taskId, all.map((t) => t.id)), eq(taskMilestone.dateType, "relative")));
  for (const row of rows) {
    const taskRow = all.find((t) => t.id === row.taskId);
    if (taskRow) await normalizeMilestoneRow(taskRow, row);
  }
}

async function normalizeMilestoneRow(taskRow: { cycleId: string | null; phaseId: string | null }, row: MilestoneRow) {
  if (!row.parentType || !row.relativeBasis || row.relativeValue === null) return;
  const effectivePhaseId = row.parentType === "phase" ? (row.phaseId ?? taskRow.phaseId ?? null) : null;
  const { start, end } = await fetchParentBoundary(taskRow, row.parentType, effectivePhaseId);
  const normalized = normalizeBoundary(storedBoundaryOf(row), start, end);
  if (
    normalized.date === row.absoluteDate &&
    normalized.relativeBasis === row.relativeBasis &&
    normalized.relativeValue === row.relativeValue
  ) {
    return;
  }
  await db
    .update(taskMilestone)
    .set({ relativeBasis: normalized.relativeBasis, relativeValue: normalized.relativeValue })
    .where(eq(taskMilestone.id, row.id));
}

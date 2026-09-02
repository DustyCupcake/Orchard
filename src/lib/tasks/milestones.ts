import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cycle, phase, task, taskAssignment, taskMilestone } from "@/db/schema";
import type { member as memberTable, task as taskTable, taskAssignment as taskAssignmentTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { addDays, daysBetween, percentBetween, resolvePercent } from "../dates";
import { getTask } from "./crud";

type Member = typeof memberTable.$inferSelect;
type TaskRow = typeof taskTable.$inferSelect & { assignments: (typeof taskAssignmentTable.$inferSelect)[] };
type MilestoneRow = typeof taskMilestone.$inferSelect;
type AnchorType = "phase_start" | "phase_end" | "cycle_start" | "cycle_end";

const anchorTypeSchema = z.enum(["phase_start", "phase_end", "cycle_start", "cycle_end"]);

// The shared absolute/relative date shape (docs/spec.md's Task
// milestones), generalized from Phase 39's src/lib/dates/resolve.ts to
// a 4-way anchor — a milestone's parent can be a Phase or the task's
// own Cycle, unlike a Phase boundary's parent, which is always its own
// Cycle. Both interaction paths spec calls for are supported: type an
// offset/percent directly, or give a target date to reverse-compute it
// from — never a bare date persisted either way.
export const milestoneDateInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("absolute"), date: z.string().min(1) }),
  z
    .object({
      type: z.literal("relative_offset"),
      anchor: anchorTypeSchema,
      // Only meaningful when anchor is phase_start/phase_end — null/
      // omitted defaults to the task's own Phase.
      phaseId: z.string().uuid().nullable().optional(),
      offsetDays: z.number().int().optional(),
      targetDate: z.string().min(1).optional(),
    })
    .refine((v) => v.offsetDays !== undefined || v.targetDate !== undefined, {
      message: "relative_offset needs either offsetDays or targetDate",
    }),
  z
    .object({
      type: z.literal("relative_percent"),
      anchor: anchorTypeSchema,
      phaseId: z.string().uuid().nullable().optional(),
      percent: z.number().int().min(0).max(100).optional(),
      targetDate: z.string().min(1).optional(),
    })
    .refine((v) => v.percent !== undefined || v.targetDate !== undefined, {
      message: "relative_percent needs either percent or targetDate",
    }),
]);
export type MilestoneDateInput = z.infer<typeof milestoneDateInput>;

export const createTaskMilestoneInput = z.object({
  label: z.string().min(1),
  date: milestoneDateInput,
});
export type CreateTaskMilestoneInput = z.infer<typeof createTaskMilestoneInput>;

export const updateTaskMilestoneInput = z.object({
  label: z.string().min(1).optional(),
  date: milestoneDateInput.optional(),
});
export type UpdateTaskMilestoneInput = z.infer<typeof updateTaskMilestoneInput>;

function isPhaseAnchor(anchor: AnchorType): anchor is "phase_start" | "phase_end" {
  return anchor === "phase_start" || anchor === "phase_end";
}

// Plain lookup, no validation — safe to call at read time against an
// already-stored (and previously-validated) milestone, even if its
// Phase/Cycle has since vanished or drifted out of the constraint
// resolveAndValidateAnchor enforces at write time.
async function fetchParentBoundary(
  taskRow: { cycleId: string | null },
  anchor: AnchorType,
  effectivePhaseId: string | null,
): Promise<{ start: string | null; end: string | null }> {
  if (isPhaseAnchor(anchor)) {
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

// Write-time only: resolves the effective phaseId (defaulting to the
// task's own) and enforces the one structural constraint spec names —
// "a milestone's Phase, when set, should belong to the same Cycle as
// the task's own" (the one exception: a task with no Cycle at all, per
// spec's own carve-out). Read-time resolution uses the lighter
// fetchParentBoundary above instead — a stored milestone should never
// fail to resolve just because something drifted after the fact.
async function resolveAndValidateAnchor(
  taskRow: { cycleId: string | null; phaseId: string | null },
  anchor: AnchorType,
  requestedPhaseId: string | null | undefined,
): Promise<{ start: string | null; end: string | null; phaseId: string | null }> {
  if (!isPhaseAnchor(anchor)) {
    const { start, end } = await fetchParentBoundary(taskRow, anchor, null);
    return { start, end, phaseId: null };
  }

  const phaseId = requestedPhaseId ?? taskRow.phaseId ?? null;
  if (!phaseId) return { start: null, end: null, phaseId: null };

  const [phaseRow] = await db.select().from(phase).where(eq(phase.id, phaseId));
  if (!phaseRow) {
    throw new NotFoundError("Phase not found");
  }
  if (taskRow.cycleId && phaseRow.cycleId !== taskRow.cycleId) {
    throw new ConflictError("A milestone's Phase must belong to the task's own Cycle");
  }
  return { start: phaseRow.startDate, end: phaseRow.endDate, phaseId };
}

interface MilestoneColumns {
  dateType: "absolute" | "relative";
  absoluteDate: string | null;
  relativeMode: "offset" | "percent" | null;
  anchorType: AnchorType | null;
  offsetDays: number | null;
  percent: number | null;
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
      relativeMode: null,
      anchorType: null,
      offsetDays: null,
      percent: null,
      phaseId: null,
    };
  }

  const { start, end, phaseId } = await resolveAndValidateAnchor(taskRow, input.anchor, input.phaseId);
  let offsetDays: number | null = null;
  let percent: number | null = null;

  if (input.type === "relative_offset") {
    if (input.offsetDays !== undefined) {
      offsetDays = input.offsetDays;
    } else if (input.targetDate) {
      const anchorDate = input.anchor === "phase_start" || input.anchor === "cycle_start" ? start : end;
      if (!anchorDate) {
        throw new AppError(
          "Can't drag to a date — this milestone's anchor has no resolvable date yet; type the offset directly instead",
        );
      }
      offsetDays = daysBetween(anchorDate, input.targetDate);
    }
  } else if (input.percent !== undefined) {
    percent = input.percent;
  } else if (input.targetDate) {
    if (!start || !end) {
      throw new AppError(
        "Can't drag to a date — this milestone's parent has no resolvable start/end yet; type the percent directly instead",
      );
    }
    percent = percentBetween(start, end, input.targetDate);
  }

  const relativeMode = input.type === "relative_offset" ? ("offset" as const) : ("percent" as const);
  return { dateType: "relative", absoluteDate: null, relativeMode, anchorType: input.anchor, offsetDays, percent, phaseId };
}

export interface MilestoneResolution {
  resolvedDate: string | null;
  drifted: boolean;
}

function isMilestoneDrifted(resolvedDate: string, start: string, end: string, anchorType: AnchorType): boolean {
  const distToStart = Math.abs(daysBetween(resolvedDate, start));
  const distToEnd = Math.abs(daysBetween(resolvedDate, end));
  const anchoredToStart = anchorType === "phase_start" || anchorType === "cycle_start";
  return (distToStart <= distToEnd) !== anchoredToStart;
}

// Live-computed, never persisted — unlike Phase's own start_date/
// end_date (Phase 39's deliberate, documented exception), nothing
// pre-existing reads a TaskMilestone date expecting a plain column, so
// this defaults back to this codebase's usual posture.
export async function resolveMilestone(
  taskRow: { cycleId: string | null; phaseId: string | null },
  m: MilestoneRow,
): Promise<MilestoneResolution> {
  if (m.dateType === "absolute" || !m.anchorType) {
    return { resolvedDate: m.dateType === "absolute" ? m.absoluteDate : null, drifted: false };
  }

  const effectivePhaseId = isPhaseAnchor(m.anchorType) ? (m.phaseId ?? taskRow.phaseId ?? null) : null;
  const { start, end } = await fetchParentBoundary(taskRow, m.anchorType, effectivePhaseId);

  if (m.relativeMode === "offset") {
    const anchorDate = m.anchorType === "phase_start" || m.anchorType === "cycle_start" ? start : end;
    if (!anchorDate || m.offsetDays === null) return { resolvedDate: null, drifted: false };
    const resolvedDate = addDays(anchorDate, m.offsetDays);
    return { resolvedDate, drifted: start && end ? isMilestoneDrifted(resolvedDate, start, end, m.anchorType) : false };
  }

  // percent mode is structurally immune to drift — see resolve.ts's
  // isBoundaryDrifted.
  return { resolvedDate: resolvePercent(start, end, m.percent), drifted: false };
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
  return Promise.all(rows.map(async (m) => ({ ...m, ...(await resolveMilestone(taskRow, m)) })));
}

// The Calendar view's own layer (docs/development-plan.md's Phase 44) —
// "their own task milestones," read as every confirmed milestone on a
// task the actor currently holds (non-shadow, not done), the same
// currently-held scoping src/lib/dashboard.ts's getPersonalFeed already
// uses for flaggedHeldTasks/upcomingCheckins. A still-pending milestone
// doesn't belong on a read-only calendar — it isn't real yet.
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
      const resolution = await resolveMilestone(t, m);
      return { ...m, taskTitle: t.title, ...resolution };
    }),
  );
}

// "Confirmation follows ownership" — reuses Phase 38's propose→pending→
// approve pattern rather than reinventing it: the task's current
// holder adds directly (confirmed immediately), an unclaimed task has
// no holder to gate against (also confirmed immediately), and anyone
// else's addition lands pending until a holder confirms or rejects it.
export async function createTaskMilestone(actor: Member, taskId: string, rawInput: CreateTaskMilestoneInput) {
  const input = createTaskMilestoneInput.parse(rawInput);
  const taskRow = await getTask(actor, taskId);
  const columns = await columnsFromInput(taskRow, input.date);

  const status = currentlyHolds(taskRow, actor.id) || !hasAnyHolder(taskRow) ? "confirmed" : "pending";

  const [created] = await db
    .insert(taskMilestone)
    .values({ taskId, label: input.label, ...columns, status, proposedBy: actor.id, createdBy: actor.id })
    .returning();
  return { ...created, ...(await resolveMilestone(taskRow, created)) };
}

// Holder-only, direct — per spec, only a first-time *add* from a
// non-holder ever goes through the pending flow; editing or removing
// an existing milestone is always the current holder's own call.
export async function updateTaskMilestone(actor: Member, milestoneId: string, rawInput: UpdateTaskMilestoneInput) {
  const input = updateTaskMilestoneInput.parse(rawInput);
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) {
    throw new NotFoundError("Milestone not found");
  }
  const taskRow = await getTask(actor, existing.taskId); // 404s a cross-community id
  if (!currentlyHolds(taskRow, actor.id)) {
    throw new ForbiddenError("Only a current holder of this task can edit a milestone");
  }

  const columns = input.date ? await columnsFromInput(taskRow, input.date) : undefined;
  const [updated] = await db
    .update(taskMilestone)
    .set({ ...(input.label !== undefined && { label: input.label }), ...(columns ?? {}) })
    .where(eq(taskMilestone.id, milestoneId))
    .returning();
  return { ...updated, ...(await resolveMilestone(taskRow, updated)) };
}

// Also how a holder rejects a still-pending proposal — "rejecting just
// removes the row" (docs/spec.md), the identical operation as removing
// a confirmed one, so one function covers both.
export async function deleteTaskMilestone(actor: Member, milestoneId: string) {
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) {
    throw new NotFoundError("Milestone not found");
  }
  const taskRow = await getTask(actor, existing.taskId);
  if (!currentlyHolds(taskRow, actor.id)) {
    throw new ForbiddenError("Only a current holder of this task can remove a milestone");
  }
  await db.delete(taskMilestone).where(eq(taskMilestone.id, milestoneId));
}

export async function confirmTaskMilestone(actor: Member, milestoneId: string) {
  const [existing] = await db.select().from(taskMilestone).where(eq(taskMilestone.id, milestoneId));
  if (!existing) {
    throw new NotFoundError("Milestone not found");
  }
  if (existing.status !== "pending") {
    throw new ConflictError("This milestone has no pending change to confirm");
  }
  const taskRow = await getTask(actor, existing.taskId);
  if (!currentlyHolds(taskRow, actor.id)) {
    throw new ForbiddenError("Only a current holder of this task can confirm a milestone");
  }

  // createdBy is reassigned to the confirming holder here — see
  // src/db/schema/task-milestone.ts's schema comment for why this
  // differs from proposedBy, which never changes after creation.
  const [updated] = await db
    .update(taskMilestone)
    .set({ status: "confirmed", createdBy: actor.id })
    .where(eq(taskMilestone.id, milestoneId))
    .returning();
  return { ...updated, ...(await resolveMilestone(taskRow, updated)) };
}

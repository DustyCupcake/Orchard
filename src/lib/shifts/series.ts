import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, community, shiftSeries, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";

type Member = typeof memberTable.$inferSelect;
type ShiftSeriesRow = typeof shiftSeries.$inferSelect;

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

export const createShiftSeriesInput = z.object({
  branchId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultCapacity: z.number().int().positive(),
  sourceTaskId: z.string().uuid().nullable().optional(),
});
export type CreateShiftSeriesInput = z.infer<typeof createShiftSeriesInput>;

// Open to any member — "genuinely unloved tasks ... rotate it" is a
// unilateral act by whoever holds the task, the same posture Subtasks
// already established ("the structural equivalent of the 'talk to my
// coordinator' button, not a request"). Whoever creates a series is
// automatically its coordinator (see isShiftCoordinator below) — no
// separate authorization step to become one.
export async function createShiftSeries(actor: Member, input: CreateShiftSeriesInput) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "shifts");

  if (input.branchId) {
    const [branchRow] = await db
      .select({ id: branch.id })
      .from(branch)
      .where(and(eq(branch.id, input.branchId), eq(branch.communityId, actor.communityId)));
    if (!branchRow) {
      throw new NotFoundError("Branch not found in your community");
    }
  }

  if (input.sourceTaskId) {
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.sourceTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }

  const [created] = await db
    .insert(shiftSeries)
    .values({
      communityId: actor.communityId,
      branchId: input.branchId ?? null,
      title: input.title,
      description: input.description ?? null,
      defaultCapacity: input.defaultCapacity,
      sourceTaskId: input.sourceTaskId ?? null,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// "A one-click action on a Task's detail view, available to any
// current holder — creates a ShiftSeries with sourceTaskId set and
// branch/description pre-filled from the task." Deliberately takes no
// input of its own beyond which task — everything else is derived, the
// same unilateral, no-intermediate-form posture Subtasks already
// established. The original Task is left untouched; converting is a
// starting point for coordination to actually retire it, never
// automatic (out of scope per the dev plan).
export async function rotateTaskIntoShift(actor: Member, taskId: string) {
  const [taskRow] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found");
  }

  const [holds] = await db
    .select({ taskId: taskAssignment.taskId })
    .from(taskAssignment)
    .where(
      and(
        eq(taskAssignment.taskId, taskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  if (!holds) {
    throw new ForbiddenError("Only a current holder can rotate this task into a shift");
  }

  return createShiftSeries(actor, {
    branchId: taskRow.branchId,
    title: taskRow.title,
    description: taskRow.description || null,
    defaultCapacity: taskRow.capacity ?? 1,
    sourceTaskId: taskRow.id,
  });
}

export async function getShiftSeries(actor: Member, seriesId: string) {
  const [row] = await db
    .select()
    .from(shiftSeries)
    .where(and(eq(shiftSeries.id, seriesId), eq(shiftSeries.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Shift series not found");
  }
  return row;
}

export async function listShiftSeries(actor: Member, options: { includeArchived?: boolean } = {}) {
  const conditions = [eq(shiftSeries.communityId, actor.communityId)];
  if (!options.includeArchived) {
    conditions.push(isNull(shiftSeries.archivedAt));
  }
  return db
    .select()
    .from(shiftSeries)
    .where(and(...conditions))
    .orderBy(desc(shiftSeries.createdAt));
}

// "The coordinator view (the series creator, or whoever holds
// sourceTaskId if set)" — access-follows-the-task for the rotated-from
// case, plain creatorship otherwise. Baked into the coordinator-only
// functions themselves (occurrences.ts's generateShiftOccurrences,
// signups.ts's listSignupsForOccurrence, archive/unarchive below).
export async function isShiftCoordinator(actor: Member, series: Pick<ShiftSeriesRow, "createdBy" | "sourceTaskId">) {
  if (series.createdBy === actor.id) return true;
  if (!series.sourceTaskId) return false;

  const [holding] = await db
    .select({ id: task.id })
    .from(task)
    .innerJoin(taskAssignment, eq(taskAssignment.taskId, task.id))
    .where(
      and(
        eq(task.id, series.sourceTaskId),
        eq(taskAssignment.memberId, actor.id),
        eq(taskAssignment.isShadow, false),
      ),
    );
  return Boolean(holding);
}

export async function requireShiftCoordinator(
  actor: Member,
  series: Pick<ShiftSeriesRow, "createdBy" | "sourceTaskId">,
) {
  if (!(await isShiftCoordinator(actor, series))) {
    throw new ForbiddenError("Only this series' coordinator can do this");
  }
}

export async function archiveShiftSeries(actor: Member, seriesId: string) {
  const series = await getShiftSeries(actor, seriesId);
  await requireShiftCoordinator(actor, series);

  const [updated] = await db
    .update(shiftSeries)
    .set({ archivedAt: new Date() })
    .where(eq(shiftSeries.id, seriesId))
    .returning();
  return updated;
}

export async function unarchiveShiftSeries(actor: Member, seriesId: string) {
  const series = await getShiftSeries(actor, seriesId);
  await requireShiftCoordinator(actor, series);

  const [updated] = await db
    .update(shiftSeries)
    .set({ archivedAt: null })
    .where(eq(shiftSeries.id, seriesId))
    .returning();
  return updated;
}

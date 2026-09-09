import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import { memberAxisValue, task, taskAxisValue, traitAxis } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, NotFoundError } from "./errors";

type Member = typeof memberTable.$inferSelect;

export const AXIS_SCALE_MIN = -2;
export const AXIS_SCALE_MAX = 2;

// The one axis with no task-side TaskAxisValue row at all — its
// task-side value is derived live from the existing Task.effort enum
// instead (see effortAxisValue below), since duplicating what's already
// on every task would drift. Matched by `key`, not a fixed id, so it
// still works across communities that each define their own TraitAxis
// rows independently.
export const COMMITMENT_PREFERENCE_AXIS_KEY = "commitment_preference";

const EFFORT_TO_AXIS_VALUE: Record<string, number> = {
  one_off: -2,
  ongoing: 0,
  owns_a_thing: 2,
};

// A task's position on the commitment-preference axis, read straight
// off its own Effort — never stored, always derived, so it can't drift
// from the one real field it mirrors.
export function effortAxisValue(effort: string): number {
  return EFFORT_TO_AXIS_VALUE[effort] ?? 0;
}

// Standing community structure — gated by requireAdmins at the settings
// action layer, the same split Branch/Tier/ProfileQuestion CRUD already
// uses. This module stays community-scoped only.
export const createTraitAxisInput = z.object({
  key: z.string().min(1),
  lowLabel: z.string().min(1),
  highLabel: z.string().min(1),
  optionLabels: z.array(z.string().min(1)).optional(),
  askAtOnboarding: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateTraitAxisInput = z.infer<typeof createTraitAxisInput>;

export const updateTraitAxisInput = z.object({
  lowLabel: z.string().min(1).optional(),
  highLabel: z.string().min(1).optional(),
  optionLabels: z.array(z.string().min(1)).optional(),
  askAtOnboarding: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});
export type UpdateTraitAxisInput = z.infer<typeof updateTraitAxisInput>;

function requireValidOptionLabels(optionLabels: string[]) {
  if (optionLabels.length > 0 && optionLabels.length !== AXIS_SCALE_MAX - AXIS_SCALE_MIN + 1) {
    throw new AppError(`optionLabels must have exactly ${AXIS_SCALE_MAX - AXIS_SCALE_MIN + 1} entries when set`);
  }
}

// The onboarding panel's own subset — axes flagged askAtOnboarding that
// this member hasn't already answered (at onboarding or later at
// /profile) — same "outstanding" framing listOutstandingQuestions
// already uses for ProfileQuestion, so a member who already set an axis
// via /profile doesn't see it asked again on their next dashboard visit.
export async function listOutstandingOnboardingAxes(actor: Member) {
  const axes = await db
    .select()
    .from(traitAxis)
    .where(
      and(
        eq(traitAxis.communityId, actor.communityId),
        eq(traitAxis.askAtOnboarding, true),
        isNull(traitAxis.archivedAt),
      ),
    )
    .orderBy(traitAxis.sortOrder);
  if (axes.length === 0) return [];

  const answered = await listMemberAxisValues(actor.id);
  return axes.filter((a) => !answered.has(a.id));
}

export async function listTraitAxes(actor: Member, options: { includeArchived?: boolean } = {}) {
  const conditions = [eq(traitAxis.communityId, actor.communityId)];
  if (!options.includeArchived) {
    conditions.push(isNull(traitAxis.archivedAt));
  }
  return db
    .select()
    .from(traitAxis)
    .where(and(...conditions))
    .orderBy(traitAxis.sortOrder);
}

export async function createTraitAxis(actor: Member, input: CreateTraitAxisInput) {
  const optionLabels = input.optionLabels ?? [];
  requireValidOptionLabels(optionLabels);

  const [created] = await db
    .insert(traitAxis)
    .values({
      communityId: actor.communityId,
      key: input.key,
      lowLabel: input.lowLabel,
      highLabel: input.highLabel,
      optionLabels,
      askAtOnboarding: input.askAtOnboarding ?? false,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();
  return created;
}

export async function updateTraitAxis(actor: Member, axisId: string, input: UpdateTraitAxisInput) {
  if (input.optionLabels !== undefined) {
    requireValidOptionLabels(input.optionLabels);
  }

  const [updated] = await db
    .update(traitAxis)
    .set({
      ...(input.lowLabel !== undefined && { lowLabel: input.lowLabel }),
      ...(input.highLabel !== undefined && { highLabel: input.highLabel }),
      ...(input.optionLabels !== undefined && { optionLabels: input.optionLabels }),
      ...(input.askAtOnboarding !== undefined && { askAtOnboarding: input.askAtOnboarding }),
      ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
    })
    .where(and(eq(traitAxis.id, axisId), eq(traitAxis.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Trait axis not found");
  }
  return updated;
}

export async function archiveTraitAxis(actor: Member, axisId: string) {
  const [updated] = await db
    .update(traitAxis)
    .set({ archivedAt: new Date() })
    .where(and(eq(traitAxis.id, axisId), eq(traitAxis.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Trait axis not found");
  }
  return updated;
}

export async function unarchiveTraitAxis(actor: Member, axisId: string) {
  const [updated] = await db
    .update(traitAxis)
    .set({ archivedAt: null })
    .where(and(eq(traitAxis.id, axisId), eq(traitAxis.communityId, actor.communityId)))
    .returning();
  if (!updated) {
    throw new NotFoundError("Trait axis not found");
  }
  return updated;
}

function requireValidAxisValue(value: number) {
  if (!Number.isInteger(value) || value < AXIS_SCALE_MIN || value > AXIS_SCALE_MAX) {
    throw new AppError(`Axis value must be an integer between ${AXIS_SCALE_MIN} and ${AXIS_SCALE_MAX}`);
  }
}

// Always self-service, same posture as tags/languages — a member sets
// their own position on an axis, never assigned to them.
export async function listMemberAxisValues(memberId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(memberAxisValue).where(eq(memberAxisValue.memberId, memberId));
  return new Map(rows.map((r) => [r.axisId, r.value]));
}

export async function upsertMemberAxisValue(actor: Member, axisId: string, value: number) {
  requireValidAxisValue(value);
  const [axis] = await db
    .select()
    .from(traitAxis)
    .where(and(eq(traitAxis.id, axisId), eq(traitAxis.communityId, actor.communityId)));
  if (!axis) {
    throw new NotFoundError("Trait axis not found");
  }

  await db
    .insert(memberAxisValue)
    .values({ memberId: actor.id, axisId, value })
    .onConflictDoUpdate({
      target: [memberAxisValue.memberId, memberAxisValue.axisId],
      set: { value },
    });
}

export async function listTaskAxisValues(taskId: string): Promise<Map<string, number>> {
  const rows = await db.select().from(taskAxisValue).where(eq(taskAxisValue.taskId, taskId));
  return new Map(rows.map((r) => [r.axisId, r.value]));
}

// Bulk-set a freshly-activated task's axis values in one go — the
// proposal-activation counterpart of setting suggestedTags -> task.tags.
// Silently skips an out-of-range value rather than failing the whole
// activation over one bad suggestion (the same tolerant posture the
// rest of activation already takes toward a proposer's suggestions).
export async function setTaskAxisValues(
  dbOrTx: DbOrTx,
  taskId: string,
  values: Record<string, number>,
) {
  const entries = Object.entries(values).filter(
    ([, v]) => Number.isInteger(v) && v >= AXIS_SCALE_MIN && v <= AXIS_SCALE_MAX,
  );
  if (entries.length === 0) return;

  await dbOrTx
    .insert(taskAxisValue)
    .values(entries.map(([axisId, value]) => ({ taskId, axisId, value })))
    .onConflictDoUpdate({
      target: [taskAxisValue.taskId, taskAxisValue.axisId],
      set: { value: sql`excluded.value` },
    });
}

// Batch lookup for onboarding.ts's fit-ranking pass, which needs this
// for a whole candidate pool of tasks, not one at a time.
export async function listTaskAxisValuesForTasks(taskIds: string[]): Promise<Map<string, Map<string, number>>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db.select().from(taskAxisValue).where(inArray(taskAxisValue.taskId, taskIds));
  const byTask = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!byTask.has(r.taskId)) byTask.set(r.taskId, new Map());
    byTask.get(r.taskId)!.set(r.axisId, r.value);
  }
  return byTask;
}

export async function getTaskEffort(taskId: string): Promise<string | null> {
  const [row] = await db.select({ effort: task.effort }).from(task).where(eq(task.id, taskId));
  return row?.effort ?? null;
}

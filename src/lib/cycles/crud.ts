import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type Tx } from "@/db";
import { community, cycle, phase, requirement, task, taskDependency } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { memberHasTier } from "../eligibility";

type Member = typeof memberTable.$inferSelect;

const phaseInput = z.object({
  name: z.string().min(1),
  order: z.number().int(),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
});

export const createCycleInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("blank"),
    name: z.string().min(1),
    phases: z.array(phaseInput).optional(),
  }),
  z.object({
    source: z.literal("clone_previous"),
    name: z.string().min(1),
  }),
]);
export type CreateCycleInput = z.infer<typeof createCycleInput>;

async function requireCycleInitiationEligibility(actor: Member) {
  const [communityRow] = await db.select().from(community).where(eq(community.id, actor.communityId));
  if (!communityRow) {
    throw new NotFoundError("Community not found");
  }
  if (!communityRow.cyclesEnabled) {
    throw new ConflictError("Cycles are not enabled for this Community");
  }
  if (
    communityRow.cycleInitiationTierId &&
    !memberHasTier(actor, communityRow.cycleInitiationTierId)
  ) {
    throw new ForbiddenError("You don't have the tier required to start a cycle");
  }
}

export async function createCycle(actor: Member, input: CreateCycleInput) {
  await requireCycleInitiationEligibility(actor);

  if (input.source === "clone_previous") {
    return cloneMostRecentCycle(actor, input.name);
  }
  return createBlankCycle(actor, input.name, input.phases ?? []);
}

async function createBlankCycle(
  actor: Member,
  name: string,
  phases: z.infer<typeof phaseInput>[],
) {
  return db.transaction(async (tx) => {
    const [newCycle] = await tx
      .insert(cycle)
      .values({
        communityId: actor.communityId,
        name,
        status: "active",
        startedBy: actor.id,
        startedAt: new Date(),
        sourceType: "blank",
      })
      .returning();

    if (phases.length > 0) {
      await tx.insert(phase).values(
        phases.map((p) => ({
          cycleId: newCycle.id,
          name: p.name,
          order: p.order,
          startDate: p.startDate ?? null,
          endDate: p.endDate ?? null,
        })),
      );
    }

    return newCycle;
  });
}

// The narrow slice of Task Pack import this MVP actually needs (see
// docs/development-plan.md's Phase 6 scope) — clone-previous is, per the
// spec, conceptually the same mechanism as importing a pack, but without
// building the general TaskPack table or the branch/phase name-matching
// review screen a real cross-community import would need. Everything
// here matches by identity within one community's own cycle history.
async function cloneMostRecentCycle(actor: Member, name: string) {
  const [previous] = await db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt))
    .limit(1);
  if (!previous) {
    throw new NotFoundError("No previous cycle to clone");
  }

  return db.transaction(async (tx) => {
    const [newCycle] = await tx
      .insert(cycle)
      .values({
        communityId: actor.communityId,
        name,
        status: "active",
        startedBy: actor.id,
        startedAt: new Date(),
        sourceType: "pack",
      })
      .returning();

    const phaseIdMap = await clonePhases(tx, previous.id, newCycle.id);
    const taskIdMap = await cloneTasks(tx, actor, previous.id, newCycle.id, phaseIdMap);
    await cloneRequirements(tx, taskIdMap);
    await cloneDependencies(tx, taskIdMap);

    return newCycle;
  });
}

// Inserted one row at a time rather than as a single batched insert:
// Postgres doesn't guarantee a multi-row INSERT...RETURNING preserves
// input order, and correctly mapping old ids to new ones depends on it.
async function clonePhases(tx: Tx, previousCycleId: string, newCycleId: string) {
  const oldPhases = await tx.select().from(phase).where(eq(phase.cycleId, previousCycleId));
  const idMap = new Map<string, string>();

  for (const p of oldPhases) {
    // Dates are cycle-scheduling-time facts, never carried across a
    // clone — same "timeless spine" rule Task Pack itself follows.
    const [newPhase] = await tx
      .insert(phase)
      .values({ cycleId: newCycleId, name: p.name, order: p.order })
      .returning();
    idMap.set(p.id, newPhase.id);
  }
  return idMap;
}

async function cloneTasks(
  tx: Tx,
  actor: Member,
  previousCycleId: string,
  newCycleId: string,
  phaseIdMap: Map<string, string>,
) {
  const oldTasks = await tx.select().from(task).where(eq(task.cycleId, previousCycleId));
  const idMap = new Map<string, string>();

  for (const t of oldTasks) {
    const [newTask] = await tx
      .insert(task)
      .values({
        communityId: actor.communityId,
        branchId: t.branchId,
        cycleId: newCycleId,
        phaseId: t.phaseId ? (phaseIdMap.get(t.phaseId) ?? null) : null,
        clonedFromTaskId: t.id,
        title: t.title,
        description: t.description,
        tags: t.tags,
        effort: t.effort,
        effortMagnitude: t.effortMagnitude,
        capacity: t.capacity,
        openness: t.openness,
        endorsementThreshold: t.endorsementThreshold,
        critical: t.critical,
        createdBy: actor.id,
      })
      .returning();
    idMap.set(t.id, newTask.id);
  }
  return idMap;
}

// Copies each cloned task's own Requirements verbatim. Doesn't attempt
// to remap a completed_task requirement's referenced taskId if that
// reference pointed outside the cloned set — that's a cross-cycle
// pointer by design (spec: "held or shadowed the referenced task",
// not "the equivalent task in this cycle"), so it's left untouched.
async function cloneRequirements(tx: Tx, taskIdMap: Map<string, string>) {
  if (taskIdMap.size === 0) return;

  const oldRequirements = await tx
    .select()
    .from(requirement)
    .where(inArray(requirement.taskId, [...taskIdMap.keys()]));
  if (oldRequirements.length === 0) return;

  await tx.insert(requirement).values(
    oldRequirements.map((r) => ({
      taskId: taskIdMap.get(r.taskId)!,
      type: r.type,
      mode: r.mode,
      value: r.value as object,
    })),
  );
}

// Only re-points a dependency when BOTH ends were part of the cloned
// set — a dependency on a standing, cross-cycle task has no "equivalent
// in the new cycle" to point at, so it's dropped rather than guessed at.
async function cloneDependencies(tx: Tx, taskIdMap: Map<string, string>) {
  if (taskIdMap.size === 0) return;

  const oldDeps = await tx
    .select()
    .from(taskDependency)
    .where(inArray(taskDependency.taskId, [...taskIdMap.keys()]));
  const withinSet = oldDeps.filter((d) => taskIdMap.has(d.dependsOnTaskId));
  if (withinSet.length === 0) return;

  await tx.insert(taskDependency).values(
    withinSet.map((d) => ({
      taskId: taskIdMap.get(d.taskId)!,
      dependsOnTaskId: taskIdMap.get(d.dependsOnTaskId)!,
    })),
  );
}

export async function listCycles(actor: Member) {
  return db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt));
}

export async function getCycle(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found");
  }

  const phases = await db.select().from(phase).where(eq(phase.cycleId, cycleId)).orderBy(phase.order);
  return { ...row, phases };
}

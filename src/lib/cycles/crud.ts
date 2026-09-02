import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db";
import {
  community,
  cycle,
  cycleType,
  phase,
  requirement,
  task,
  taskAssignment,
  taskDependency,
  taskMilestone,
} from "@/db/schema";
import type { member as memberTable, phase as phaseTable } from "@/db/schema";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../errors";
import { memberHasTier } from "../eligibility";
import { cloneSpatialPlanIntoNewCycle } from "../spatial-planning";
import { recomputeCalendarEventDatesForCycle } from "../calendar-events";
import {
  dateBoundaryInput,
  deriveClonedBoundaryRecipe,
  isBoundaryDrifted,
  recomputeBoundary,
  toStoredBoundary,
  violatesBoundaryOrder,
  type DateBoundaryInput,
  type StoredBoundary,
} from "../dates";

type Member = typeof memberTable.$inferSelect;
type Phase = typeof phaseTable.$inferSelect;

// --- Phase boundary <-> column mapping -------------------------------
//
// The shared absolute/relative date shape (src/lib/dates/resolve.ts),
// mapped onto Phase's own start_*/end_* column pairs. See
// docs/development-plan.md's Phase 39.

function startBoundaryOf(p: Phase): StoredBoundary {
  return {
    dateType: p.startDateType,
    date: p.startDate,
    relativeMode: p.startRelativeMode,
    offsetAnchor: p.startOffsetAnchor,
    offsetDays: p.startOffsetDays,
    percent: p.startPercent,
  };
}

function endBoundaryOf(p: Phase): StoredBoundary {
  return {
    dateType: p.endDateType,
    date: p.endDate,
    relativeMode: p.endRelativeMode,
    offsetAnchor: p.endOffsetAnchor,
    offsetDays: p.endOffsetDays,
    percent: p.endPercent,
  };
}

function startColumns(b: StoredBoundary) {
  return {
    startDateType: b.dateType,
    startDate: b.date,
    startRelativeMode: b.relativeMode,
    startOffsetAnchor: b.offsetAnchor,
    startOffsetDays: b.offsetDays,
    startPercent: b.percent,
  };
}

function endColumns(b: StoredBoundary) {
  return {
    endDateType: b.dateType,
    endDate: b.date,
    endRelativeMode: b.relativeMode,
    endOffsetAnchor: b.offsetAnchor,
    endOffsetDays: b.offsetDays,
    endPercent: b.percent,
  };
}

// `start`/`end` carry the full absolute/relative shape (Phase 39); the
// flat `startDate`/`endDate` fields are kept as shorthand for "absolute,
// this exact date" — the common case, and what every caller before
// Phase 39 already sends. `start`/`end` win if both are given.
const phaseInput = z.object({
  name: z.string().min(1),
  order: z.number().int(),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
  start: dateBoundaryInput.optional(),
  end: dateBoundaryInput.optional(),
});
type PhaseInput = z.infer<typeof phaseInput>;

function resolvedBoundaryInput(
  boundary: DateBoundaryInput | undefined,
  flatDate: string | null | undefined,
): DateBoundaryInput | undefined {
  if (boundary) return boundary;
  if (flatDate === undefined) return undefined;
  return { type: "absolute", date: flatDate };
}

export const createCycleInput = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("blank"),
    name: z.string().min(1),
    // Not required to start a cycle — see docs/spec.md's "Event
    // window." Missing dates just leave anything anchored to them
    // (Phase auto-placement, relative milestones/events) unresolved.
    startDate: z.string().min(1).nullable().optional(),
    endDate: z.string().min(1).nullable().optional(),
    // Optional — see docs/spec.md's "Cycle type" and
    // docs/development-plan.md's Phase 40. A Community that never
    // defines any Cycle type just leaves this unset forever.
    cycleTypeId: z.string().uuid().nullable().optional(),
    phases: z.array(phaseInput).optional(),
  }),
  z.object({
    source: z.literal("clone_previous"),
    name: z.string().min(1),
    cycleTypeId: z.string().uuid().nullable().optional(),
    // "Also clone its spatial plan?" — docs/spec.md's "Cloning across
    // cycles." Only meaningful on this exact path (the immediately-
    // previous-cycle clone), the same restriction Shadow slots'
    // suggested_member_id carry-forward already established — see
    // cloneMostRecentCycle below.
    cloneSpatialPlan: z.boolean().optional(),
  }),
]);
export type CreateCycleInput = z.infer<typeof createCycleInput>;

// Exported — Phase 31's Participation & capacity reuses this exact gate
// for who may set a Cycle's capacity/returningWindowClosesAt, on the
// reasoning that whoever can start a cycle is the same authority who'd
// configure it (no separate "cycle admin" concept exists). Phase 39's
// Phase-boundary editing reuses it too, for the same reason.
export async function requireCycleInitiationEligibility(actor: Member) {
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

// Non-throwing form for UI gating — e.g. whether to render the Cycle
// settings section on /participation at all.
export async function canInitiateCycle(actor: Member): Promise<boolean> {
  try {
    await requireCycleInitiationEligibility(actor);
    return true;
  } catch {
    return false;
  }
}

async function requireCycleTypeInCommunity(communityId: string, cycleTypeId: string) {
  const [row] = await db
    .select({ id: cycleType.id })
    .from(cycleType)
    .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Cycle type not found in your community");
  }
}

export async function createCycle(actor: Member, input: CreateCycleInput) {
  await requireCycleInitiationEligibility(actor);
  if (input.cycleTypeId) {
    await requireCycleTypeInCommunity(actor.communityId, input.cycleTypeId);
  }

  if (input.source === "clone_previous") {
    return cloneMostRecentCycle(actor, input.name, input.cycleTypeId ?? null, input.cloneSpatialPlan ?? false);
  }
  return createBlankCycle(
    actor,
    input.name,
    input.startDate ?? null,
    input.endDate ?? null,
    input.cycleTypeId ?? null,
    input.phases ?? [],
  );
}

// Resolves a phase's start/end immediately against the Cycle's own
// dates, known up front here since a blank cycle's dates are set (or
// left unset) in this same call, unlike cloning (see
// cloneMostRecentCycle) where the new cycle's own dates aren't known
// yet.
function phaseInsertValues(cycleId: string, cycleStartDate: string | null, cycleEndDate: string | null, p: PhaseInput) {
  const startInput = resolvedBoundaryInput(p.start, p.startDate);
  const endInput = resolvedBoundaryInput(p.end, p.endDate);
  const start = startInput ? toStoredBoundary(startInput, cycleStartDate, cycleEndDate) : undefined;
  const end = endInput ? toStoredBoundary(endInput, cycleStartDate, cycleEndDate) : undefined;

  if (start && end && violatesBoundaryOrder(start.date, end.date)) {
    throw new ConflictError(`"${p.name}"'s end can't resolve before its own start`);
  }

  return {
    cycleId,
    name: p.name,
    order: p.order,
    ...(start ? startColumns(start) : {}),
    ...(end ? endColumns(end) : {}),
  };
}

async function createBlankCycle(
  actor: Member,
  name: string,
  startDate: string | null,
  endDate: string | null,
  cycleTypeId: string | null,
  phases: PhaseInput[],
) {
  if (violatesBoundaryOrder(startDate, endDate)) {
    throw new ConflictError("A cycle's end date can't be before its own start date");
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
        sourceType: "blank",
        startDate,
        endDate,
        cycleTypeId,
      })
      .returning();

    if (phases.length > 0) {
      await tx.insert(phase).values(
        phases.map((p) => phaseInsertValues(newCycle.id, startDate, endDate, p)),
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
async function cloneMostRecentCycle(
  actor: Member,
  name: string,
  cycleTypeId: string | null,
  cloneSpatialPlan: boolean,
) {
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
        cycleTypeId,
      })
      .returning();

    const phaseIdMap = await clonePhases(tx, previous, newCycle.id);
    const taskIdMap = await cloneTasks(tx, actor, previous.id, newCycle.id, phaseIdMap);
    await cloneRequirements(tx, taskIdMap);
    await cloneDependencies(tx, taskIdMap);
    await cloneTaskMilestones(tx, taskIdMap, phaseIdMap);

    // Phase 38's own integration — see docs/spec.md's "Cloning across
    // cycles." Tasks were just cloned above in this same transaction,
    // so a Placement's linkedTaskId can be remapped onto the new Task
    // instance rather than dropped, the one path where that link
    // actually survives a clone. Requires the actor to be the Spatial-
    // planning holder specifically — cycle-initiation eligibility and
    // Spatial-planning authority are two separate gates, the same
    // reasoning Pack import review's "create new branch" step already
    // established for Admins vs. cycle-initiation eligibility — so this
    // throws a real ForbiddenError rather than silently skipping if a
    // non-holder asks for it.
    if (cloneSpatialPlan) {
      await cloneSpatialPlanIntoNewCycle(actor, tx, previous.id, newCycle.id, taskIdMap);
    }

    return newCycle;
  });
}

export interface ClonePreviewPhase {
  name: string;
  order: number;
  start: string | null;
  end: string | null;
}
export interface ClonePreviewMilestone {
  taskTitle: string;
  label: string;
  phaseName: string | null;
  date: string | null;
}
export interface ClonePreview {
  sourceCycleName: string;
  phases: ClonePreviewPhase[];
  milestones: ClonePreviewMilestone[];
}

// A milestone's 4-way anchor (phase_start/phase_end/cycle_start/
// cycle_end) reframed onto recomputeBoundary's own 2-way "which end of
// the given pair" shape — the offset/percent math is identical either
// way, only which start/end pair applies differs (see
// src/lib/tasks/milestones.ts's own fetchParentBoundary for the
// non-preview equivalent of this same split).
function previewMilestoneDate(
  m: Pick<typeof taskMilestone.$inferSelect, "relativeMode" | "anchorType" | "offsetDays" | "percent">,
  phaseStart: string | null,
  phaseEnd: string | null,
  cycleStart: string | null,
  cycleEnd: string | null,
): string | null {
  if (!m.anchorType || !m.relativeMode) return null;
  const isPhaseAnchor = m.anchorType === "phase_start" || m.anchorType === "phase_end";
  const start = isPhaseAnchor ? phaseStart : cycleStart;
  const end = isPhaseAnchor ? phaseEnd : cycleEnd;
  const directionalAnchor = m.anchorType === "phase_start" || m.anchorType === "cycle_start" ? "cycle_start" : "cycle_end";
  return recomputeBoundary(
    { dateType: "relative", date: null, relativeMode: m.relativeMode, offsetAnchor: directionalAnchor, offsetDays: m.offsetDays, percent: m.percent },
    start,
    end,
  ).date;
}

// Non-mutating — computes exactly what cloneMostRecentCycle's own
// clonePhases/cloneTaskMilestones would produce, against a hypothetical
// destination start/end the reviewer hasn't committed to yet. See
// docs/development-plan.md's Phase 44 ("the Pack import review screen
// gains the date preview"). Reuses the exact same
// deriveClonedBoundaryRecipe/recomputeBoundary primitives those
// mutating functions call, so a preview's numbers are guaranteed to
// match what actually lands once the clone (and then a real
// updateCycleSettings call, which cascades the identical recompute)
// commits — never a second, drifting implementation of the same math.
// Gated the same way starting a cycle is: this only makes sense inside
// that same flow, even though it reveals nothing a member couldn't
// already piece together from getCycle/listTaskMilestones directly.
export async function previewClonePreviousCycle(
  actor: Member,
  hypotheticalStart: string | null,
  hypotheticalEnd: string | null,
): Promise<ClonePreview | null> {
  await requireCycleInitiationEligibility(actor);

  const [previous] = await db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt))
    .limit(1);
  if (!previous) return null;

  const oldPhases = await db.select().from(phase).where(eq(phase.cycleId, previous.id)).orderBy(phase.order);
  const previewPhases: ClonePreviewPhase[] = oldPhases.map((p) => {
    const start = recomputeBoundary(
      deriveClonedBoundaryRecipe(startBoundaryOf(p), previous.startDate),
      hypotheticalStart,
      hypotheticalEnd,
    );
    const end = recomputeBoundary(
      deriveClonedBoundaryRecipe(endBoundaryOf(p), previous.startDate),
      hypotheticalStart,
      hypotheticalEnd,
    );
    return { name: p.name, order: p.order, start: start.date, end: end.date };
  });
  const previewByOldPhaseId = new Map(oldPhases.map((p, i) => [p.id, previewPhases[i]]));

  const oldTasks = await db
    .select({ id: task.id, title: task.title })
    .from(task)
    .where(eq(task.cycleId, previous.id));
  const taskById = new Map(oldTasks.map((t) => [t.id, t]));
  const oldMilestones =
    oldTasks.length === 0
      ? []
      : await db
          .select()
          .from(taskMilestone)
          .where(inArray(taskMilestone.taskId, oldTasks.map((t) => t.id)));
  const carried = oldMilestones.filter((m) => m.dateType === "relative" && m.status === "confirmed");

  const previewMilestones: ClonePreviewMilestone[] = carried.map((m) => {
    const t = taskById.get(m.taskId)!;
    const isPhaseAnchor = m.anchorType === "phase_start" || m.anchorType === "phase_end";
    const previewPhase = isPhaseAnchor && m.phaseId ? previewByOldPhaseId.get(m.phaseId) : undefined;
    const date = previewMilestoneDate(m, previewPhase?.start ?? null, previewPhase?.end ?? null, hypotheticalStart, hypotheticalEnd);
    return { taskTitle: t.title, label: m.label, phaseName: previewPhase?.name ?? null, date };
  });

  return { sourceCycleName: previous.name, phases: previewPhases, milestones: previewMilestones };
}

// Inserted one row at a time rather than as a single batched insert:
// Postgres doesn't guarantee a multi-row INSERT...RETURNING preserves
// input order, and correctly mapping old ids to new ones depends on it.
async function clonePhases(
  tx: Tx,
  previousCycle: Pick<typeof cycle.$inferSelect, "id" | "startDate">,
  newCycleId: string,
) {
  const oldPhases = await tx.select().from(phase).where(eq(phase.cycleId, previousCycle.id));
  const idMap = new Map<string, string>();

  for (const p of oldPhases) {
    // "Cloning carries the recipe, not the date" — docs/spec.md. A
    // relative boundary's mode/anchor/offset-or-percent carries
    // forward as-is (its cached date stays null here — the new cycle
    // has no start/end yet at clone time, see createCycleInput's
    // clone_previous variant — and gets resolved once
    // updateCycleSettings sets them, via recomputePhaseDatesForCycle).
    // An absolute boundary is converted into a derived offset recipe
    // against the *previous* cycle's own start_date, so even a cycle
    // that was never relatively-dated produces a usable recommendation
    // on its next clone; genuinely un-derivable (no previous start_date
    // set) falls back to the original "dates don't carry" behavior.
    const start = deriveClonedBoundaryRecipe(startBoundaryOf(p), previousCycle.startDate);
    const end = deriveClonedBoundaryRecipe(endBoundaryOf(p), previousCycle.startDate);
    const [newPhase] = await tx
      .insert(phase)
      .values({ cycleId: newCycleId, name: p.name, order: p.order, ...startColumns(start), ...endColumns(end) })
      .returning();
    idMap.set(p.id, newPhase.id);
  }
  return idMap;
}

// A shadow doesn't have to be the one to remember to raise their hand
// first next cycle — see docs/spec.md's "Carrying forward" (Shadow
// slots & succession): a filled shadow slot on the source task
// pre-fills the clone's suggested_member_id, reusing the exact field
// the proposal flow already has for "I'd suggest this person," not a
// new mechanism. A suggestion, not an assignment — the cloned task
// still opens through the ordinary claim process. Only applies to this
// clone-previous-cycle path, per spec, since a shadow's relevance
// doesn't travel into a generic Task Pack.
async function shadowSuggestionsByTask(tx: Tx, taskIds: string[]) {
  if (taskIds.length === 0) return new Map<string, string>();

  const shadows = await tx
    .select({ taskId: taskAssignment.taskId, memberId: taskAssignment.memberId })
    .from(taskAssignment)
    .where(and(inArray(taskAssignment.taskId, taskIds), eq(taskAssignment.isShadow, true)))
    .orderBy(taskAssignment.claimedAt);

  const suggestionByTask = new Map<string, string>();
  for (const s of shadows) {
    // Multiple shadows on one task is possible (shadowing doesn't
    // count toward capacity, so nothing caps it at one) — the earliest
    // claimed wins, arbitrary but deterministic, since this is a single
    // nullable field.
    if (!suggestionByTask.has(s.taskId)) {
      suggestionByTask.set(s.taskId, s.memberId);
    }
  }
  return suggestionByTask;
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
  const shadowSuggestions = await shadowSuggestionsByTask(
    tx,
    oldTasks.map((t) => t.id),
  );

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
        suggestedMemberId: shadowSuggestions.get(t.id) ?? null,
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

// "Cloning carries the recipe, not the date" — docs/spec.md's own
// heading, applied to Task milestones (Phase 41) the same way Phase 39
// applied it to Phase boundaries: only relative milestones travel
// (an absolute one is pinned to the real world, per spec's own
// "deliberate trade," and doesn't survive export); a cycle-anchored
// one needs no remapping at all (the cloned task automatically has the
// new Cycle); a phase-anchored one's phaseId is remapped through the
// same phaseIdMap clonePhases already built, and dropped entirely if
// it pointed outside the cloned set (the "task with no Cycle" cross-
// cycle carve-out spec allows) — same "no exact match, don't guess"
// posture cloneDependencies already takes. Also drops any still-
// pending (unreviewed) milestone — carrying an unvetted proposal
// forward into a brand-new task instance, under a likely-different
// holder, isn't the same review context it was proposed against.
async function cloneTaskMilestones(tx: Tx, taskIdMap: Map<string, string>, phaseIdMap: Map<string, string>) {
  if (taskIdMap.size === 0) return;

  const oldMilestones = await tx
    .select()
    .from(taskMilestone)
    .where(inArray(taskMilestone.taskId, [...taskIdMap.keys()]));
  const carried = oldMilestones.filter((m) => m.dateType === "relative" && m.status === "confirmed");
  if (carried.length === 0) return;

  const rowsToInsert = carried
    .map((m) => {
      const newPhaseId = m.phaseId ? phaseIdMap.get(m.phaseId) : undefined;
      if (m.phaseId && !newPhaseId) return null; // unmappable — drop, same as cloneDependencies
      return {
        taskId: taskIdMap.get(m.taskId)!,
        label: m.label,
        dateType: "relative" as const,
        absoluteDate: null,
        relativeMode: m.relativeMode,
        anchorType: m.anchorType,
        offsetDays: m.offsetDays,
        percent: m.percent,
        phaseId: newPhaseId ?? null,
        status: "confirmed" as const,
        proposedBy: m.proposedBy,
        createdBy: m.createdBy,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rowsToInsert.length > 0) {
    await tx.insert(taskMilestone).values(rowsToInsert);
  }
}

export async function listCycles(actor: Member) {
  return db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt));
}

export interface PhaseFlags {
  orderInvalid: boolean;
  startDrifted: boolean;
  endDrifted: boolean;
}

// Live, standing flags — never persisted, computed fresh whenever a
// Phase is read alongside its Cycle. See docs/spec.md's "A soft check
// worth having, not yet a hard one" and "One basic sanity check."
function getPhaseFlags(cycleRow: { startDate: string | null; endDate: string | null }, phaseRow: Phase): PhaseFlags {
  const start = startBoundaryOf(phaseRow);
  const end = endBoundaryOf(phaseRow);
  return {
    orderInvalid: violatesBoundaryOrder(start.date, end.date),
    startDrifted: isBoundaryDrifted(start, cycleRow.startDate, cycleRow.endDate),
    endDrifted: isBoundaryDrifted(end, cycleRow.startDate, cycleRow.endDate),
  };
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
  // Live flags computed fresh on every read — see getPhaseFlags above.
  return { ...row, phases: phases.map((p) => ({ ...p, flags: getPhaseFlags(row, p) })) };
}

// Wires up the two fields that have sat unused on Cycle since Phase 6
// — see docs/development-plan.md's Phase 31. Gated the same way
// starting a cycle is: no separate "cycle admin" concept exists, and
// whoever's trusted to open a cycle is trusted to size it. Editable any
// time, not just at creation — capacity commonly firms up after a
// cycle's already started, and there's no lock-once-set rule in spec.
export const updateCycleSettingsInput = z.object({
  capacity: z.number().int().positive().nullable().optional(),
  returningWindowClosesAt: z.string().min(1).nullable().optional(),
  // The cycle's own start_date/end_date (Phase 39) — see docs/spec.md's
  // "Event window." Editing these is a direct edit of this boundary
  // pair, so it's validated immediately (violatesBoundaryOrder below);
  // every relative Phase boundary underneath is then recomputed to
  // track the move, since a Phase's only possible anchor is its own
  // Cycle.
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
});
export type UpdateCycleSettingsInput = z.infer<typeof updateCycleSettingsInput>;

export async function updateCycleSettings(actor: Member, cycleId: string, input: UpdateCycleSettingsInput) {
  await requireCycleInitiationEligibility(actor);

  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Cycle not found");
  }

  const nextStartDate = input.startDate !== undefined ? input.startDate : row.startDate;
  const nextEndDate = input.endDate !== undefined ? input.endDate : row.endDate;
  if (violatesBoundaryOrder(nextStartDate, nextEndDate)) {
    throw new ConflictError("A cycle's end date can't be before its own start date");
  }

  const [updated] = await db
    .update(cycle)
    .set({
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.returningWindowClosesAt !== undefined && {
        returningWindowClosesAt: input.returningWindowClosesAt ? new Date(input.returningWindowClosesAt) : null,
      }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
    })
    .where(eq(cycle.id, cycleId))
    .returning();

  if (input.startDate !== undefined || input.endDate !== undefined) {
    await recomputePhaseDatesForCycle(db, cycleId, nextStartDate, nextEndDate);
    await recomputeCalendarEventDatesForCycle(cycleId, nextStartDate, nextEndDate);
  }

  return updated;
}

// Called whenever the anchor Cycle's own start_date/end_date change —
// every relative Phase boundary underneath needs its cached date
// recomputed to track the move; absolute boundaries are untouched.
async function recomputePhaseDatesForCycle(
  tx: DbOrTx,
  cycleId: string,
  anchorStart: string | null,
  anchorEnd: string | null,
) {
  const phases = await tx.select().from(phase).where(eq(phase.cycleId, cycleId));
  for (const p of phases) {
    const nextStart = recomputeBoundary(startBoundaryOf(p), anchorStart, anchorEnd);
    const nextEnd = recomputeBoundary(endBoundaryOf(p), anchorStart, anchorEnd);
    if (nextStart.date === p.startDate && nextEnd.date === p.endDate) continue;
    await tx
      .update(phase)
      .set({ ...startColumns(nextStart), ...endColumns(nextEnd) })
      .where(eq(phase.id, p.id));
  }
}

export const updatePhaseBoundaryInput = z.object({
  start: dateBoundaryInput.optional(),
  end: dateBoundaryInput.optional(),
});
export type UpdatePhaseBoundaryInput = z.infer<typeof updatePhaseBoundaryInput>;

// Editing a Phase's dates is a cycle-configuration decision — same
// authority gate as starting a cycle or setting its capacity (Phase
// 31). See docs/development-plan.md's Phase 39's "Editing UI for a
// relative item" — start/end can each independently be re-typed
// (offsetDays/percent) or re-dragged to a target date (targetDate),
// see src/lib/dates/resolve.ts's dateBoundaryInput; either path
// recomputes and persists the offset/percent, never a bare date.
export async function updatePhaseBoundary(actor: Member, phaseId: string, input: UpdatePhaseBoundaryInput) {
  await requireCycleInitiationEligibility(actor);

  const [phaseRow] = await db.select().from(phase).where(eq(phase.id, phaseId));
  if (!phaseRow) {
    throw new NotFoundError("Phase not found");
  }
  const [cycleRow] = await db.select().from(cycle).where(eq(cycle.id, phaseRow.cycleId));
  if (!cycleRow || cycleRow.communityId !== actor.communityId) {
    throw new NotFoundError("Phase not found");
  }

  const nextStart = input.start
    ? toStoredBoundary(input.start, cycleRow.startDate, cycleRow.endDate)
    : startBoundaryOf(phaseRow);
  const nextEnd = input.end
    ? toStoredBoundary(input.end, cycleRow.startDate, cycleRow.endDate)
    : endBoundaryOf(phaseRow);

  // docs/spec.md's one defined sanity check — only applied to a
  // boundary pair actually being directly edited right now; a pair
  // drifting into violation because something else moved (the Cycle's
  // own dates) surfaces as the live orderInvalid flag instead, never
  // blocked (see getPhaseFlags).
  if (violatesBoundaryOrder(nextStart.date, nextEnd.date)) {
    throw new AppError("This phase's end can't resolve before its own start");
  }

  const [updated] = await db
    .update(phase)
    .set({ ...startColumns(nextStart), ...endColumns(nextEnd) })
    .where(eq(phase.id, phaseId))
    .returning();
  return { ...updated, flags: getPhaseFlags(cycleRow, updated) };
}

// Which module (if any) getNavContext (src/lib/nav.ts) should pin for
// every member currently `coming` to this Cycle while this Phase is
// the current one — e.g. Recruitment during a Recruitment phase, so
// non-holders can still track progress and invite people; Shifts once
// sign-ups matter, ahead of the event. Same authority gate as every
// other Phase/Cycle-configuration write above. Not validated against
// nav.ts's HIGHLIGHTABLE_MODULES here — an unrecognized or since-
// removed key just never matches in getNavContext, same "stale key
// silently drops" posture member.pinnedModuleKeys already takes.
export async function updatePhaseHighlight(actor: Member, phaseId: string, highlightModuleKey: string | null) {
  await requireCycleInitiationEligibility(actor);

  const [phaseRow] = await db.select().from(phase).where(eq(phase.id, phaseId));
  if (!phaseRow) {
    throw new NotFoundError("Phase not found");
  }
  const [cycleRow] = await db.select().from(cycle).where(eq(cycle.id, phaseRow.cycleId));
  if (!cycleRow || cycleRow.communityId !== actor.communityId) {
    throw new NotFoundError("Phase not found");
  }

  const [updated] = await db
    .update(phase)
    .set({ highlightModuleKey })
    .where(eq(phase.id, phaseId))
    .returning();
  return updated;
}

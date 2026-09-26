import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx, type Tx } from "@/db";
import {
  branch,
  community,
  cycle,
  cycleType,
  form,
  permissionGrant,
  phase,
  requirement,
  shiftOccurrence,
  shiftSeries,
  task,
  taskAssignment,
  taskDependency,
  taskMilestone,
  taskResource,
  taskWikiRevision,
} from "@/db/schema";
import type { member as memberTable, phase as phaseTable } from "@/db/schema";
import { AppError, ConflictError, ConfirmationRequiredError, ForbiddenError, NotFoundError } from "../errors";
import { memberHasTier } from "../eligibility";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";
import { cloneSpatialPlanIntoNewCycle } from "../spatial-planning";
import { recomputeCalendarEventDatesForCycle } from "../calendar-events";
import { normalizeTaskMilestonesForCycle, normalizeTaskMilestonesForPhase } from "../tasks/milestones";
import { copyPermissionGrants, type PermissionModuleKey } from "../permissions";
import { requireCycleOpen } from "./lifecycle";
import {
  boundaryForEditing,
  dateBoundaryInput,
  deriveClonedBoundaryRecipe,
  normalizeBoundary,
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

// Exported — src/lib/task-packs/export.ts reuses these two exact
// mappings (a real Phase row -> the shared boundary shape) rather than
// re-deriving them a second place.
export function startBoundaryOf(p: Phase): StoredBoundary {
  return {
    dateType: p.startDateType,
    date: p.startDate,
    relativeBasis: p.startRelativeBasis,
    relativeValue: p.startRelativeValue,
  };
}

export function endBoundaryOf(p: Phase): StoredBoundary {
  return {
    dateType: p.endDateType,
    date: p.endDate,
    relativeBasis: p.endRelativeBasis,
    relativeValue: p.endRelativeValue,
  };
}

function startColumns(b: StoredBoundary) {
  return {
    startDateType: b.dateType,
    startDate: b.date,
    startRelativeBasis: b.relativeBasis,
    startRelativeValue: b.relativeValue,
  };
}

function endColumns(b: StoredBoundary) {
  return {
    endDateType: b.dateType,
    endDate: b.date,
    endRelativeBasis: b.relativeBasis,
    endRelativeValue: b.relativeValue,
  };
}

// `start`/`end` carry the full absolute/relative shape (Phase 39); the
// flat `startDate`/`endDate` fields are kept as shorthand for "absolute,
// this exact date" — the common case, and what every caller before
// Phase 39 already sends. `start`/`end` win if both are given.
export const phaseInput = z.object({
  name: z.string().min(1),
  order: z.number().int(),
  startDate: z.string().min(1).nullable().optional(),
  endDate: z.string().min(1).nullable().optional(),
  start: dateBoundaryInput.optional(),
  end: dateBoundaryInput.optional(),
});
export type PhaseInput = z.infer<typeof phaseInput>;

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
    // "Starting a second Cycle while one's already open now shows an
    // explicit confirmation step" — docs/development-plan.md's Phase
    // 65. See createCycle below.
    confirmed: z.boolean().optional(),
  }),
  z.object({
    source: z.literal("clone_previous"),
    name: z.string().min(1),
    cycleTypeId: z.string().uuid().nullable().optional(),
    // A clone's own working dates (Phase 39's Event window) — optional.
    // Set here (rather than only via updateCycleSettings afterwards) so
    // the clone can re-derive its phased boundaries AND its shift
    // roster's occurrence timestamps immediately, in the same call; a
    // clone without them defers shift occurrence materialization ("defer
    // occurrence materialization when target dates unknown", docs/cycle-
    // scope-remediation-plan.md §4.8) to whenever the dates are set.
    startDate: z.string().min(1).nullable().optional(),
    endDate: z.string().min(1).nullable().optional(),
    // "Also clone its spatial plan?" — docs/spec.md's "Cloning across
    // cycles." Only meaningful on this exact path (the immediately-
    // previous-cycle clone), the same restriction Shadow slots'
    // suggested_member_id carry-forward already established — see
    // cloneMostRecentCycle below.
    cloneSpatialPlan: z.boolean().optional(),
    confirmed: z.boolean().optional(),
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
    throw new ConflictError("Events are not enabled for this Community");
  }
  if (
    communityRow.cycleInitiationTierId &&
    !memberHasTier(actor, communityRow.cycleInitiationTierId)
  ) {
    throw new ForbiddenError("You don't have the tier required to start an event");
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

// Exported — src/lib/task-packs/import.ts's own cycle-from-pack
// creation reuses this exact check rather than re-deriving it.
export async function requireCycleTypeInCommunity(communityId: string, cycleTypeId: string) {
  const [row] = await db
    .select({ id: cycleType.id })
    .from(cycleType)
    .where(and(eq(cycleType.id, cycleTypeId), eq(cycleType.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Event type not found in your community");
  }
}

// On-site mode's shift-lock only blocks *starting* a new Cycle, not
// editing an already-running one's dates/capacity (updateCycleSettings,
// updatePhaseBoundary, updatePhaseHighlight below all reuse
// requireCycleInitiationEligibility too, deliberately left unlocked) —
// so the check lives here, not inside that shared eligibility gate.
export async function createCycle(actor: Member, input: CreateCycleInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);
  await requireCycleInitiationEligibility(actor);
  if (input.cycleTypeId) {
    await requireCycleTypeInCommunity(actor.communityId, input.cycleTypeId);
  }

  // "Starting a second Cycle while one's already open ... now shows an
  // explicit confirmation step naming the cycle that's already open" —
  // docs/development-plan.md's Phase 65. Reuses the exact same
  // ConfirmationRequiredError flow tasks/join-requests.ts's self-assign
  // check already established, rather than a new error type — the
  // caller is expected to pre-compute this and show a real confirm
  // banner (see src/app/(app)/tasks/[id]/page.tsx's
  // needsSelfAssignConfirmation for the UX pattern).
  if (!input.confirmed) {
    const [openCycle] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.communityId, actor.communityId), isNull(cycle.closedAt)))
      .orderBy(desc(cycle.startedAt))
      .limit(1);
    if (openCycle) {
      throw new ConfirmationRequiredError(
        `"${openCycle.name}" is already open — starting another cycle won't close it. Start anyway?`,
      );
    }
  }

  if (input.source === "clone_previous") {
    return cloneMostRecentCycle(
      actor,
      input.name,
      input.cycleTypeId ?? null,
      input.cloneSpatialPlan ?? false,
      input.startDate ?? null,
      input.endDate ?? null,
    );
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
    throw new ConflictError("An event's end date can't be before its own start date");
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

    // §4.7 — every cycle is born with its backstop, auto-claimed to
    // whoever started it (D6).
    await createBackstopTask(tx, actor, newCycle.id);

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
  startDate: string | null,
  endDate: string | null,
) {
  const [previous] = await db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt))
    .limit(1);
  if (!previous) {
    throw new NotFoundError("No previous event to clone");
  }
  if (violatesBoundaryOrder(startDate, endDate)) {
    throw new ConflictError("An event's end date can't be before its own start date");
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
        startDate,
        endDate,
      })
      .returning();

    const phaseIdMap = await clonePhases(tx, previous, newCycle.id);
    // A clone with its own dates set here (rather than null, ready to be
    // filled in via updateCycleSettings later) resolves every cloned
    // phase recipe against them immediately — the same recompute
    // updateCycleSettings runs, so the two paths never drift.
    if (startDate) {
      await recomputePhaseDatesForCycle(tx, newCycle.id, startDate, endDate);
    }
    const taskIdMap = await cloneTasks(tx, actor, previous.id, newCycle.id, phaseIdMap);
    await cloneRequirements(tx, taskIdMap);
    await cloneDependencies(tx, taskIdMap);
    await cloneTaskMilestones(tx, taskIdMap, phaseIdMap);
    await cloneWikiAndResources(tx, taskIdMap);
    await clonePermissionGrants(tx, taskIdMap);

    // §2.6/D9-D11 — the roster carries across a clone (see
    // cloneShiftRoster below): the placement (series rows, confirmed and
    // proposed alike) always travels; occurrences re-derive their
    // timestamps relative to the target cycle's dates when known.
    await cloneShiftRoster(tx, actor, previous, newCycle);

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

    // §4.7/D6 — the new cycle gets its backstop filled too (see
    // ensureCloneHasBackstop): the cloned one auto-claimed, or a fresh
    // one when the previous cycle predates the module.
    await ensureCloneHasBackstop(tx, actor, newCycle.id);

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

function previewMilestoneDate(
  m: Pick<typeof taskMilestone.$inferSelect, "relativeBasis" | "relativeValue" | "parentType">,
  phaseStart: string | null,
  phaseEnd: string | null,
  cycleStart: string | null,
  cycleEnd: string | null,
): string | null {
  if (!m.parentType || !m.relativeBasis || m.relativeValue === null) return null;
  const start = m.parentType === "phase" ? phaseStart : cycleStart;
  const end = m.parentType === "phase" ? phaseEnd : cycleEnd;
  return recomputeBoundary(
    { dateType: "relative", date: null, relativeBasis: m.relativeBasis, relativeValue: m.relativeValue },
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
      deriveClonedBoundaryRecipe(startBoundaryOf(p), previous.startDate, previous.endDate),
      hypotheticalStart,
      hypotheticalEnd,
    );
    const end = recomputeBoundary(
      deriveClonedBoundaryRecipe(endBoundaryOf(p), previous.startDate, previous.endDate),
      hypotheticalStart,
      hypotheticalEnd,
    );
    return { name: p.name, order: p.order, start: start.date, end: end.date };
  });
  const previewByOldPhaseId = new Map(oldPhases.map((p, i) => [p.id, previewPhases[i]]));

  const oldTasks = await db
    .select({ id: task.id, title: task.title, cycleId: task.cycleId, phaseId: task.phaseId })
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
    const isPhaseParent = m.parentType === "phase";
    const previewPhase = isPhaseParent ? previewByOldPhaseId.get(m.phaseId ?? t.phaseId ?? "") : undefined;
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
  previousCycle: Pick<typeof cycle.$inferSelect, "id" | "startDate" | "endDate">,
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
    const start = deriveClonedBoundaryRecipe(startBoundaryOf(p), previousCycle.startDate, previousCycle.endDate);
    const end = deriveClonedBoundaryRecipe(endBoundaryOf(p), previousCycle.startDate, previousCycle.endDate);
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
        relativeBasis: m.relativeBasis,
        relativeValue: m.relativeValue,
        parentType: m.parentType,
        phaseId: newPhaseId ?? null,
        status: "confirmed" as const,
        isDeadline: m.isDeadline,
        proposedBy: m.proposedBy,
        createdBy: m.createdBy,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rowsToInsert.length > 0) {
    await tx.insert(taskMilestone).values(rowsToInsert);
  }
}

// "Carrying forward across cycles" — docs/spec.md: the wiki summary and
// the resource list both come along as the new task's starting point on
// clone. Only the current (most recent) wiki revision carries forward,
// as one new seed revision — not the whole edit history. Spec calls it
// "the wiki summary," singular, and task-notes.ts already establishes
// that "current" is nothing but the latest revision; dragging every old
// edit forward would re-create the exact clutter spec explicitly avoids
// by dropping comments on clone. Resources copy wholesale (spec's own
// word) since there's no revision concept to collapse there — every
// link is independently useful next time. Attribution carries with the
// content (editedBy/addedBy stay the original author) rather than
// reassigning to the cloning actor, the same posture cloneTaskMilestones
// already takes for createdBy/proposedBy above.
async function cloneWikiAndResources(tx: Tx, taskIdMap: Map<string, string>) {
  if (taskIdMap.size === 0) return;
  const oldTaskIds = [...taskIdMap.keys()];

  const allRevisions = await tx
    .select()
    .from(taskWikiRevision)
    .where(inArray(taskWikiRevision.taskId, oldTaskIds))
    .orderBy(desc(taskWikiRevision.editedAt));
  const currentRevisionByTask = new Map<string, (typeof allRevisions)[number]>();
  for (const r of allRevisions) {
    // Ordered newest-first — the first one seen per task is its current
    // revision, same "first wins" dedup shadowSuggestionsByTask uses.
    if (!currentRevisionByTask.has(r.taskId)) currentRevisionByTask.set(r.taskId, r);
  }
  if (currentRevisionByTask.size > 0) {
    await tx.insert(taskWikiRevision).values(
      [...currentRevisionByTask.values()].map((r) => ({
        taskId: taskIdMap.get(r.taskId)!,
        content: r.content,
        editedBy: r.editedBy,
      })),
    );
  }

  const oldResources = await tx.select().from(taskResource).where(inArray(taskResource.taskId, oldTaskIds));
  if (oldResources.length > 0) {
    await tx.insert(taskResource).values(
      oldResources.map((res) => ({
        taskId: taskIdMap.get(res.taskId)!,
        addedBy: res.addedBy,
        label: res.label,
        url: res.url,
        tag: res.tag,
      })),
    );
  }
}

// §4.7 (docs/cycle-scope-remediation-plan.md): every cycle is born with
// a backstop — a critical, single-slot, `backstop`-granted task whose
// first holder is auto-claimed to the member who started the cycle (D6).
// It's an ordinary task beyond that: transferable and unclaimable like
// anything else, and clearing it just turns it into the visible critical
// gap D6 describes — no special machinery. The grant's scope comes from
// placement (§2.1): the task sits in this brand-new cycle, so it grants
// `backstop` to this cycle only, never beyond.
async function createBackstopTask(tx: Tx, actor: Member, cycleId: string) {
  // task.branchId is NOT NULL; the backstop task must sit on some branch
  // for the field's sake, but its scope is its cycle placement, never its
  // branch — the community's first branch is as good a home as any.
  const [branchRow] = await tx
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.communityId, actor.communityId))
    .limit(1);
  if (!branchRow) {
    throw new ConflictError("No branch exists yet — create one before starting an event");
  }

  const [backstopTask] = await tx
    .insert(task)
    .values({
      communityId: actor.communityId,
      branchId: branchRow.id,
      cycleId,
      title: "Backstop",
      description:
        "The standing accountable holder for this cycle's critical tasks. Unclaimed criticals stay open and claimable by anyone — this task's holder is simply the named party responsible for getting each one moving if it stalls.",
      tags: ["backstop"],
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      capacity: 1,
      openness: "request",
      critical: true,
      createdBy: actor.id,
    })
    .returning();

  await tx.insert(permissionGrant).values({
    communityId: actor.communityId,
    moduleKey: "backstop",
    taskId: backstopTask.id,
  });
  await tx.insert(taskAssignment).values({ taskId: backstopTask.id, memberId: actor.id });
}

// D6 — a cloned cycle must be born with its backstop filled regardless
// of whether the previous cycle had one. If it did, that task was cloned
// like everything else (§4.4 carries its `backstop` grant) but clones
// come over unclaimed, so it's auto-claimed to the new startedBy. If it
// didn't (every cycle that predates the module), the task is created
// fresh. Either way the new cycle ends up with exactly one backstop task
// — no single-cardinality-per-scope collision — held by the person who
// just started this cycle.
async function ensureCloneHasBackstop(tx: Tx, actor: Member, newCycleId: string) {
  const [clonedBackstop] = await tx
    .select({ id: task.id })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .where(
      and(
        eq(permissionGrant.communityId, actor.communityId),
        eq(permissionGrant.moduleKey, "backstop"),
        eq(task.cycleId, newCycleId),
      ),
    )
    .limit(1);
  if (clonedBackstop) {
    await tx.insert(taskAssignment).values({ taskId: clonedBackstop.id, memberId: actor.id });
  } else {
    await createBackstopTask(tx, actor, newCycleId);
  }
}

// PermissionGrants travel with their task on clone — a task that
// granted "admin" or "branch_coordination" in the previous cycle
// should still grant it in the new cycle, or the "whichever cycle's
// pack includes it" reset mechanism spec describes doesn't actually
// work. There's no scope column to remap: a grant's scope comes from
// the granted task's own placement (task.cycleId, docs/cycle-scope-
// remediation-plan.md §2.1), and the cloned task now sits in the
// brand-new cycle, so its grant row — copied verbatim below — already
// points at the new cycle's data. The actual insert is the shared
// copyPermissionGrants helper (the same one pack import calls, §4.4);
// this function is just the clone path's way of building that helper's
// per-task module-key map from the source cycle's live grant rows.
async function clonePermissionGrants(tx: Tx, taskIdMap: Map<string, string>) {
  if (taskIdMap.size === 0) return;

  const oldGrants = await tx
    .select()
    .from(permissionGrant)
    .where(inArray(permissionGrant.taskId, [...taskIdMap.keys()]));
  if (oldGrants.length === 0) return;

  const moduleKeysByTask = new Map<string, PermissionModuleKey[]>();
  for (const g of oldGrants) {
    const keys = moduleKeysByTask.get(taskIdMap.get(g.taskId)!) ?? [];
    if (!keys.includes(g.moduleKey)) keys.push(g.moduleKey);
    moduleKeysByTask.set(taskIdMap.get(g.taskId)!, keys);
  }
  await copyPermissionGrants(tx, oldGrants[0].communityId, moduleKeysByTask);
}

// §2.6/§4.8 — clone carries the roster. Placement is the declaration,
// so that part always travels: every series of the previous cycle
// clones into the new one, confirmed or proposed alike (a proposed one
// carries as a proposal — confirmedAt null — for the new cycle's
// manager to confirm). Occurrences are the tricky half: they're
// absolute datetimes, so "cloning carries the recipe, not the date"
// (docs/spec.md) applies — each occurrence is converted into a derived
// offset recipe against the *source* cycle's start_date via the same
// deriveClonedBoundaryRecipe machinery Phase 38/39 use, then resolved
// against the destination cycle's own dates, preserving the original
// time-of-day and duration. When the target dates aren't known yet (a
// clone with no start_date — the common case, set later via
// updateCycleSettings), occurrence materialization is deferred: the
// series still arrives in the roster, with no occurrence rows until its
// manager generates them (the plan's "defer occurrence materialization
// when target dates unknown").
async function cloneShiftRoster(
  tx: Tx,
  actor: Member,
  previous: { id: string; startDate: string | null; endDate: string | null },
  newCycle: { id: string; startDate: string | null; endDate: string | null },
) {
  const sourceSeries = await tx.select().from(shiftSeries).where(eq(shiftSeries.cycleId, previous.id));
  if (sourceSeries.length === 0) return;

  const newSeriesIdMap = new Map<string, string>();
  for (const s of sourceSeries) {
    const [newSeries] = await tx
      .insert(shiftSeries)
      .values({
        communityId: actor.communityId,
        branchId: s.branchId,
        cycleId: newCycle.id,
        title: s.title,
        description: s.description,
        defaultCapacity: s.defaultCapacity,
        sourceTaskId: s.sourceTaskId,
        confirmedAt: s.confirmedAt,
        createdBy: actor.id,
      })
      .returning();
    newSeriesIdMap.set(s.id, newSeries.id);
  }

  if (!previous.startDate || !newCycle.startDate) return;

  const oldOccurrences = await tx
    .select()
    .from(shiftOccurrence)
    .where(inArray(shiftOccurrence.seriesId, sourceSeries.map((s) => s.id)));
  if (oldOccurrences.length === 0) return;

  const rowsToInsert: { seriesId: string; startsAt: Date; endsAt: Date; capacity: number | null }[] = [];
  for (const o of oldOccurrences) {
    const newSeriesId = newSeriesIdMap.get(o.seriesId);
    if (!newSeriesId) continue;
    const newStartsAt = derivedCloneOccurrenceStart(
      o.startsAt,
      previous.startDate,
      previous.endDate,
      newCycle.startDate,
      newCycle.endDate,
    );
    if (!newStartsAt) continue; // un-derivable — defer this one
    rowsToInsert.push({
      seriesId: newSeriesId,
      startsAt: newStartsAt,
      endsAt: new Date(newStartsAt.getTime() + (o.endsAt.getTime() - o.startsAt.getTime())),
      capacity: o.capacity,
    });
  }
  if (rowsToInsert.length > 0) {
    await tx.insert(shiftOccurrence).values(rowsToInsert);
  }
}

// One shift occurrence's absolute startsAt re-derived against a
// destination cycle's dates: converted to an offset recipe measured in
// days from the source cycle's start_date (deriveClonedBoundaryRecipe —
// an un-derivable source yields a fully unset recipe and deferral),
// resolved against the destination start/end, then the original
// UTC time-of-day spliced back onto the resulting date so the shift's
// clock time survives a cycle-length move.
function derivedCloneOccurrenceStart(
  startsAt: Date,
  sourceCycleStart: string,
  sourceCycleEnd: string | null,
  destCycleStart: string,
  destCycleEnd: string | null,
): Date | null {
  const recipe = deriveClonedBoundaryRecipe(
    { dateType: "absolute", date: startsAt.toISOString().slice(0, 10), relativeBasis: null, relativeValue: null },
    sourceCycleStart,
    sourceCycleEnd,
  );
  const resolved = recomputeBoundary(recipe, destCycleStart, destCycleEnd);
  if (!resolved.date) return null;
  const withTime = new Date(`${resolved.date}T${startsAt.toISOString().slice(11)}`);
  return Number.isNaN(withTime.getTime()) ? null : withTime;
}

export async function listCycles(actor: Member) {
  return db
    .select()
    .from(cycle)
    .where(eq(cycle.communityId, actor.communityId))
    .orderBy(desc(cycle.startedAt));
}

// Every open (not yet closed) cycle in the community, regardless of
// any member's own participation — the nav switcher's narrow-to-one
// dropdown candidates, and Participation's own per-cycle sections
// (docs/development-plan.md's Phase 65).
export async function listOpenCycles(actor: Member) {
  return db
    .select()
    .from(cycle)
    .where(and(eq(cycle.communityId, actor.communityId), isNull(cycle.closedAt)))
    .orderBy(desc(cycle.startedAt));
}

export interface PhaseFlags {
  orderInvalid: boolean;
}

// Live, standing flags — never persisted, computed fresh whenever a
// Phase is read alongside its Cycle.
function getPhaseFlags(phaseRow: Phase): PhaseFlags {
  return {
    orderInvalid: violatesBoundaryOrder(startBoundaryOf(phaseRow).date, endBoundaryOf(phaseRow).date),
  };
}

export async function getCycle(actor: Member, cycleId: string) {
  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Event not found");
  }

  const phases = await db.select().from(phase).where(eq(phase.cycleId, cycleId)).orderBy(phase.order);
  // Live flags computed fresh on every read — see getPhaseFlags above.
  return { ...row, phases: phases.map((p) => ({ ...p, flags: getPhaseFlags(p) })) };
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
  // §4.3/8c joining configuration — see src/db/schema/cycle.ts's own
  // comment block for what each of these does. Null clears the
  // per-cycle form pointer (back to the community's) or the joining-
  // window deadline (back to "until the cycle closes").
  recruitmentApplicationFormId: z.string().uuid().nullable().optional(),
  applicationsOpen: z.boolean().optional(),
  invitesOpen: z.boolean().optional(),
  joiningWindowClosesAt: z.string().min(1).nullable().optional(),
});
export type UpdateCycleSettingsInput = z.infer<typeof updateCycleSettingsInput>;

export async function updateCycleSettings(actor: Member, cycleId: string, input: UpdateCycleSettingsInput) {
  await requireCycleInitiationEligibility(actor);

  const [row] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!row) {
    throw new NotFoundError("Event not found");
  }
  requireCycleOpen(row);

  if (input.recruitmentApplicationFormId) {
    const [formRow] = await db
      .select({ id: form.id })
      .from(form)
      .where(and(eq(form.id, input.recruitmentApplicationFormId), eq(form.communityId, actor.communityId)));
    if (!formRow) {
      throw new NotFoundError("Form not found in your community");
    }
  }

  const nextStartDate = input.startDate !== undefined ? input.startDate : row.startDate;
  const nextEndDate = input.endDate !== undefined ? input.endDate : row.endDate;
  if (violatesBoundaryOrder(nextStartDate, nextEndDate)) {
    throw new ConflictError("An event's end date can't be before its own start date");
  }

  const [updated] = await db
    .update(cycle)
    .set({
      ...(input.capacity !== undefined && { capacity: input.capacity }),
      ...(input.returningWindowClosesAt !== undefined && {
        returningWindowClosesAt: input.returningWindowClosesAt ? new Date(input.returningWindowClosesAt) : null,
      }),
      ...(input.recruitmentApplicationFormId !== undefined && {
        recruitmentApplicationFormId: input.recruitmentApplicationFormId,
      }),
      ...(input.applicationsOpen !== undefined && { applicationsOpen: input.applicationsOpen }),
      ...(input.invitesOpen !== undefined && { invitesOpen: input.invitesOpen }),
      ...(input.joiningWindowClosesAt !== undefined && {
        joiningWindowClosesAt: input.joiningWindowClosesAt ? new Date(input.joiningWindowClosesAt) : null,
      }),
      ...(input.startDate !== undefined && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
    })
    .where(eq(cycle.id, cycleId))
    .returning();

  if (input.startDate !== undefined || input.endDate !== undefined) {
    await recomputePhaseDatesForCycle(db, cycleId, nextStartDate, nextEndDate);
    await recomputeCalendarEventDatesForCycle(cycleId, nextStartDate, nextEndDate);
    const gainedBoundary =
      (!row.startDate && nextStartDate !== null) || (!row.endDate && nextEndDate !== null);
    if (gainedBoundary) await normalizeTaskMilestonesForCycle(cycleId);
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
    const nextStart = normalizeBoundary(startBoundaryOf(p), anchorStart, anchorEnd);
    const nextEnd = normalizeBoundary(endBoundaryOf(p), anchorStart, anchorEnd);
    if (
      nextStart.date === p.startDate &&
      nextStart.dateType === p.startDateType &&
      nextStart.relativeBasis === p.startRelativeBasis &&
      nextStart.relativeValue === p.startRelativeValue &&
      nextEnd.date === p.endDate &&
      nextEnd.dateType === p.endDateType &&
      nextEnd.relativeBasis === p.endRelativeBasis &&
      nextEnd.relativeValue === p.endRelativeValue
    ) {
      continue;
    }
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
// 31). Relative boundaries are authored as a resolved date; the server
// infers the canonical basis/value recipe against the Cycle's dates.
// Saving the same resolved date preserves the existing recipe.
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
  requireCycleOpen(cycleRow);

  const nextStart = input.start
    ? boundaryForEditing(startBoundaryOf(phaseRow), input.start, cycleRow.startDate, cycleRow.endDate)
    : startBoundaryOf(phaseRow);
  const nextEnd = input.end
    ? boundaryForEditing(endBoundaryOf(phaseRow), input.end, cycleRow.startDate, cycleRow.endDate)
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
  await normalizeTaskMilestonesForPhase(phaseId);
  return { ...updated, flags: getPhaseFlags(updated) };
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
  requireCycleOpen(cycleRow);

  const [updated] = await db
    .update(phase)
    .set({ highlightModuleKey })
    .where(eq(phase.id, phaseId))
    .returning();
  return updated;
}

// Phases could previously only ever enter a Cycle via createCycle's own
// `phases` array (no UI ever called it with one — see createBlankCycle
// above) or by being carried through a clone — there was genuinely no
// way to add one to an already-existing Cycle. Same authority gate as
// updatePhaseBoundary/updatePhaseHighlight just above. `order` is
// computed here, not trusted from the caller — always appended after
// whatever already exists; `phase.order` has no unique constraint, so a
// rare concurrent-add race is cosmetic at worst, not a crash.
export async function addPhase(actor: Member, cycleId: string, input: Omit<PhaseInput, "order">) {
  await requireCycleInitiationEligibility(actor);

  const [cycleRow] = await db.select().from(cycle).where(eq(cycle.id, cycleId));
  if (!cycleRow || cycleRow.communityId !== actor.communityId) {
    throw new NotFoundError("Event not found");
  }
  requireCycleOpen(cycleRow);

  const existing = await db.select({ id: phase.id }).from(phase).where(eq(phase.cycleId, cycleId));
  const values = phaseInsertValues(cycleId, cycleRow.startDate, cycleRow.endDate, {
    ...input,
    order: existing.length,
  });

  const [created] = await db.insert(phase).values(values).returning();
  return { ...created, flags: getPhaseFlags(created) };
}

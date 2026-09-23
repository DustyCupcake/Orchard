import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, community, cycle, shiftSeries, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "../errors";
import { requireModuleEnabled } from "../modules";
import {
  isShiftManagerForScope,
  listShiftManagerScopesForMember,
  requireShiftManagerForScope,
} from "./management";

type Member = typeof memberTable.$inferSelect;
type ShiftSeriesRow = typeof shiftSeries.$inferSelect;

async function getCommunityRow(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  if (!row) {
    throw new NotFoundError("Community not found");
  }
  return row;
}

// A series' scope, and how it enters that scope (D9–D11): null `cycleId`
// = a standing, community-wide series (manager-added only); a real
// `cycleId` = placement in that cycle's roster. Any member can place a
// series in a still-collecting cycle (its roster opens together on the
// manager's one-way open act); placement into an already-open roster
// lands as an unconfirmed proposal.
export const createShiftSeriesInput = z.object({
  branchId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultCapacity: z.number().int().positive(),
  sourceTaskId: z.string().uuid().nullable().optional(),
  cycleId: z.string().uuid().nullable().optional(),
});
export type CreateShiftSeriesInput = z.infer<typeof createShiftSeriesInput>;

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

  const cycleId = input.cycleId ?? null;
  let confirmedAt: Date | null;
  if (cycleId) {
    const [cycleRow] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
    // §2.6/D11 composition: during the collecting window (the roster's
    // open act not yet performed) any member's placement opens with the
    // batch; once opened, a placement is a proposal awaiting the cycle's
    // shift_management holder's confirmation before it's visible or
    // claimable. A closed cycle's roster is frozen — no new placements.
    if (cycleRow.closedAt) {
      throw new ForbiddenError("This cycle is closed — its shift roster is frozen");
    }
    confirmedAt =
      cycleRow.shiftSignupsOpenedAt === null
        ? new Date()
        : // Proposal — confirmedAt stays null.
          null;
  } else {
    // D10: standing series are manager-added. Creating one is the
    // standing scope's shift_management holder's act, never an open
    // free-for-all.
    await requireShiftManagerForScope(actor, null);
    confirmedAt = new Date();
  }

  const [created] = await db
    .insert(shiftSeries)
    .values({
      communityId: actor.communityId,
      branchId: input.branchId ?? null,
      cycleId,
      title: input.title,
      description: input.description ?? null,
      defaultCapacity: input.defaultCapacity,
      sourceTaskId: input.sourceTaskId ?? null,
      confirmedAt,
      createdBy: actor.id,
    })
    .returning();
  return created;
}

// "A one-click action on a Task's detail view" — creates a ShiftSeries
// with sourceTaskId set and branch/description pre-filled from the task.
// Deliberately takes no input of its own beyond which task — everything
// else is derived, the same no-intermediate-form posture Subtasks
// already established. Under D10 (docs/cycle-scope-remediation-plan.md
// §2.6) the resulting standing series is manager-added, so this is the
// standing scope's shift_management holder's act — the old "any current
// holder" route is gone (createShiftSeries enforces the manager gate).
// The original Task is left untouched; converting is a starting point
// for coordination to actually retire it, never automatic.
export async function rotateTaskIntoShift(actor: Member, taskId: string) {
  const [taskRow] = await db
    .select()
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, actor.communityId)));
  if (!taskRow) {
    throw new NotFoundError("Task not found");
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

// D10 — "the coordinator view" is now grant-based and scope-based: you
// coordinate a series exactly when you currently hold (non-shadow) the
// shift_management-granted task in the series' scope (its cycleId, or
// the standing scope for a cycle-less series). The old "series creator,
// or whoever holds sourceTaskId" routes are gone — a series in a scope
// with no filled shift_management holder is an honest unmanaged gap.
// The name is kept so every existing coordinator-only call site
// (occurrence generation, signup listing, no-show marking, archiving,
// nav pinning, needs-action) picks up the new authority unchanged.
export async function isShiftCoordinator(actor: Member, series: Pick<ShiftSeriesRow, "cycleId">) {
  return isShiftManagerForScope(actor, series.cycleId);
}

export async function requireShiftCoordinator(
  actor: Member,
  series: Pick<ShiftSeriesRow, "cycleId">,
) {
  if (!(await isShiftCoordinator(actor, series))) {
    throw new ForbiddenError("Only this scope's shift manager can do that");
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

// D11 — the roster's one-way open act. Only the cycle's own
// shift_management holder can open its sign-ups; the window is the
// single call that flips the roster from "collecting" (placements open
// to any member, sign-ups closed) to "open" (sign-ups live, new
// placements become proposals). Irreversible: once set, it's never
// unset.
export async function openCycleShiftSignups(actor: Member, cycleId: string) {
  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "shifts");

  const [cycleRow] = await db
    .select()
    .from(cycle)
    .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
  if (!cycleRow) {
    throw new NotFoundError("Cycle not found");
  }
  if (cycleRow.closedAt) {
    throw new ForbiddenError("This cycle is closed — its shift roster is frozen");
  }
  await requireShiftManagerForScope(actor, cycleId);
  if (cycleRow.shiftSignupsOpenedAt !== null) {
    throw new ForbiddenError("This cycle's shift sign-ups are already open");
  }

  const [updated] = await db
    .update(cycle)
    .set({ shiftSignupsOpenedAt: new Date() })
    .where(eq(cycle.id, cycleId))
    .returning();
  return updated;
}

// D11 — confirm a pending proposal: the cycle's shift_management holder
// admits a series that was placed after the open act into the visible,
// claimable roster. Only the series' own cycle's manager can do it, and
// only for a genuinely unconfirmed (cycle-placed, confirmedAt null)
// series.
export async function confirmShiftProposal(actor: Member, seriesId: string) {
  const series = await getShiftSeries(actor, seriesId);
  if (!series.cycleId || series.confirmedAt) {
    throw new ForbiddenError("This series isn't a pending proposal");
  }
  await requireShiftManagerForScope(actor, series.cycleId);

  const [updated] = await db
    .update(shiftSeries)
    .set({ confirmedAt: new Date() })
    .where(eq(shiftSeries.id, seriesId))
    .returning();
  return updated;
}

// Every unconfirmed placement in scopes the actor currently manages —
// the proposal-confirmation surface for the /shifts page and the cycle
// view. Empty for a member who manages nothing (or nothing pending).
export async function listPendingShiftProposals(actor: Member) {
  const managedScopes = await listShiftManagerScopesForMember(actor);
  const managedCycleIds = managedScopes.filter((s): s is string => s !== null);
  if (managedCycleIds.length === 0) return [];

  return db
    .select({ series: shiftSeries, cycleName: cycle.name, cycleId: cycle.id })
    .from(shiftSeries)
    .innerJoin(cycle, eq(cycle.id, shiftSeries.cycleId))
    .where(and(isNull(shiftSeries.confirmedAt), inArray(shiftSeries.cycleId, managedCycleIds)))
    .orderBy(desc(shiftSeries.createdAt));
}

// Re-place an existing series into another scope — standing → cycle,
// cycle → standing, or cycle → cycle (D10: every re-placement is the
// destination scope's manager's act, never an open free-for-all).
// Because the manager is personally placing it, the series lands
// confirmed immediately regardless of the target roster's window state
// — the proposal path exists for non-managers.
export async function setShiftSeriesScope(actor: Member, seriesId: string, cycleId: string | null) {
  const series = await getShiftSeries(actor, seriesId);
  if (series.cycleId === cycleId) {
    return series;
  }

  const communityRow = await getCommunityRow(actor.communityId);
  requireModuleEnabled(communityRow, "shifts");

  if (cycleId) {
    const [cycleRow] = await db
      .select()
      .from(cycle)
      .where(and(eq(cycle.id, cycleId), eq(cycle.communityId, actor.communityId)));
    if (!cycleRow) {
      throw new NotFoundError("Cycle not found in your community");
    }
    if (cycleRow.closedAt) {
      throw new ForbiddenError("This cycle is closed — its shift roster is frozen");
    }
  }
  await requireShiftManagerForScope(actor, cycleId);

  const [updated] = await db
    .update(shiftSeries)
    .set({ cycleId, confirmedAt: new Date() })
    .where(eq(shiftSeries.id, seriesId))
    .returning();
  return updated;
}

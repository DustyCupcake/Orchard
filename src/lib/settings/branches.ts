import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { branch, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { requireNotOnsiteLockedForCommunity } from "../onsite-mode";
import { requireAdmins } from "./admins";
import { recordSettingChanges } from "./history";

type Member = typeof memberTable.$inferSelect;

// The three call-default fields are nullable — null means "inherit
// the Community's own default" (see docs/spec.md's "Defaults live per
// Branch, with a Community-level fallback"), so they need to
// distinguish "leave unset" from "explicitly false", unlike a plain
// optional boolean would.
const nullableTriState = z.union([z.boolean(), z.null()]).optional();

export const createBranchInput = z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  defaultCallHasAgenda: nullableTriState,
  defaultCallNeedsSummary: nullableTriState,
  defaultCallRequireRead: nullableTriState,
});
export type CreateBranchInput = z.infer<typeof createBranchInput>;

export const updateBranchInput = createBranchInput.partial();
export type UpdateBranchInput = z.infer<typeof updateBranchInput>;

export async function listBranches(actor: Member) {
  return db.select().from(branch).where(eq(branch.communityId, actor.communityId)).orderBy(branch.name);
}

// No Admins yet (per MVP scope) — any authenticated member can define
// the Community's branches, same as every other settings surface here.
export async function createBranch(actor: Member, input: CreateBranchInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);

  // In a transaction with the log write, for the reason on
  // recordSettingChanges: an audit trail that can have a gap in it is worse
  // than none, because it reads as complete.
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(branch)
      .values({
        communityId: actor.communityId,
        name: input.name,
        description: input.description ?? null,
        defaultCallHasAgenda: input.defaultCallHasAgenda ?? null,
        defaultCallNeedsSummary: input.defaultCallNeedsSummary ?? null,
        defaultCallRequireRead: input.defaultCallRequireRead ?? null,
      })
      .returning();

    await recordSettingChanges(tx, {
      actor,
      entity: "branch",
      action: "created",
      entityId: created.id,
      entityLabel: created.name,
      // Nothing existed, so every field is a change from nothing — which
      // makes `current` an empty object rather than a row of nulls, and
      // makes the three nullable defaults log as "inherits" rather than as
      // an edit from an empty string.
      current: {},
      // Only the fields a reader would want to know were chosen. The three
      // call-defaults are left out when they are null, because null means
      // "inherit the community's default" (see createBranchInput) and a
      // create that says "call agenda: nothing" is a false statement about
      // a setting nobody set — the log line that matters is "this branch
      // inherits", which is already what the entity row says.
      changes: {
        name: created.name,
        description: created.description,
        ...(created.defaultCallHasAgenda !== null && {
          defaultCallHasAgenda: created.defaultCallHasAgenda,
        }),
        ...(created.defaultCallNeedsSummary !== null && {
          defaultCallNeedsSummary: created.defaultCallNeedsSummary,
        }),
        ...(created.defaultCallRequireRead !== null && {
          defaultCallRequireRead: created.defaultCallRequireRead,
        }),
      },
    });
    return created;
  });
}

export async function updateBranch(actor: Member, branchId: string, input: UpdateBranchInput) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);

  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(branch)
      .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
    if (!before) {
      throw new NotFoundError("Branch not found");
    }

    const [updated] = await tx
      .update(branch)
      .set({
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.defaultCallHasAgenda !== undefined && { defaultCallHasAgenda: input.defaultCallHasAgenda }),
        ...(input.defaultCallNeedsSummary !== undefined && {
          defaultCallNeedsSummary: input.defaultCallNeedsSummary,
        }),
        ...(input.defaultCallRequireRead !== undefined && {
          defaultCallRequireRead: input.defaultCallRequireRead,
        }),
      })
      .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)))
      .returning();

    await recordSettingChanges(tx, {
      actor,
      entity: "branch",
      action: "updated",
      entityId: updated.id,
      entityLabel: updated.name,
      current: before,
      changes: input,
    });
    return updated;
  });
}

export async function deleteBranch(actor: Member, branchId: string) {
  await requireNotOnsiteLockedForCommunity(actor.communityId);

  const [existing] = await db
    .select({ id: branch.id, name: branch.name })
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Branch not found");
  }

  const [inUse] = await db.select({ id: task.id }).from(task).where(eq(task.branchId, branchId)).limit(1);
  if (inUse) {
    throw new ConflictError("Tasks still reference this branch — reassign or remove them first");
  }

  await db.transaction(async (tx) => {
    await tx.delete(branch).where(eq(branch.id, branchId));
    // entityLabel is the whole point here. The row is about to be gone, so
    // a log that resolved the name at read time would say "—" for this
    // entry for as long as the log exists — "Branch North was deleted" has
    // to keep reading as Branch North.
    await recordSettingChanges(tx, {
      actor,
      entity: "branch",
      action: "deleted",
      entityId: branchId,
      entityLabel: existing.name,
      current: existing,
      changes: { name: null },
    });
  });
}

// --- Phase 55: branches created `pending` by a non-Admins pack importer ---
//
// See docs/spec.md's "Create new branch" needs its own check" (Pack
// import review): a pack-importing member who doesn't hold Admins can
// still create a new branch on confirm — tasks attach to it right
// away, the import doesn't block waiting on anyone — but it lands
// `pending` instead of `confirmed`, surfacing here the same way a
// pending Placement surfaces for Spatial planning (Phase 38). Admins-
// gated, same authority as the rest of /settings.

export async function listPendingBranches(actor: Member) {
  await requireAdmins(actor);
  return db
    .select()
    .from(branch)
    .where(and(eq(branch.communityId, actor.communityId), eq(branch.status, "pending")))
    .orderBy(branch.name);
}

export async function confirmPendingBranch(actor: Member, branchId: string) {
  await requireAdmins(actor);

  const [existing] = await db
    .select()
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Branch not found");
  }
  if (existing.status !== "pending") {
    throw new ConflictError("This branch has no pending review to confirm");
  }

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(branch)
      .set({ status: "confirmed" })
      .where(eq(branch.id, branchId))
      .returning();
    await recordSettingChanges(tx, {
      actor,
      entity: "branch",
      action: "confirmed",
      entityId: branchId,
      entityLabel: existing.name,
      current: existing,
      changes: { status: "confirmed" },
    });
    return row;
  });
  return updated;
}

// Unlike a rejected Placement move (which reverts to a real prior
// confirmed geometry), a rejected pending branch never had one — "the
// one place this doesn't perfectly mirror Placement" per spec — so
// rejecting means re-pointing every task that landed on it to a real,
// already-confirmed branch instead, then removing the now-empty
// pending row entirely rather than leaving a standing branch nobody
// ever actually approved.
export async function rejectPendingBranch(actor: Member, branchId: string, reassignToBranchId: string) {
  await requireAdmins(actor);

  const [existing] = await db
    .select()
    .from(branch)
    .where(and(eq(branch.id, branchId), eq(branch.communityId, actor.communityId)));
  if (!existing) {
    throw new NotFoundError("Branch not found");
  }
  if (existing.status !== "pending") {
    throw new ConflictError("This branch has no pending review to reject");
  }
  if (reassignToBranchId === branchId) {
    throw new ConflictError("Pick a different branch to reassign these tasks to");
  }

  const [target] = await db
    .select({ id: branch.id, status: branch.status })
    .from(branch)
    .where(and(eq(branch.id, reassignToBranchId), eq(branch.communityId, actor.communityId)));
  if (!target) {
    throw new NotFoundError("Reassignment branch not found");
  }
  if (target.status !== "confirmed") {
    throw new ConflictError("Reassign to a confirmed branch, not another pending one");
  }

  await db.transaction(async (tx) => {
    const reassigned = await tx
      .update(task)
      .set({ branchId: reassignToBranchId })
      .where(eq(task.branchId, branchId))
      .returning({ id: task.id });
    await tx.delete(branch).where(eq(branch.id, branchId));
    // Logged as one rejected, not as a deletion followed by a separate
    // reassignment nobody performed: these are two effects of one decision,
    // and a reader looking at the log later needs to see the decision.
    // The task count is a count rather than the ids, because the ids of
    // moved tasks are an implementation detail and the number is what
    // someone asks about.
    await recordSettingChanges(tx, {
      actor,
      entity: "branch",
      action: "rejected",
      entityId: branchId,
      entityLabel: existing.name,
      current: existing,
      changes: { status: null, tasksReassigned: reassigned.length },
    });
  });
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, cycle, memberIdentity, permissionGrant, task, taskAssignment } from "@/db/schema";
import {
  isBackstopForScope,
  listBackstopHoldersForScopes,
  listBackstopScopesForMember,
  resolveBackstopHolder,
} from "@/lib/backstop";
import { createCycle } from "@/lib/cycles";
import { recomputeAttentionLevels } from "@/lib/attention";
import { setPermissionGrant } from "@/lib/permissions";
import { claimTask } from "@/lib/tasks";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

// The D7 hard-flag notification resolves the scope's backstop and emails
// them — the attention job goes through notifyBackstopOfHardFlag ->
// sendBackstopHardFlagEmail, so mocking the mailer at that seam lets a
// test observe the send without a real transport.
vi.mock("@/lib/mailer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/mailer")>();
  return { ...actual, sendBackstopHardFlagEmail: vi.fn() };
});
import { sendBackstopHardFlagEmail } from "@/lib/mailer";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Order the seedlings",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

async function backstopGrants(communityId: string) {
  return db
    .select({ taskId: permissionGrant.taskId, moduleKey: permissionGrant.moduleKey })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, "backstop")));
}

describe("backstop scope resolution", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("resolves a scope's backstop from its granted task's placement (§2.1), cycle vs community", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);

    // Blank-created cycles arrive with their backstop auto-claimed to
    // whoever started them (D6) — so cycleA's backstop is alice and
    // cycleB's is alice too (both started by her).
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const cycleB = await createCycle(alice, { source: "blank", name: "2028 Season", confirmed: true });

    expect((await resolveBackstopHolder(testCommunity.id, cycleA.id))?.id).toBe(alice.id);
    expect((await resolveBackstopHolder(testCommunity.id, cycleB.id))?.id).toBe(alice.id);
    // No community/evergreen backstop yet — cycle-scoped backstops don't
    // cover cycle-less criticals (D1) and vice versa.
    expect(await resolveBackstopHolder(testCommunity.id, null)).toBeNull();

    // A cycle-less task granted `backstop` is the community/evergreen
    // backstop — and it does NOT cover any cycle's tasks.
    const evergreen = await insertTask(testCommunity.id, branch.id, bob.id, { title: "Evergreen backstop" });
    await grantPermission(testCommunity.id, "backstop", evergreen.id);
    await claimTask(bob, evergreen.id);

    expect((await resolveBackstopHolder(testCommunity.id, null))?.id).toBe(bob.id);
    expect((await resolveBackstopHolder(testCommunity.id, cycleA.id))?.id).toBe(alice.id);

    expect(await isBackstopForScope(alice, cycleA.id)).toBe(true);
    expect(await isBackstopForScope(bob, null)).toBe(true);
    expect(await isBackstopForScope(bob, cycleA.id)).toBe(false);
  });

  it("lists a member's backstop scopes and per-scope holders in one query", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const evergreen = await insertTask(testCommunity.id, branch.id, bob.id, { title: "Evergreen backstop" });
    await grantPermission(testCommunity.id, "backstop", evergreen.id);
    await claimTask(bob, evergreen.id);

    expect(await listBackstopScopesForMember(alice)).toEqual(expect.arrayContaining([cycleA.id]));
    expect(await listBackstopScopesForMember(bob)).toEqual([null]);

    const holders = await listBackstopHoldersForScopes(testCommunity.id, [cycleA.id, null]);
    expect(holders.get(cycleA.id)?.memberName).toBe("Alice");
    expect(holders.get(null)?.memberName).toBe("Bob");
    expect(holders.has("bogus-cycle-id")).toBe(false);
  });

  it("keeps backstop single-cardinality per scope: replacing a cycle's grant leaves other scopes alone", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const evergreen = await insertTask(testCommunity.id, branch.id, bob.id, { title: "Evergreen backstop" });
    await grantPermission(testCommunity.id, "backstop", evergreen.id);
    await claimTask(bob, evergreen.id);

    // A different cycle-A task becomes the cycle's backstop: the earlier
    // auto-created grant is replaced in the same scope, unmatched scopes
    // untouched (setPermissionGrant's ordinary per-scope rule).
    const replacement = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: cycleA.id,
      title: "New backstop",
    });
    await setPermissionGrant(testCommunity.id, "backstop", replacement.id);

    const grants = await backstopGrants(testCommunity.id);
    expect(grants.map((g) => g.taskId)).toEqual(expect.arrayContaining([replacement.id, evergreen.id]));
    // The old auto-created backstop task no longer grants anything.
    const oldBackstop = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.cycleId, cycleA.id), eq(task.title, "Backstop")));
    const oldGrant = grants.find((g) => g.taskId === oldBackstop[0].id);
    expect(oldGrant).toBeUndefined();
    // Unclaimed new holder → no backstop for the scope right now.
    expect(await resolveBackstopHolder(testCommunity.id, cycleA.id)).toBeNull();
    expect((await resolveBackstopHolder(testCommunity.id, null))?.id).toBe(bob.id);
  });
});

describe("cycle kickoff creates the backstop (§4.7/D6)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a critical single-slot backstop task, granted and auto-claimed to the startedBy", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);

    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const [backstopTask] = await db
      .select()
      .from(task)
      .where(and(eq(task.cycleId, newCycle.id), eq(task.title, "Backstop")));
    expect(backstopTask).toBeDefined();
    expect(backstopTask.critical).toBe(true);
    expect(backstopTask.capacity).toBe(1);

    const [grant] = await db
      .select()
      .from(permissionGrant)
      .where(and(eq(permissionGrant.taskId, backstopTask.id), eq(permissionGrant.moduleKey, "backstop")));
    expect(grant).toBeDefined();

    const [assigned] = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, backstopTask.id));
    expect(assigned.memberId).toBe(alice.id);
    expect(assigned.isShadow).toBe(false);
  });

  it("auto-claims a cloned cycle's backstop to the new startedBy (§4.4 carries the grant)", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    await createCycle(alice, { source: "blank", name: "2026 Season" });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });

    const clonedBackstops = await db
      .select({ id: task.id })
      .from(permissionGrant)
      .innerJoin(task, eq(task.id, permissionGrant.taskId))
      .where(
        and(
          eq(permissionGrant.communityId, testCommunity.id),
          eq(permissionGrant.moduleKey, "backstop"),
          eq(task.cycleId, cloned.id),
        ),
      );
    expect(clonedBackstops).toHaveLength(1);

    const [assigned] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.taskId, clonedBackstops[0].id));
    expect(assigned.memberId).toBe(alice.id);
  });

  it("creates a fresh backstop when the cloned source predates the module", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    // A real previous cycle, but with no backstop task — as every cycle
    // created before this module shipped has.
    const [previous] = await db
      .insert(cycle)
      .values({ communityId: testCommunity.id, name: "Legacy", status: "active", sourceType: "blank" })
      .returning();
    expect(previous).toBeDefined();

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });

    const [backstopTask] = await db
      .select()
      .from(task)
      .where(and(eq(task.cycleId, cloned.id), eq(task.title, "Backstop")));
    expect(backstopTask.critical).toBe(true);
    const [grant] = await db
      .select()
      .from(permissionGrant)
      .where(and(eq(permissionGrant.taskId, backstopTask.id), eq(permissionGrant.moduleKey, "backstop")));
    expect(grant).toBeDefined();
    const [assigned] = await db.select().from(taskAssignment).where(eq(taskAssignment.taskId, backstopTask.id));
    expect(assigned.memberId).toBe(alice.id);
  });
});

describe("backstop hard-flag notification (D7)", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetDatabase();
  });

  it("emails the scope's backstop when a critical task in their cycle hard-flags", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await db
      .insert(memberIdentity)
      .values({ memberId: alice.id, provider: "magic_link", loginEmail: "alice@example.com" });

    const criticalTask = await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: newCycle.id,
      critical: true,
      createdAt: daysAgo(20),
    });

    await recomputeAttentionLevels();

    expect(sendBackstopHardFlagEmail).toHaveBeenCalledTimes(1);
    expect(sendBackstopHardFlagEmail).toHaveBeenCalledWith(
      "alice@example.com",
      expect.objectContaining({ taskUrl: `/tasks/${criticalTask.id}` }),
    );
  });

  it("does not email when the scope has no filled backstop", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    // Blank cycles always have a backstop — drop its holder by removing
    // the auto-created grant so the scope is empty, then hard-flag.
    const newCycle = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const [backstopTask] = await db.select().from(task).where(and(eq(task.cycleId, newCycle.id), eq(task.title, "Backstop")));
    await db.delete(permissionGrant).where(eq(permissionGrant.taskId, backstopTask.id));

    await insertTask(testCommunity.id, branch.id, alice.id, {
      cycleId: newCycle.id,
      critical: true,
      createdAt: daysAgo(20),
    });

    await recomputeAttentionLevels();

    expect(sendBackstopHardFlagEmail).not.toHaveBeenCalled();
  });
});
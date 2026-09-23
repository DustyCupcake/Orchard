import { sql } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { setPermissionGrant, addPermissionGrant, type PermissionModuleKey } from "@/lib/permissions";
import { claimTask } from "@/lib/tasks";

type FixtureMember = typeof memberTable.$inferSelect;

// Every access gate this codebase enforces reads from PermissionGrant
// now (docs/development-plan.md's Phase 63) — this is the direct-DB
// equivalent of what used to be `db.update(community).set({
// conflictTeamTaskId: t.id })` or `.set({ adminsTag: "x" })` plus
// tagging a task with that string. addPermissionGrant works fine even
// for the six single-cardinality modules in ordinary test setup (one
// grant per module is the common case); use setPermissionGrant
// directly from "@/lib/permissions" instead if a test genuinely needs
// to replace an existing single grant.
export async function grantPermission(communityId: string, moduleKey: PermissionModuleKey, taskId: string) {
  await addPermissionGrant(communityId, moduleKey, taskId);
}

// Makes `member` the current shift_management holder for a scope —
// cycleId null (the default) = the standing, community-wide scope,
// matching how src/lib/shifts/management.ts resolves scope from the
// granted task's placement. The grant task carries the scope, gets the
// single-cardinality-per-scope setPermissionGrant treatment, and is
// auto-claimed so the resolver's "current (non-shadow) holder" question
// is answered. Tests self-contained per file via resetDatabase, so
// calling this again for the same scope simply replaces the grant.
export async function grantShiftManagementTo(member: FixtureMember, branchId: string, cycleId: string | null = null) {
  const [grantTask] = await db
    .insert(task)
    .values({
      communityId: member.communityId,
      branchId,
      cycleId,
      title: "Shift manager",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 1 },
      capacity: 1,
      openness: "request",
      critical: false,
      createdBy: member.id,
    })
    .returning();
  await setPermissionGrant(member.communityId, "shift_management", grantTask.id);
  await claimTask(member, grantTask.id);
  return grantTask;
}

// Wipes everything derived from Community — cheap and total, so each
// test file starts from a clean slate. Requires a real, disposable
// Postgres reachable via DATABASE_URL (see package.json's "test" script).
export async function resetDatabase() {
  await db.execute(sql`TRUNCATE TABLE community RESTART IDENTITY CASCADE`);
}

export async function createFixtures() {
  const [testCommunity] = await db
    .insert(community)
    .values({ name: "Test Community" })
    .returning();

  const [testBranch] = await db
    .insert(branch)
    .values({ communityId: testCommunity.id, name: "Fruit" })
    .returning();

  const [alice] = await db
    .insert(member)
    .values({ communityId: testCommunity.id, name: "Alice" })
    .returning();

  const [bob] = await db
    .insert(member)
    .values({ communityId: testCommunity.id, name: "Bob" })
    .returning();

  return { community: testCommunity, branch: testBranch, alice, bob };
}

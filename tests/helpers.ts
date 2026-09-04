import { sql } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, member } from "@/db/schema";
import { addPermissionGrant, type PermissionModuleKey } from "@/lib/permissions";

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

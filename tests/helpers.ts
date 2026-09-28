import { sql } from "drizzle-orm";
import { db } from "@/db";
import { branch, community, member, task } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import {
  addPermissionGrant,
  allowsMultipleGrants,
  setPermissionGrant,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { claimTask } from "@/lib/tasks";
import { createProfileQuestion, type CreateProfileQuestionInput } from "@/lib/profile-questions/questions";
import type { CreateSensitiveFieldAccessRuleInput } from "@/lib/sensitive-data";

type FixtureMember = typeof memberTable.$inferSelect;

// Every access gate this codebase enforces reads from PermissionGrant
// now (docs/development-plan.md's Phase 63) — this is the direct-DB
// equivalent of what used to be `db.update(community).set({
// conflictTeamTaskId: t.id })` or `.set({ adminsTag: "x" })` plus
// tagging a task with that string. Route through the domain function for
// the module's cardinality so fixtures cannot create duplicates that the
// real Settings action would reject.
export async function grantPermission(communityId: string, moduleKey: PermissionModuleKey, taskId: string) {
  if (allowsMultipleGrants(moduleKey)) {
    await addPermissionGrant(communityId, moduleKey, taskId);
  } else {
    await setPermissionGrant(communityId, moduleKey, taskId);
  }
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
//
// Retried once on a deadlock (SQLSTATE 40P01), and that is not papering
// over a real problem: this statement is the one place the suite
// deliberately takes a lock on nearly every table, so it is the one
// statement that can be deadlocked *against the harness rather than the
// code under test*. The concrete case is back-to-back runs — a previous
// vitest process's pooled connection can still be executing this same
// TRUNCATE when the next run starts, and two concurrent `TRUNCATE
// ... CASCADE`s on one table deadlock each other because each takes the
// referencing tables' locks in whatever order its own plan visits them.
// The symptom is unmistakable and confined to fixtures: an
// `insert on table branch violates foreign key
// branch_community_id_community_id_fk` a statement *after* the community
// row was created, or a deadlock reported from inside resetDatabase
// itself.
//
// A deadlock inside application code still surfaces as a test failure —
// nothing here catches those, because this only ever wraps this one
// statement.
export async function resetDatabase() {
  try {
    await db.execute(sql`TRUNCATE TABLE community RESTART IDENTITY CASCADE`);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "40P01") throw err;
    await db.execute(sql`TRUNCATE TABLE community RESTART IDENTITY CASCADE`);
  }
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

export async function insertTask(
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
      title: "A task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

/**
 * A restricted profile question, in one call.
 *
 * Every test that needs a sensitive question used to do it in three
 * statements — create, add an access rule, then flip the flag — because
 * that was the only order the write side permitted, and flipping the flag
 * afterwards was the only way to do it at all. Both halves of that are
 * gone: the flag is chosen at creation and cannot move, and the audience
 * rides along with it.
 *
 * A helper rather than repeating the shape, because the point of these
 * tests is the *reading* and not the three-step incantation, and a helper
 * only has to be updated in one place when the shape changes again.
 *
 * The audience is passed rather than invented. Making a Tier here would
 * be tidier to call and worse to read: a test that says
 * `{ audience: { unlockedByTierId: t.id } }` states the audience it is
 * testing against, and one that says `createRestrictedQuestion(alice, …)`
 * states a Tier that exists only so the call can be made — which is
 * exactly the kind of thing that makes a test pass for the wrong reason.
 */
export async function createRestrictedQuestion(
  actor: FixtureMember,
  input: Omit<CreateProfileQuestionInput, "sensitive" | "audience" | "emergencyAccess">,
  options: {
    emergencyAccess?: boolean;
    audience: Omit<CreateSensitiveFieldAccessRuleInput, "questionId">;
  },
) {
  return createProfileQuestion(actor, {
    ...input,
    sensitive: true,
    ...options,
  });
}

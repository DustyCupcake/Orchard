import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { admissionLane, branch, community, cycleAdmissionLane, member, task } from "@/db/schema";
import { createEmptyLane, normalizeLaneRule, startingLanes, type AdmissionLaneRule } from "@/lib/recruitment/lane-rules";
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
// The grant functions take an actor rather than a communityId so that every
// grant reaches the settings change log (see setPermissionGrant's own
// comment). Tests were written against the communityId form, and most of
// them have a member in scope anyway — but not all: several set up a grant
// before creating any member. `actorFor` is the answer for those. It
// synthesises a member rather than requiring one, because a fixture's
// purpose is to create a permission state, not to exercise membership, and
// the log only needs *a* member id in the community.
export async function actorFor(communityId: string): Promise<FixtureMember> {
  const [existing] = await db
    .select()
    .from(member)
    .where(eq(member.communityId, communityId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(member)
    .values({ communityId, name: "Fixture Admin" })
    .returning();
  return created;
}

export async function grantPermission(communityId: string, moduleKey: PermissionModuleKey, taskId: string) {
  const actor = await actorFor(communityId);
  if (allowsMultipleGrants(moduleKey)) {
    await addPermissionGrant(actor, moduleKey, taskId);
  } else {
    await setPermissionGrant(actor, moduleKey, taskId);
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
  await setPermissionGrant(member, "shift_management", grantTask.id);
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

// ---------------------------------------------------------------------------
// Admission lanes (docs/admission-flow.md §2a)
// ---------------------------------------------------------------------------

// Lanes are rows now, and a community that has none is given the starting two
// the first time anything reads them. A test that needs a particular shape
// says so here rather than relying on that default, so what it is testing is
// stated at the top of the test.
//
// Written straight to the table: the authorised entry point (saveCommunityLanes)
// is what the lane tests themselves exercise, and every other test just needs
// the lanes to be a certain way before it starts. Only valid before any arrival
// exists, because arrivals reference their lane and nothing here is cascaded.
export async function setLanes(communityId: string, rules: Partial<AdmissionLaneRule>[]) {
  const existing = await db.select({ id: admissionLane.id }).from(admissionLane).where(eq(admissionLane.communityId, communityId));
  if (existing.length > 0) {
    await db.delete(cycleAdmissionLane).where(inArray(cycleAdmissionLane.laneId, existing.map((l) => l.id)));
    await db.delete(admissionLane).where(eq(admissionLane.communityId, communityId));
  }
  if (rules.length === 0) {
    // A community with no lanes at all would just be given the starting two on
    // the next read, so the one way to have none is to have only archived ones.
    await db.insert(admissionLane).values(
      startingLanes().map((rule) => ({ ...rule, id: undefined, communityId, archivedAt: new Date() })),
    );
    return [];
  }
  return db
    .insert(admissionLane)
    .values(
      rules.map((partial) => {
        const rule = normalizeLaneRule({ ...createEmptyLane(partial.kind ?? "invite"), ...partial });
        return {
          communityId,
          name: rule.name,
          kind: rule.kind,
          handlesKnowsPersonally: rule.handlesKnowsPersonally,
          handlesGoodFitOnly: rule.handlesGoodFitOnly,
          handlesNeither: rule.handlesNeither,
          publicSlug: rule.publicSlug,
          applicationRequired: rule.applicationRequired,
          interviewRequired: rule.interviewRequired,
          verification: rule.verification,
          reportsNeeded: rule.reportsNeeded,
          supportShortcutCount: rule.supportShortcutCount,
          openInCommunity: rule.openInCommunity,
        };
      }),
    )
    .returning();
}

// The four lanes a community that existed before lanes were rows was carried
// over to, which is what most of the recruitment tests were written against:
// someone a member knows personally comes in at once; every other invite and
// a public application go through the evaluated process.
export const LEGACY_LANES: Partial<AdmissionLaneRule>[] = [
  { name: "Invited — knows personally", kind: "invite", handlesKnowsPersonally: true, applicationRequired: false, interviewRequired: false },
  { name: "Invited — vouches (good fit)", kind: "invite", handlesGoodFitOnly: true },
  { name: "Invited — neither mark", kind: "invite", handlesNeither: true },
  { name: "Open application", kind: "public" },
];

export async function withLegacyLanes(communityId: string) {
  return setLanes(communityId, LEGACY_LANES);
}

// The knows-personally lane runs a community check; everything else as legacy.
export async function withCheckLane(communityId: string) {
  return setLanes(communityId, [
    { ...LEGACY_LANES[0], verification: "community_check" },
    ...LEGACY_LANES.slice(1),
  ]);
}

// ---------------------------------------------------------------------------
// How reports decide (docs/admission-flow.md §2)
// ---------------------------------------------------------------------------

// The policy most recruitment tests were written against, when it was an ordered
// list of rules: two yes admit, two no decline, anything else goes to a wider
// discussion that ends in a decline. Stated in the form's own terms.
export const POLICY_TWO_OF_TWO = {
  recruitmentInWhen: "custom",
  recruitmentCustomMinYes: 2,
  recruitmentCustomMaxNo: 2,
  recruitmentAnyNoMeans: "wider_discussion",
  recruitmentDiscussionEnds: "decline",
  recruitmentDeclineOutrightAt: 2,
} as const;

// How many reports every lane that has something to evaluate asks for. Written
// straight to the lanes, because an arrival copies it at entry — so this has to
// be set before anyone arrives.
export async function setReportsNeeded(communityId: string, reports: number) {
  await db
    .update(admissionLane)
    .set({ reportsNeeded: reports })
    .where(and(eq(admissionLane.communityId, communityId), isNotNull(admissionLane.reportsNeeded)));
}

// The legacy lanes, but with no interview: someone arriving by anything but "knows
// them personally" applies and is evaluated by any holder who reads it. Most of the
// recruitment suites are about evaluation, decisions and conversion rather than the
// interview, and an interview step before the decision (docs/admission-flow.md §2)
// would otherwise be a scheduling ritual in front of every one of them. The
// interview itself is tested in interviews.test.ts.
export async function withApplicationOnlyLanes(communityId: string) {
  return setLanes(
    communityId,
    LEGACY_LANES.map((lane) => (lane.kind === "public" || lane.handlesGoodFitOnly || lane.handlesNeither ? { ...lane, interviewRequired: false } : lane)),
  );
}

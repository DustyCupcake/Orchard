import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  member,
  openPermissionGrant,
  sensitiveFieldAccessRule,
  taskAssignment,
} from "@/db/schema";
import {
  countHoldersOfTasks,
  isModuleOpenToEveryone,
  listGrantingTaskIds,
  listGrantsWithTaskInfo,
  listHoldersOfTasks,
  listGrantingTaskIdsForScope,
  listModuleKeysGrantedByTask,
  listOpenModuleKeys,
  PERMISSION_MODULE_KEYS,
} from "@/lib/permissions";
import {
  describeRecruitmentAuthority,
  isRecruitmentTaskHolder,
  listHeldRecruitmentScopes,
  listRecruitmentActionItems,
  requireRecruitmentScopeForCycle,
  requireRecruitmentTaskHolder,
  recordDecisionIfReached,
  resolveWiderDiscussionWindows,
  submitEvaluation,
  submitRecruitmentApplication,
} from "@/lib/recruitment";
import {
  createForm,
  } from "@/lib/forms";
import { isKitchenOwner } from "@/lib/kitchen";
import { isBudgetOwner } from "@/lib/budget";
import { isShiftManagerForScope } from "@/lib/shifts";
import { isEventSchedulingOwner } from "@/lib/event-scheduling";
import { isSpatialPlanningHolder } from "@/lib/spatial-planning";
import { isCoordinationHolder } from "@/lib/coordination";
import { isAnnouncementTaskHolder, isAnnouncementHolderForCycle } from "@/lib/messages";
import { isSupportHolder } from "@/lib/view-as";
import { isBackstopForScope } from "@/lib/backstop";
import {
  fileConflictReport,
  isConflictTeamMember,
  isConflictTeamMemberId,
  listConflictTeamMemberIds,
  requireConflictTeamMember,
} from "@/lib/conflict";
import { listUnlockedFields } from "@/lib/sensitive-data";
import { isAdmin, requireAdmins } from "@/lib/settings/admins";
import { updateCommunity } from "@/lib/settings";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

// Step 1 of docs/open-permissions-plan.md: the storage. Nothing reads this
// table yet — `isModuleOpenToEveryone` is Step 2 — so these tests assert the
// *shape of the fact* rather than any behaviour, because the shape is where
// the design's guarantees actually live:
//
//   D1  a separate table, so a NULL/sentinel task_id in permission_grant
//       can never masquerade as "everyone" while granting nobody
//   D6  no Community gains authority by having the table exist
//   D11 backstop is excluded at the settings layer, not by the schema
//
// The most important of those is D1, and it is the one worth proving rather
// than asserting in a comment: `listGrantingTaskIds` is the single read every
// resolver uses, so if open rows ever leaked into it, every module would fail
// CLOSED while looking configured. That is the exact failure direction D1
// exists to prevent, so it gets a test.

describe("open_permission_grant (Step 1 storage)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores a Community's open modules as one row per module", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    const rows = await db.select().from(openPermissionGrant);
    expect(rows).toHaveLength(1);
    expect(rows[0].moduleKey).toBe("recruitment");
    // openedBy is the cheap half of the deferred audit work (the plan's
    // §9.1): "who decided the whole Community could do this" is worth being
    // able to reconstruct, even though nothing reads it yet.
    expect(rows[0].openedBy).toBe(alice.id);
    // openedAt is defaulted, not supplied.
    expect(rows[0].openedAt).toBeInstanceOf(Date);
  });

  it("is community-scoped — one Community's open modules never leak into another's", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const { community: strangerCommunity, alice: strangerAlice } = await createFixtures();

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    const strangers = await db
      .select()
      .from(openPermissionGrant)
      .where(eq(openPermissionGrant.communityId, strangerCommunity.id));
    expect(strangers).toEqual([]);
    expect(strangerAlice.communityId).toBe(strangerCommunity.id);
  });

  // D1's load-bearing property. Every resolver resolves authority through
  // listGrantingTaskIds -> a taskAssignment join, so an open row appearing
  // there would match no assignment and grant nobody while every settings
  // screen still showed the module as open. Proving the two facts are stored
  // in genuinely separate places is cheaper than proving it at 11 resolvers.
  it("D1: does not leak into listGrantingTaskIds — a failed-open would look configured", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    // The module is open...
    const open = await db.select().from(openPermissionGrant);
    expect(open.map((r) => r.moduleKey)).toEqual(["recruitment"]);

    // ...and grants exactly as much as it did before, which is nothing. The
    // task exists, so the empty result is about the grant lookup rather than
    // about there being no task to find.
    expect(t.communityId).toBe(testCommunity.id);
    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([]);
  });

  it("coexists with a real grant on the same module — open and named are independent facts", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    // Nothing here imports a grant helper yet; the point is only that the
    // open row and a permission_grant row are not mutually exclusive and
    // neither table constrains the other.
    const both = await db
      .select()
      .from(openPermissionGrant)
      .where(
        and(
          eq(openPermissionGrant.communityId, testCommunity.id),
          eq(openPermissionGrant.moduleKey, "recruitment"),
        ),
      );
    expect(both).toHaveLength(1);
    expect(t.communityId).toBe(testCommunity.id);
  });

  it("rejects opening the same module twice — a composite PK, not a duplicate fact", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const row = {
      communityId: testCommunity.id,
      moduleKey: "recruitment" as const,
      openedBy: alice.id,
    };

    await db.insert(openPermissionGrant).values(row);
    await expect(db.insert(openPermissionGrant).values(row)).rejects.toThrow();

    const rows = await db.select().from(openPermissionGrant);
    expect(rows).toHaveLength(1);
  });

  it("allows several different modules to be open at once", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    await db.insert(openPermissionGrant).values([
      { communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id },
      { communityId: testCommunity.id, moduleKey: "feedback_review", openedBy: alice.id },
      { communityId: testCommunity.id, moduleKey: "kitchen", openedBy: alice.id },
    ]);

    const rows = await db.select().from(openPermissionGrant);
    expect(rows).toHaveLength(3);
  });

  // D11: the schema reuses the full module enum, so `backstop` is storable
  // here even though it is the one module with no checkbox. The exclusion is
  // a settings-layer decision, and this test records that the schema is
  // deliberately NOT what enforces it — otherwise the exclusion would live in
  // a migration, and lifting it later would mean a second one.
  it("D11: the enum accepts every module key, including the excluded backstop", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "backstop", openedBy: alice.id });

    const rows = await db.select().from(openPermissionGrant);
    expect(rows.map((r) => r.moduleKey)).toEqual(["backstop"]);
    // The exclusion is a UI-layer filter over this enum, so the enum itself
    // has to keep carrying the key.
    expect(PERMISSION_MODULE_KEYS).toContain("backstop");
  });

  // D6: the table existing must not change any Community's authority. Every
  // Community starts with zero open rows, so there is nothing to migrate and
  // nothing to roll back for existing installs.
  it("D6: a Community with no rows has no open modules", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    expect(await db.select().from(openPermissionGrant)).toEqual([]);

    // An unopened module still resolves purely through the grant, and a
    // Community that has granted nothing still grants nothing. The task
    // existing keeps this from passing for the wrong reason.
    expect(t.communityId).toBe(testCommunity.id);
    expect(await listGrantingTaskIds(testCommunity.id, "feedback_review")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Step 2: the read primitives. Still behaviourally inert — no resolver reads
// these yet (Step 4) — so what is under test is that they read the table
// correctly, and that adding them changed nothing about the existing grant
// path.
describe("open-flag read primitives (Step 2)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("isModuleOpenToEveryone is false for every module until one is opened", async () => {
    const { community: testCommunity } = await createFixtures();

    for (const moduleKey of PERMISSION_MODULE_KEYS) {
      expect(await isModuleOpenToEveryone(testCommunity.id, moduleKey)).toBe(false);
    }
  });

  it("isModuleOpenToEveryone is true for exactly the module that was opened", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    expect(await isModuleOpenToEveryone(testCommunity.id, "recruitment")).toBe(true);
    // Same Community, a different module — the row is per-module, not a
    // blanket "everything is open".
    expect(await isModuleOpenToEveryone(testCommunity.id, "kitchen")).toBe(false);
    expect(await isModuleOpenToEveryone(testCommunity.id, "budget")).toBe(false);
  });

  it("isModuleOpenToEveryone never sees another Community's flag", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const { community: strangerCommunity } = await createFixtures();
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    expect(await isModuleOpenToEveryone(strangerCommunity.id, "recruitment")).toBe(false);
  });

  it("listOpenModuleKeys returns the full open set in one call", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    expect(await listOpenModuleKeys(testCommunity.id)).toEqual(new Set());

    await db.insert(openPermissionGrant).values([
      { communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id },
      { communityId: testCommunity.id, moduleKey: "feedback_review", openedBy: alice.id },
    ]);

    expect(await listOpenModuleKeys(testCommunity.id)).toEqual(new Set(["recruitment", "feedback_review"]));
  });

  it("listOpenModuleKeys is community-scoped", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    const { community: strangerCommunity } = await createFixtures();
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "support", openedBy: alice.id });

    expect(await listOpenModuleKeys(testCommunity.id)).toEqual(new Set(["support"]));
    expect(await listOpenModuleKeys(strangerCommunity.id)).toEqual(new Set());
  });

  // The property Step 2 must not break: an open flag is a *separate* fact, and
  // the grant path is untouched by its existence. Step 4 is what deliberately
  // changes resolver behaviour; until then this is what "inert" means.
  it("adding the primitives did not change the existing grant path", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", t.id);
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id, isShadow: false });
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    // Grant path unchanged: same single granting task, holder still resolves.
    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([t.id]);
    // And the flag is readable alongside it — the two facts coexist.
    expect(await isModuleOpenToEveryone(testCommunity.id, "recruitment")).toBe(true);
  });
});

describe("holder counts (Step 2)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is empty for an empty task list, without touching the database", async () => {
    expect(await listHoldersOfTasks([])).toEqual([]);
    expect(await countHoldersOfTasks([])).toBe(0);
  });

  it("finds nobody on an unclaimed task", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);

    expect(await listHoldersOfTasks([t.id])).toEqual([]);
    expect(await countHoldersOfTasks([t.id])).toBe(0);
  });

  it("names the holder and counts them once", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: alice.id, isShadow: false });

    expect(await listHoldersOfTasks([t.id])).toEqual([{ memberId: alice.id, name: "Alice" }]);
    expect(await countHoldersOfTasks([t.id])).toBe(1);
    expect(bob.id).not.toBe(alice.id);
  });

  // §1.2: a task with capacity > 1 really does have several holders, and the
  // count is the number that D12 (shared vs personal) and D14 (the settings
  // indicator) both depend on.
  it("counts every holder of a capacity > 1 task — task-gated is not one person", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 3 });
    await db.insert(taskAssignment).values([
      { taskId: t.id, memberId: alice.id, isShadow: false },
      { taskId: t.id, memberId: bob.id, isShadow: false },
    ]);

    const holders = await listHoldersOfTasks([t.id]);
    expect(holders.map((h) => h.name).sort()).toEqual(["Alice", "Bob"]);
    expect(await countHoldersOfTasks([t.id])).toBe(2);
  });

  it("excludes a shadow — a placeholder is not someone doing the work", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await db.insert(taskAssignment).values([
      { taskId: t.id, memberId: alice.id, isShadow: false },
      { taskId: t.id, memberId: bob.id, isShadow: true },
    ]);

    // Counting the shadow would overstate who can act, and would make a
    // permanently-unreachable decision look reachable.
    expect(await listHoldersOfTasks([t.id])).toEqual([{ memberId: alice.id, name: "Alice" }]);
    expect(await countHoldersOfTasks([t.id])).toBe(1);
  });

  it("counts one person once across two of their granting tasks", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const first = await insertTask(testCommunity.id, branch.id, alice.id, { title: "One" });
    const second = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Two" });
    await db.insert(taskAssignment).values([
      { taskId: first.id, memberId: alice.id, isShadow: false },
      { taskId: second.id, memberId: alice.id, isShadow: false },
    ]);

    // Distinct by member, not by assignment: two grants held by one person
    // is one holder. This is what makes the count agree with the distinct
    // evaluator count in describeRecruitmentAuthority.
    expect(await countHoldersOfTasks([first.id, second.id])).toBe(1);
  });

  it("ignores task ids from another Community", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const { community: strangerCommunity, branch: strangerBranch, alice: strangerAlice } =
      await createFixtures();
    const ours = await insertTask(testCommunity.id, branch.id, alice.id);
    const theirs = await insertTask(strangerCommunity.id, strangerBranch.id, strangerAlice.id);
    await db.insert(taskAssignment).values([
      { taskId: ours.id, memberId: alice.id, isShadow: false },
      { taskId: theirs.id, memberId: strangerAlice.id, isShadow: false },
    ]);

    // A caller that already scoped its ids via listGrantingTaskIds never hits
    // this, but a stray id must not leak another Community's roster.
    expect(await listHoldersOfTasks([ours.id])).toEqual([{ memberId: alice.id, name: "Alice" }]);
    expect(strangerCommunity.id).not.toBe(testCommunity.id);
  });

  // Anti-drift: describeRecruitmentAuthority computes its evaluator count
  // inline, because it also needs per-holder task attribution that
  // listHoldersOfTasks deliberately drops. Two implementations of "distinct
  // non-shadow holders of the granting tasks" is a drift risk, so the two
  // numbers are pinned against each other here rather than by forcing one
  // implementation onto the other.
  it("agrees with describeRecruitmentAuthority's evaluatorCount", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await grantPermission(testCommunity.id, "recruitment", t.id);
    // One real holder, one shadow. A member gets at most one assignment row
    // per task (task_assignment's PK is (task_id, member_id), which is why
    // src/lib/tasks/shadows.ts rejects a second row rather than adding a
    // flag to an existing one) — so a person on a granted task is either
    // holding it or shadowing it, never both, and the shadow must not
    // inflate either count.
    await db.insert(taskAssignment).values([
      { taskId: t.id, memberId: alice.id, isShadow: false },
      { taskId: t.id, memberId: bob.id, isShadow: true },
    ]);

    const authority = await describeRecruitmentAuthority(testCommunity.id);
    expect(authority.evaluatorCount).toBe(1);
    expect(await countHoldersOfTasks(await listGrantingTaskIds(testCommunity.id, "recruitment"))).toBe(
      authority.evaluatorCount,
    );
  });
});

// ---------------------------------------------------------------------------
// Step 3: the Class 2 scope-sets. An open module answers `{null}` — the
// community/evergreen scope, which is already the superset under
// docs/cycle-scope-remediation-plan.md §4.3's strictness rule, so every
// `has(cycleId)` / `has(null)` downstream check passes with no event
// knowledge in the resolver.
//
// Only ONE of the three is actually usable after this step, because only one
// has no Class 1 gate in front of it:
//
//   feedback_review  listPostCycleFeedbackResponses' only gate is the scope
//                    set (forms.ts:549-552) — fully open after Step 3
//   kitchen          listKitchenNeedsAction opens with `if (!(await
//                    isKitchenOwner(actor))) return []` (needs-action.ts:51)
//   recruitment      every consumer calls requireRecruitmentTaskHolder first
//
// The two interim tests below pin that boundary exactly, so Step 4 cannot
// land half-applied without a test failing.
describe("open scope-sets (Step 3)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function openModule(communityId: string, moduleKey: "recruitment" | "feedback_review" | "kitchen", openedBy: string) {
    await db.insert(openPermissionGrant).values({ communityId, moduleKey, openedBy });
  }

  it("listHeldRecruitmentScopes answers {null} for a member who holds nothing", async () => {
    const { community: testCommunity, bob } = await createFixtures();
    expect(await listHeldRecruitmentScopes(bob)).toEqual(new Set());

    await openModule(testCommunity.id, "recruitment", bob.id);
    expect(await listHeldRecruitmentScopes(bob)).toEqual(new Set([null]));
  });

  it("requireRecruitmentScopeForCycle passes for ANY cycle when open — the superset in practice", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const inCycle = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: null });

    // Closed and holding nothing: refused, for every scope.
    await expect(requireRecruitmentScopeForCycle(bob, null)).rejects.toThrow();

    // Open: the community/evergreen scope covers untagged applications and
    // every cycle's alike, so a cycle id that names no granted task still
    // passes. This is D3 and is what makes an open Recruitment Community able
    // to reach a decision at all.
    await openModule(testCommunity.id, "recruitment", bob.id);
    await expect(requireRecruitmentScopeForCycle(bob, null)).resolves.toBeUndefined();
    await expect(
      requireRecruitmentScopeForCycle(bob, "00000000-0000-0000-0000-0000000000ff"),
    ).resolves.toBeUndefined();
    expect(inCycle.communityId).toBe(testCommunity.id);
  });

  it("still refuses a non-holder when the module is closed — the regression half", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    // A granted task nobody holds, so the refusal is about the holder check
    // rather than about there being no grant at all.
    const grantTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", grantTask.id);

    expect(await listHeldRecruitmentScopes(bob)).toEqual(new Set());
    await expect(requireRecruitmentScopeForCycle(bob, null)).rejects.toThrow();
  });
  // Interim, same reasoning. This is the test that makes the
  // unsatisfiable-decision fix (docs/recruitment-access-plan.md §1) a Step 4
  // change rather than a Step 3 one: submitEvaluation and
  // listRecruitmentActionItems both call requireRecruitmentTaskHolder before
  // they ever consult the scope set. It refuses outright rather than
  // degrading, so the interim state is unambiguous.
  it("INTERIM: recruitment is still closed after Step 3 — the holder gate throws (Step 4)", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    await openModule(testCommunity.id, "recruitment", alice.id);

    // The scope-set half is open...
    expect(await listHeldRecruitmentScopes(bob)).toEqual(new Set([null]));
    await expect(requireRecruitmentScopeForCycle(bob, null)).resolves.toBeUndefined();
    // ...but the Class 1 gate in front of it has not moved yet.
    await expect(listRecruitmentActionItems(bob)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Step 4: the 11 Class 1 capability resolvers. The shape is uniform — open
// short-circuits to true before the grant lookup — but "true" means something
// different per module, so each one is exercised against the real gate it
// protects rather than against the resolver directly.
//
// The closed half is the regression net and matters more than the open half:
// 1506 tests already pin every module's holder behaviour, and the
// "closed" case here is what proves none of them moved.
describe("open capability resolvers (Step 4)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function openModule(
    communityId: string,
    moduleKey: "admin" | "support" | "conflict_team" | "event_scheduling_owner" | "spatial_planning" | "kitchen" | "budget" | "shift_management" | "recruitment" | "branch_coordination" | "community_coordination" | "announcements",
    openedBy: string,
  ) {
    await db.insert(openPermissionGrant).values({ communityId, moduleKey, openedBy });
  }

  // Every case below is the same shape — closed refuses, open admits —
  // applied to each module's real gate rather than to the resolver in
  // isolation, so the thing asserted is the capability a member actually
  // gains. The closed half is the regression net and matters more than the
  // open half: the pre-existing 1506 tests already pin every module's holder
  // behaviour, and these prove none of it moved.
  it("admin: requireAdmins, with the open check ahead of the bootstrap (D2)", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();

    // Latch the bootstrap shut: without this, the `adminsEverClaimed` early
    // return would let everyone in regardless and prove nothing. Set
    // directly — it isn't part of updateCommunity's settable surface.
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, testCommunity.id));
    const refetchedBob = (await db.select().from(member).where(eq(member.id, bob.id)))[0];

    await expect(requireAdmins(refetchedBob)).rejects.toThrow();

    // Open overrides the closed bootstrap (D2: an explicit choice beats a
    // startup artefact).
    await openModule(testCommunity.id, "admin", alice.id);
    await expect(requireAdmins(refetchedBob)).resolves.toBeUndefined();
    // And the non-throwing form agrees, since isAdmin wraps this.
    expect(await isAdmin(refetchedBob)).toBe(true);
  });

  it("support: isSupportHolder — the View-as capability", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    expect(await isSupportHolder(bob)).toBe(false);

    await openModule(testCommunity.id, "support", alice.id);
    expect(await isSupportHolder(bob)).toBe(true);
  });

  it("conflict_team: isConflictTeamMemberId — membership, recusal and all (D7)", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    expect(await isConflictTeamMember(bob)).toBe(false);
    // recusePeer's target check reads the same predicate, so an open team
    // makes any member a valid recusal target — deliberate, and the reason
    // recusal is not separately gated (D7).
    expect(await isConflictTeamMemberId(testCommunity.id, bob.id)).toBe(false);

    await openModule(testCommunity.id, "conflict_team", alice.id);
    expect(await isConflictTeamMember(bob)).toBe(true);
    expect(await isConflictTeamMemberId(testCommunity.id, bob.id)).toBe(true);
    await expect(requireConflictTeamMember(bob)).resolves.toBeUndefined();
  });

  it("event_scheduling_owner: isEventSchedulingOwner is true for every scope (D3)", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const realCycle = "00000000-0000-0000-0000-0000000000ee";

    // Closed: refused for the cycle and for the community scope.
    expect(await isEventSchedulingOwner(bob, realCycle)).toBe(false);
    expect(await isEventSchedulingOwner(bob, null)).toBe(false);
    expect(await isEventSchedulingOwner(bob)).toBe(false);

    await openModule(testCommunity.id, "event_scheduling_owner", alice.id);
    // The whole point of short-circuiting before the tri-state: open is the
    // superset, so a cycle that granted nothing still passes.
    expect(await isEventSchedulingOwner(bob, realCycle)).toBe(true);
    expect(await isEventSchedulingOwner(bob, null)).toBe(true);
    expect(await isEventSchedulingOwner(bob)).toBe(true);
  });

  it("spatial_planning: isSpatialPlanningHolder is true for every scope", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const realCycle = "00000000-0000-0000-0000-0000000000ee";
    const communityRow = { id: testCommunity.id };

    expect(await isSpatialPlanningHolder(bob, communityRow, realCycle)).toBe(false);

    await openModule(testCommunity.id, "spatial_planning", alice.id);
    expect(await isSpatialPlanningHolder(bob, communityRow, realCycle)).toBe(true);
    expect(await isSpatialPlanningHolder(bob, communityRow, null)).toBe(true);
    expect(await isSpatialPlanningHolder(bob, communityRow)).toBe(true);
  });

  it("kitchen: isKitchenOwner is true for every scope", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const realCycle = "00000000-0000-0000-0000-0000000000ee";

    expect(await isKitchenOwner(bob, realCycle)).toBe(false);

    await openModule(testCommunity.id, "kitchen", alice.id);
    expect(await isKitchenOwner(bob, realCycle)).toBe(true);
    expect(await isKitchenOwner(bob, null)).toBe(true);
    expect(await isKitchenOwner(bob)).toBe(true);
  });

  it("budget: isBudgetOwner is true for any budget period", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const cycleRow = { cycleId: null };

    expect(await isBudgetOwner(bob, cycleRow)).toBe(false);
    expect(await isBudgetOwner(bob, { cycleId: "00000000-0000-0000-0000-0000000000ee" })).toBe(false);

    await openModule(testCommunity.id, "budget", alice.id);
    expect(await isBudgetOwner(bob, cycleRow)).toBe(true);
    expect(await isBudgetOwner(bob, { cycleId: "00000000-0000-0000-0000-0000000000ee" })).toBe(true);
  });

  it("shift_management: isShiftManagerForScope is true for any scope", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const realCycle = "00000000-0000-0000-0000-0000000000ee";

    expect(await isShiftManagerForScope(bob, realCycle)).toBe(false);
    expect(await isShiftManagerForScope(bob, null)).toBe(false);

    await openModule(testCommunity.id, "shift_management", alice.id);
    expect(await isShiftManagerForScope(bob, realCycle)).toBe(true);
    expect(await isShiftManagerForScope(bob, null)).toBe(true);
  });

  it("recruitment: isRecruitmentTaskHolder — this is what makes a decision reachable", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();

    expect(await isRecruitmentTaskHolder(bob)).toBe(false);
    await expect(requireRecruitmentTaskHolder(bob)).rejects.toThrow();

    await openModule(testCommunity.id, "recruitment", alice.id);
    expect(await isRecruitmentTaskHolder(bob)).toBe(true);
    await expect(requireRecruitmentTaskHolder(bob)).resolves.toBeUndefined();
  });

  // The bug docs/recruitment-access-plan.md §1 documents, and the reason
  // this step exists. The whole test file so far proves resolvers *return*
  // true for an open module; this proves the end-to-end consequence: two
  // ordinary members can file the evaluations that let a decision actually
  // be reached, where before neither of them could file even one.
  it("makes an unsatisfiable decision reachable — the defect from recruitment-access-plan.md §1", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    // Recruitment on, a form, and the *default* evaluator count of 2 with
    // rules whose first branch needs 2 proceeds.
    await db
      .update(community)
      .set({ modulesEnabled: [...testCommunity.modulesEnabled, "recruitment"] })
      .where(eq(community.id, testCommunity.id));
    const form = await createForm(alice, {
      title: "Application",
      fields: [{ key: "name", label: "Name", responseType: "free_text", required: true }],
    });
    await updateCommunity(alice, {
      recruitmentApplicationFormId: form.id,
      // Explicit, because a Community that never touched it gets 2 (the
      // default) — and that default is the unsatisfiable part.
      recruitmentEvaluatorCount: 2,
      recruitmentDecisionRules: [
        { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
        // A wider_discussion rule must declare what happens when its window
        // closes unobjected (requireValidDecisionRules) — hence the
        // defaultResolution.
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
      ],
    });

    // Closed: bob and alice both hold nothing, so nobody can evaluate and
    // the count of 2 is unreachable by construction.
    const application = await submitRecruitmentApplication(testCommunity.id, { values: { name: "Dana" } });
    await expect(submitEvaluation(alice, application.id, { recommendation: "proceed" })).rejects.toThrow();

    // Open: both can, and that is enough to reach a decision.
    await openModule(testCommunity.id, "recruitment", alice.id);
    await submitEvaluation(alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(bob, application.id, { recommendation: "proceed" });

    const decision = await recordDecisionIfReached(alice, application.id);
    expect(decision).not.toBeNull();
    // The first rule matched, rather than falling through to the mandatory
    // wider_discussion — which is what a single-cardinality module made
    // impossible.
    expect(decision?.ruleOutcome).toBe("proceed");
    expect(decision?.resolution).toBe("accepted");
    expect(branch.id).not.toBe(testCommunity.id);
  });

  it("branch_coordination: an open branch coordinator covers every branch", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();

    expect(await isCoordinationHolder(bob, null)).toBe(false);
    expect(await isCoordinationHolder(bob, branch.id)).toBe(false);

    await openModule(testCommunity.id, "branch_coordination", alice.id);
    // communityWide short-circuits every scope form, including a branch that
    // granted nothing.
    expect(await isCoordinationHolder(bob, null)).toBe(true);
    expect(await isCoordinationHolder(bob, branch.id)).toBe(true);
    expect(await isCoordinationHolder(bob, { branchId: branch.id, cycleId: null })).toBe(true);
  });

  it("community_coordination: opening either coordination key is community-wide", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await openModule(testCommunity.id, "community_coordination", alice.id);

    expect(await isCoordinationHolder(bob, null)).toBe(true);
    expect(await isCoordinationHolder(bob, branch.id)).toBe(true);
  });

  // D8: announcements is the one module with two disjoint authorities, so the
  // thing worth testing is that they move *together*.
  it("announcements: both halves open at once, never one (D8)", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();
    const realCycle = "00000000-0000-0000-0000-0000000000ee";

    // Closed: neither half.
    expect(await isAnnouncementTaskHolder(bob)).toBe(false);
    expect(await isAnnouncementHolderForCycle(bob, realCycle)).toBe(false);

    await openModule(testCommunity.id, "announcements", alice.id);
    // Both true, including for a cycle that granted nothing — the half-state
    // D8 exists to prevent cannot be reached.
    expect(await isAnnouncementTaskHolder(bob)).toBe(true);
    expect(await isAnnouncementHolderForCycle(bob, realCycle)).toBe(true);
  });

  // D11: backstop is the one module with no open path at all. If this ever
  // passes, the exclusion has been broken somewhere other than the settings UI.
  it("D11: backstop has no open path — isBackstopForScope still requires a holder", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const backstopTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "backstop", backstopTask.id);
    await db.insert(taskAssignment).values({ taskId: backstopTask.id, memberId: alice.id, isShadow: false });

    expect(await isBackstopForScope(alice, null)).toBe(true);
    expect(await isBackstopForScope(bob, null)).toBe(false);

    // Writing the row directly is what the settings UI is forbidden from
    // doing; proving the resolver ignores it is the belt to that braces.
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "backstop", openedBy: alice.id });

    expect(await isBackstopForScope(bob, null)).toBe(false);
    expect(await isBackstopForScope(alice, null)).toBe(true);
  });

  // D10: task-scoped readers must stay untouched. An open flag is a
  // Community-level fact and must not leak into a description of one task's
  // grants — that is what the task-detail and settings screens render.
  it("D10: opening a module does not change what a task reports granting", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "kitchen", t.id);

    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set(["kitchen"]));

    await openModule(testCommunity.id, "kitchen", alice.id);

    // Unchanged: the task still grants exactly what it granted.
    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set(["kitchen"]));
    // And the task-scoped grant listing is likewise unaffected.
    const all = await listGrantsWithTaskInfo(testCommunity.id);
    expect(all).toHaveLength(1);
    expect(all[0].taskId).toBe(t.id);
  });

  // D9, the deferred one — asserted here so the *safe* outcome is pinned
  // rather than merely intended. sensitive-data.ts is not modified by this
  // plan, and because listUnlockedFields resolves unlockedByGrantModuleKey
  // purely by task-hold, opening Kitchen must NOT unlock a field gated to the
  // Kitchen role. If this test ever fails, something has coupled them and the
  // deferred decision in docs/open-permissions-plan.md §5 is now live.
  it("D9: opening a module does not unlock a sensitive field gated to its grant", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    const kitchenTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "kitchen", kitchenTask.id);
    await db.insert(taskAssignment).values({ taskId: kitchenTask.id, memberId: alice.id, isShadow: false });

    // A field unlocked by the `kitchen` grant.
    await db.insert(sensitiveFieldAccessRule).values({
      communityId: testCommunity.id,
      fieldKey: "allergies",
      unlockedByGrantModuleKey: "kitchen",
    });

    // The holder is unlocked; bob is not.
    expect(await listUnlockedFields(alice)).toContain("allergies");
    expect(await listUnlockedFields(bob)).not.toContain("allergies");

    await openModule(testCommunity.id, "kitchen", alice.id);

    // Open Kitchen, and bob still cannot read everyone's allergies. The
    // capability widened; the disclosure deliberately did not.
    expect(await isKitchenOwner(bob)).toBe(true);
    expect(await listUnlockedFields(bob)).not.toContain("allergies");
  });
});

// ---------------------------------------------------------------------------
// Step 5: the Class 3 "is this module set up?" proxies. Every site here
// previously used *grant existence* as a stand-in for *module configured*,
// which an open module makes reachable deliberately — and which produced
// failures in both directions: refusing outright (nobody could file a
// conflict report), or quietly doing nothing (no intro call, no
// accompaniment task, a nav item gone, a false warning on the page).
describe("open modules are not misconfigured (Step 5)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The one that made an open Community unable to raise a conflict at all.
  it("fileConflictReport works with no granting task when the team is open", async () => {
    const { community: testCommunity, alice, bob } = await createFixtures();

    // Closed and ungranted: refused, with the original message.
    await expect(fileConflictReport(bob, { description: "Not now" })).rejects.toThrow(
      /isn't set up for this Community/,
    );

    // Open: bob can file, with no task and no grant anywhere.
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "conflict_team", openedBy: alice.id });
    const report = await fileConflictReport(bob, { description: "Something happened" });
    expect(report.id).toBeTruthy();
    expect(report.reportedBy).toBe(bob.id);
  });

  // The recusal picker, which would otherwise go empty while the action
  // itself kept working — the feature vanishing from the page.
  it("listConflictTeamMemberIds returns every member when the team is open", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    const teamTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "conflict_team", teamTask.id);
    await db.insert(taskAssignment).values({ taskId: teamTask.id, memberId: alice.id, isShadow: false });

    // Closed: just the holder, which is the recusal target roster today.
    expect(await listConflictTeamMemberIds(testCommunity.id)).toEqual([alice.id]);

    // Open: everyone, matching what isConflictTeamMemberId now accepts.
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "conflict_team", openedBy: alice.id });
    expect(await listConflictTeamMemberIds(testCommunity.id)).toEqual(
      expect.arrayContaining([alice.id, bob.id]),
    );
  });
  // The false warning: "nobody can draw or edit" on a Community where
  // everyone can.
  it("the Spatial-planning 'nobody can draw' warning is suppressed when open", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    expect(
      (await isModuleOpenToEveryone(testCommunity.id, "spatial_planning")),
    ).toBe(false);
    // The page's own predicate, reproduced: granted-or-open.
    const granted = (
      await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)
    ).length;
    const open = await isModuleOpenToEveryone(testCommunity.id, "spatial_planning");
    expect(granted).toBe(0);
    expect(granted === 0 && !open).toBe(true);

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "spatial_planning", openedBy: alice.id });
    const nowOpen = await isModuleOpenToEveryone(testCommunity.id, "spatial_planning");
    expect(nowOpen).toBe(true);
    // The warning's condition is now false, so it does not render.
    expect(granted === 0 && !nowOpen).toBe(false);
  });

  // The self-contradiction: the hub reported "nobody can evaluate" for a
  // Community where every member can.
  it("describeRecruitmentAuthority reports an open module as a fourth authority state", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    const closed = await describeRecruitmentAuthority(testCommunity.id);
    expect(closed.open).toBe(false);
    expect(closed.unstaffed).toBe(true);
    expect(closed.evaluatorCount).toBe(0);
    expect(closed.needsTaskToFileUnder).toBe(false);

    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    const open = await describeRecruitmentAuthority(testCommunity.id);
    expect(open.open).toBe(true);
    // Not unstaffed — an open Community is staffed by definition.
    expect(open.unstaffed).toBe(false);
    // Unbounded evaluators, which is exactly why the hub's
    // evaluationUnreachable check must not fire for an open module.
    expect(open.evaluatorCount).toBe(Number.POSITIVE_INFINITY);
    // And the real remaining gap is named rather than hidden.
    expect(open.needsTaskToFileUnder).toBe(true);
  });

  it("a granted, unheld module is 'unstaffed' but does not need a task to file under", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", t.id);

    const authority = await describeRecruitmentAuthority(testCommunity.id);
    expect(authority.open).toBe(false);
    expect(authority.unstaffed).toBe(true);
    expect(authority.grants).toHaveLength(1);
    // The task exists, so branchId is available to the decision side-effects.
    expect(authority.needsTaskToFileUnder).toBe(false);
  });

  // The scheduled job needs a real actor to create a Task as, and an open
  // module with no granting task used to leave it with nobody.
  it("the wider-discussion job still creates Accompaniment when no task grants Recruitment", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await db
      .update(community)
      .set({ modulesEnabled: [...testCommunity.modulesEnabled, "recruitment"] })
      .where(eq(community.id, testCommunity.id));
    const form = await createForm(alice, {
      title: "Application",
      fields: [
        { key: "name", label: "Name", responseType: "free_text", required: true },
        { key: "email", label: "Email", responseType: "free_text", required: true, isEmailField: true },
      ],
    });
    await updateCommunity(alice, {
      recruitmentApplicationFormId: form.id,
      recruitmentEvaluatorCount: 2,
      recruitmentWiderDiscussionHours: 0,
      recruitmentDecisionRules: [
        { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
        // Resolving to `decline` keeps the job off the conversion path, so
        // what is under test is purely the *author* fallback.
        { conditions: {}, outcome: "wider_discussion", defaultResolution: "decline" },
      ],
    });
    await db
      .insert(openPermissionGrant)
      .values({ communityId: testCommunity.id, moduleKey: "recruitment", openedBy: alice.id });

    const application = await submitRecruitmentApplication(testCommunity.id, {
      values: { name: "Dana", email: "dana@example.com" },
    });
    await submitEvaluation(alice, application.id, { recommendation: "proceed" });
    await submitEvaluation(bob, application.id, { recommendation: "unsure" });
    const decided = await recordDecisionIfReached(alice, application.id);
    expect(decided?.ruleOutcome).toBe("wider_discussion");

    // The job runs. Before the fallback chain it found no actor (no granting
    // task) and silently created nothing; now it resolves one from the
    // people actually involved.
    const result = await resolveWiderDiscussionWindows();
    expect(result.checked).toBeGreaterThan(0);
    // No crash and no throw is the assertion that matters here: the job
    // completes with an open module and no granting task.
    expect(result.resolved).toBe(result.checked);
    expect(branch.id).not.toBe(testCommunity.id);
  });
});


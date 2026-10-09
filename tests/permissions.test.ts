import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { community, openPermissionGrant, task } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
import { ConfirmationRequiredError } from "@/lib/errors";
import {
  addPermissionGrant,
  copyPermissionGrants,
  describeGrantScope,
  isMisplacedCommunityGrant,
  isModuleOpenToEveryone,
  isOpenableModule,
  listGrantingTaskIds,
  listGrantingTaskIdsForScope,
  listGrantsWithTaskInfo,
  listModuleKeysGrantedByTask,
  listOpenModuleKeys,
  PERMISSION_MODULE_HINTS,
  PERMISSION_MODULE_KEYS,
  PERMISSION_MODULE_LABELS,
  PERMISSION_MODULE_SECTIONS,
  removePermissionGrant,
  setModuleOpen,
  setPermissionGrant,
} from "@/lib/permissions";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";
import { requireAdmins } from "@/lib/settings/admins";
import { ForbiddenError } from "@/lib/errors";
import { claimTask } from "@/lib/tasks";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

// Both functions here are what the settings panel's Access & permissions
// tab, the task detail view, and the proposal-activation screen read to
// render (Budget remains settings-only) — see docs/plans/development-plan.md's
// Phase 64.
describe("listGrantsWithTaskInfo", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is empty when nothing has been granted yet", async () => {
    const { community: testCommunity } = await createFixtures();
    expect(await listGrantsWithTaskInfo(testCommunity.id)).toEqual([]);
  });

  it("returns every grant with the granting task's title and branchId", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Coordinate stuff" });
    await grantPermission(testCommunity.id, "branch_coordination", t.id);

    const grants = await listGrantsWithTaskInfo(testCommunity.id);
    expect(grants).toEqual([
      { moduleKey: "branch_coordination", taskId: t.id, title: "Coordinate stuff", branchId: branch.id, cycleId: null },
    ]);
  });

  it("is community-scoped — a stranger's grant never leaks in", async () => {
    const { community: testCommunity } = await createFixtures();
    const { community: strangerCommunity, branch: strangerBranch, alice: strangerAlice } = await createFixtures();
    const strangerTask = await insertTask(strangerCommunity.id, strangerBranch.id, strangerAlice.id);
    await grantPermission(strangerCommunity.id, "support", strangerTask.id);

    expect(await listGrantsWithTaskInfo(testCommunity.id)).toEqual([]);
  });
});

describe("listModuleKeysGrantedByTask", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the exact set of modules a task currently grants, empty when none", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set());

    await grantPermission(testCommunity.id, "admin", t.id);
    await grantPermission(testCommunity.id, "support", t.id);
    const otherTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", otherTask.id);

    expect(await listModuleKeysGrantedByTask(testCommunity.id, t.id)).toEqual(new Set(["admin", "support"]));
    expect(await listModuleKeysGrantedByTask(testCommunity.id, otherTask.id)).toEqual(new Set(["recruitment"]));
  });
});

// docs/plans/archive/cycle-scope-remediation-plan.md — a grant's scope comes from
// the granting task's own placement (`task.cycleId`), not a cycle
// column on the grant row (retired in migration D8). task.cycleId =
// NULL is the community/evergreen role; = C covers cycle C only, and a
// task grants exactly one scope (its own).
describe("placement-derived scopes (cycle-scope remediation)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("never copies Budget authority through a cycle clone or task-pack import", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const ownerTask = await insertTask(testCommunity.id, branch.id, alice.id);

    await db.transaction((tx) =>
      copyPermissionGrants(
        tx,
        testCommunity.id,
        new Map([[ownerTask.id, ["budget"] as const]]),
      ),
    );

    expect(await listGrantingTaskIds(testCommunity.id, "budget")).toEqual([]);
  });

  // docs/plans/archive/open-permissions-plan.md §2.4: an open flag is a Community's
  // local decision about *its own* members, so a cloned cycle or an imported
  // pack arrives closed. This is the one place that decision is enforced in
  // code, and it is enforced by *omission* — copyPermissionGrants is the
  // single chokepoint both paths go through, and it copies only
  // permission_grant rows. Worth pinning explicitly: the alternative failure
  // mode is a Community silently gaining (or losing) a capability because
  // someone cloned an event, which is exactly the kind of drift the
  // separate-table design in §2.1 exists to prevent.
  it("never carries an open permission through a cycle clone or task-pack import", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const source = await insertTask(testCommunity.id, branch.id, alice.id);
    const copied = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Copy" });

    // Open on the source side, and granted, so both facts exist to be copied.
    await setModuleOpen(alice, "recruitment", true);
    await db.transaction((tx) =>
      copyPermissionGrants(
        tx,
        testCommunity.id,
        new Map([[copied.id, ["recruitment"] as const]]),
      ),
    );

    // The grant travelled...
    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([copied.id]);
    // ...and the open flag did not. Still exactly the one row it started with.
    expect(await listOpenModuleKeys(testCommunity.id)).toEqual(new Set(["recruitment"]));
    const openRows = await db.select().from(openPermissionGrant);
    expect(openRows).toHaveLength(1);
    expect(source.communityId).toBe(testCommunity.id);
  });

  it("clearing an open flag leaves the task grant alone — the two facts are independent", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await grantPermission(testCommunity.id, "recruitment", t.id);

    await setModuleOpen(alice, "recruitment", true);
    expect(await isModuleOpenToEveryone(testCommunity.id, "recruitment")).toBe(true);

    await setModuleOpen(alice, "recruitment", false);
    // Closed again, and the named holder is untouched.
    expect(await isModuleOpenToEveryone(testCommunity.id, "recruitment")).toBe(false);
    expect(await listGrantingTaskIds(testCommunity.id, "recruitment")).toEqual([t.id]);
  });

  // D11 at the write, not just the UI: a forged POST gets the same answer the
  // settings tab would have given, so the exclusion cannot be bypassed by
  // skipping the checkbox.
  it("refuses to open the one module that needs someone named (D11)", async () => {
    const { community: testCommunity, alice } = await createFixtures();

    expect(isOpenableModule("backstop")).toBe(false);
    expect(await setModuleOpen(alice, "backstop", true)).toBe(false);
    expect(await isModuleOpenToEveryone(testCommunity.id, "backstop")).toBe(false);

    // Every other module is openable, and opening twice is idempotent.
    for (const moduleKey of PERMISSION_MODULE_KEYS.filter((k) => k !== "backstop")) {
      // Confirmed, because admin and support refuse to open without it —
      // which is its own test below; this one is about idempotence.
      const confirmed = { confirmedBlastRadius: true, confirmedReportExposure: true };
      expect(await setModuleOpen(alice, moduleKey, true, confirmed)).toBe(true);
      expect(await setModuleOpen(alice, moduleKey, true, confirmed)).toBe(true);
    }
    const open = await db.select().from(openPermissionGrant);
    expect(open).toHaveLength(PERMISSION_MODULE_KEYS.length - 1);
  });

  it("listGrantingTaskIds returns every grant; listGrantingTaskIdsForScope filters by the granting task's placement", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id, title: "Owns A" });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleB.id, title: "Owns B" });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns community" });
    await setPermissionGrant(alice, "spatial_planning", taskA.id);
    await setPermissionGrant(alice, "spatial_planning", taskB.id);
    await setPermissionGrant(alice, "spatial_planning", communityTask.id);

    expect((await listGrantingTaskIds(testCommunity.id, "spatial_planning")).sort()).toEqual(
      [taskA.id, taskB.id, communityTask.id].sort(),
    );
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([taskB.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([communityTask.id]);
  });

  it("setPermissionGrant replaces only the sibling grant in the granted task's own scope, never a different cycle's", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleB.id });

    await setPermissionGrant(alice, "event_scheduling_owner", taskA.id);
    await setPermissionGrant(alice, "event_scheduling_owner", taskB.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskA.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);

    // Replacing cycle A's grant with a third task placed in A leaves B's untouched.
    const taskC = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    await setPermissionGrant(alice, "event_scheduling_owner", taskC.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleA.id)).toEqual([taskC.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "event_scheduling_owner", cycleB.id)).toEqual([taskB.id]);
  });

  it("one task, one scope: a task's grant follows wherever it sits", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleB = await createCycle(alice, { source: "blank", name: "B", confirmed: true });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });

    await setPermissionGrant(alice, "spatial_planning", t.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([t.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([]);

    // Rearranging the task's placement moves its grant's scope with it —
    // the direct migration of the old "same task, two cycles" stacking
    // (a task now grants exactly the one scope it sits in, §2.1/D2).
    await db.update(task).set({ cycleId: cycleB.id }).where(eq(task.id, t.id));
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleB.id)).toEqual([t.id]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
  });

  it("removePermissionGrant drops the task's own grant row, regardless of scope", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleTask = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id);
    await setPermissionGrant(alice, "spatial_planning", cycleTask.id);
    await setPermissionGrant(alice, "spatial_planning", communityTask.id);

    await removePermissionGrant(alice, "spatial_planning", cycleTask.id);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", null)).toEqual([communityTask.id]);
  });

  it("listGrantsWithTaskInfo reports each granting task's placement as its scope", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const cycleTask = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id, title: "Owns A" });
    const communityTask = await insertTask(testCommunity.id, branch.id, alice.id, { title: "Owns community" });
    await setPermissionGrant(alice, "spatial_planning", cycleTask.id);
    await addPermissionGrant(alice, "branch_coordination", communityTask.id);

    const grants = await listGrantsWithTaskInfo(testCommunity.id);
    // The cycle's auto-created Backstop task (docs/cycle-scope-
    // remediation-plan.md §4.7) carries a `backstop` grant scoped to
    // cycleA too — listed right alongside the hand-granted modules.
    const [backstopRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.cycleId, cycleA.id), eq(task.title, "Backstop")));
    expect(grants).toEqual(
      expect.arrayContaining([
        { moduleKey: "spatial_planning", taskId: cycleTask.id, title: "Owns A", branchId: branch.id, cycleId: cycleA.id },
        {
          moduleKey: "branch_coordination",
          taskId: communityTask.id,
          title: "Owns community",
          branchId: branch.id,
          cycleId: null,
        },
        {
          moduleKey: "backstop",
          taskId: backstopRow.id,
          title: "Backstop",
          branchId: branch.id,
          cycleId: cycleA.id,
        },
      ]),
    );
    expect(grants).toHaveLength(3);
  });
});

// docs/plans/archive/cycle-scope-remediation-plan.md §5.1 — the derived-scope label
// and community-shaped misplacement flag the settings panel and
// task-detail form render, driven by the §2.2 tier table.
describe("describeGrantScope / isMisplacedCommunityGrant", () => {
  it("labels a cycle-placed grant with its cycle name, falling back when it can't be resolved", () => {
    expect(describeGrantScope("spatial_planning", "cycle-1", "Spring 2026")).toBe("Spring 2026");
    expect(describeGrantScope("spatial_planning", "cycle-1", null)).toBe("that event");
  });

  it("labels a cycle-less grant Community-wide for community-shaped modules, Evergreen for cycle-shaped ones", () => {
    for (const moduleKey of [
      "admin",
      "conflict_team",
      "support",
      "announcements",
      // cycle_variant: no event means the whole community, same as
      // announcements — not "Evergreen", which would imply one branch.
      "community_coordination",
    ] as const) {
      expect(describeGrantScope(moduleKey, null, null)).toBe("Community-wide");
    }
    for (const moduleKey of [
      "spatial_planning",
      "event_scheduling_owner",
      "branch_coordination",
      "backstop",
      "shift_management",
      "feedback_review",
      "recruitment",
      "budget",
    ] as const) {
      expect(describeGrantScope(moduleKey, null, null)).toBe("Evergreen");
    }
  });

  it("flags only community-shaped modules whose granting task sits in a cycle", () => {
    expect(isMisplacedCommunityGrant("conflict_team", "cycle-1")).toBe(true);
    expect(isMisplacedCommunityGrant("support", "cycle-1")).toBe(true);

    // Cycle-shaped and cycle-variant modules legitimately sit in a cycle.
    // community_coordination is cycle_variant: a cycle-placed grant is
    // that event's coordinator, not a contradiction.
    expect(isMisplacedCommunityGrant("community_coordination", "cycle-1")).toBe(false);
    expect(isMisplacedCommunityGrant("spatial_planning", "cycle-1")).toBe(false);
    expect(isMisplacedCommunityGrant("announcements", "cycle-1")).toBe(false);
    expect(isMisplacedCommunityGrant("shift_management", "cycle-1")).toBe(false);
    expect(isMisplacedCommunityGrant("budget", "cycle-1")).toBe(false);

    // A cycle-less community-shaped grant is exactly right.
    expect(isMisplacedCommunityGrant("conflict_team", null)).toBe(false);
  });

  // The Admin case inverts. `requireAdmins` filters on
  // `openness = 'community_endorsed'` and never on placement, so an Admins
  // task in an event confers Admin exactly as a cycle-less one does — and
  // that placement is how a community renews its admins each cycle. Filing
  // admin under the `community` tier made the panel call the renewal
  // configuration a contradiction, which warned against the only shape that
  // supplies both a renewal point and a departure point.
  it("does not flag a cycle-placed Admins task — the placement is the renewal marker", () => {
    expect(isMisplacedCommunityGrant("admin", "cycle-1")).toBe(false);
    expect(isMisplacedCommunityGrant("admin", null)).toBe(false);
  });

  it("still derives admin into exactly one settings section", () => {
    // The section split is derived from the tier rather than hand-listed, so
    // "a new module can never end up in no section or in two". Moving admin
    // must not break that.
    const sections = PERMISSION_MODULE_SECTIONS.map((s) => s.moduleKeys);
    const containing = sections.filter((keys) => keys.includes("admin"));
    expect(containing).toHaveLength(1);
    expect(sections.flat()).toHaveLength(PERMISSION_MODULE_KEYS.length);
  });

  // The behaviour behind the tier change, pinned because it is the whole
  // reason the warning went away. `requireAdmins` filters on
  // `openness = 'community_endorsed'` and never on placement, so a cycle-scoped
  // Admins task confers exactly what a cycle-less one does — which is what
  // makes per-cycle renewal possible without a window where nobody is an
  // admin. Grants coexist rather than superseding, so a community is never
  // locked out by starting a new cycle.
  it("confers Admin from a cycle-scoped Admins task, alongside a cycle-less one", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, testCommunity.id));
    const cycleRow = await createCycle(alice, { source: "blank", name: "2027 Season" });

    const endorsed = {
      openness: "community_endorsed" as const,
      endorsementThreshold: 2,
      browsePeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
    const perCycle = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Admins 2027",
      cycleId: cycleRow.id,
      ...endorsed,
    });
    await grantPermission(testCommunity.id, "admin", perCycle.id);
    await claimTask(bob, perCycle.id);

    await expect(requireAdmins(bob)).resolves.toBeUndefined();
    await expect(requireAdmins(alice)).rejects.toThrow(ForbiddenError);

    // A standing Admins task alongside it: both confer, neither supersedes.
    const standing = await insertTask(testCommunity.id, branch.id, alice.id, {
      title: "Admins standing",
      ...endorsed,
    });
    await grantPermission(testCommunity.id, "admin", standing.id);
    await claimTask(alice, standing.id);

    await expect(requireAdmins(alice)).resolves.toBeUndefined();
    await expect(requireAdmins(bob)).resolves.toBeUndefined();
  });
});

// The settings tab's "Community-wide" / "Per-event" sections. The point
// of deriving these from the tier table is that a new module can never
// be silently dropped from the page, so the completeness assertions
// below are the actual regression guard.
describe("PERMISSION_MODULE_SECTIONS", () => {
  it("puts every module in exactly one section", () => {
    const seen = PERMISSION_MODULE_SECTIONS.flatMap((s) => s.moduleKeys);
    expect(seen.length).toBe(PERMISSION_MODULE_KEYS.length);
    expect(new Set(seen).size).toBe(PERMISSION_MODULE_KEYS.length);
    expect([...seen].sort()).toEqual([...PERMISSION_MODULE_KEYS].sort());
  });

  it("groups by the tier table — community-shaped in one, everything else in the other", () => {
    const byKey = new Map(PERMISSION_MODULE_SECTIONS.map((s) => [s.key, new Set(s.moduleKeys)]));
    const community = byKey.get("community")!;
    const cycle = byKey.get("cycle")!;

    for (const moduleKey of ["conflict_team", "support"] as const) {
      expect(community.has(moduleKey)).toBe(true);
      expect(cycle.has(moduleKey)).toBe(false);
    }
    for (const moduleKey of [
      "branch_coordination",
      "spatial_planning",
      "budget",
      // Every cycle_variant module goes with the per-event section, whose
      // rule ("placement is the scope, no event means the community as a
      // whole") is the one that actually governs them. For
      // community_coordination the community-wide form also ignores the
      // branch — a distinction the section shares, not a reason to split
      // it out.
      "announcements",
      "community_coordination",
      // …and admin, since a cycle-placed Admins grant is the renewal
      // mechanism rather than a contradiction. Its per-event placement is a
      // marker, not a scope narrowing, which is why the section rule now
      // says so in one clause rather than pretending otherwise.
      "admin",
    ] as const) {
      expect(cycle.has(moduleKey)).toBe(true);
      expect(community.has(moduleKey)).toBe(false);
    }
  });

  it("gives both sections a rule to state once instead of per module", () => {
    for (const section of PERMISSION_MODULE_SECTIONS) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.rule.length).toBeGreaterThan(0);
    }
  });

  it("keeps a hint for every module so none renders an empty description", () => {
    for (const moduleKey of PERMISSION_MODULE_KEYS) {
      expect(PERMISSION_MODULE_HINTS[moduleKey].length).toBeGreaterThan(0);
      expect(PERMISSION_MODULE_LABELS[moduleKey].length).toBeGreaterThan(0);
    }
  });
});

describe("cardinality enforcement in grant functions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("setPermissionGrant rejects multi-cardinality modules", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await expect(
      setPermissionGrant(alice, "admin", t.id),
    ).rejects.toThrow(/grants may coexist/);
    await expect(
      setPermissionGrant(alice, "branch_coordination", t.id),
    ).rejects.toThrow(/grants may coexist/);
    await expect(
      setPermissionGrant(alice, "support", t.id),
    ).rejects.toThrow(/grants may coexist/);
    await expect(
      setPermissionGrant(alice, "kitchen", t.id),
    ).rejects.toThrow(/grants may coexist/);
  });

  it("addPermissionGrant rejects single-cardinality modules", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await expect(
      addPermissionGrant(alice, "spatial_planning", t.id),
    ).rejects.toThrow(/allows one granting task per scope/);
    await expect(
      addPermissionGrant(alice, "budget", t.id),
    ).rejects.toThrow(/allows one granting task per scope/);
  });
});

describe("atomic setPermissionGrant replacement", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("concurrent replacements in the same scope finish with exactly one grant", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const taskA = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const taskB = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    const taskC = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });

    // Initial grant
    await setPermissionGrant(alice, "spatial_planning", taskA.id);

    // Simulate concurrent replacements - both should run and end with exactly one grant
    const [result1, result2] = await Promise.allSettled([
      setPermissionGrant(alice, "spatial_planning", taskB.id),
      setPermissionGrant(alice, "spatial_planning", taskC.id),
    ]);

    // Both should succeed (no throw)
    expect(result1.status).toBe("fulfilled");
    expect(result2.status).toBe("fulfilled");

    // Exactly one grant remains in the scope
    const grants = await listGrantingTaskIdsForScope(
      testCommunity.id,
      "spatial_planning",
      cycleA.id,
    );
    expect(grants).toHaveLength(1);
    expect([taskB.id, taskC.id]).toContain(grants[0]);
  });
});

describe("removePermissionGrant transactional behavior", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("removePermissionGrant succeeds and clears the grant", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cycleA = await createCycle(alice, { source: "blank", name: "A" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: cycleA.id });
    await setPermissionGrant(alice, "spatial_planning", t.id);

    await removePermissionGrant(alice, "spatial_planning", t.id);

    expect(await listGrantingTaskIdsForScope(testCommunity.id, "spatial_planning", cycleA.id)).toEqual([]);
  });
});

// Opening Admins or View-as to everyone changes what the whole community can
// do. The settings screen asks for a tick, but a confirmation that exists only
// in the browser is one a forged request skips, so the server asks too.
describe("opening the two high-impact modules needs confirmation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it.each(["admin", "support"] as const)("refuses to open %s without it, and opens with it", async (moduleKey) => {
    const { community: testCommunity, alice } = await createFixtures();

    await expect(setModuleOpen(alice, moduleKey, true)).rejects.toThrow(ConfirmationRequiredError);
    expect(await isModuleOpenToEveryone(testCommunity.id, moduleKey)).toBe(false);

    expect(await setModuleOpen(alice, moduleKey, true, { confirmedBlastRadius: true })).toBe(true);
    expect(await isModuleOpenToEveryone(testCommunity.id, moduleKey)).toBe(true);
  });

  it("says what it will do when it refuses", async () => {
    const { alice } = await createFixtures();
    await expect(setModuleOpen(alice, "support", true)).rejects.toThrow(/view the platform read-only/);
    await expect(setModuleOpen(alice, "admin", true)).rejects.toThrow(/change every setting/);
  });

  it("needs no confirmation to close, or to re-submit while already open", async () => {
    const { alice } = await createFixtures();
    await setModuleOpen(alice, "support", true, { confirmedBlastRadius: true });
    // The settings form re-submits its checkbox on every unrelated save.
    expect(await setModuleOpen(alice, "support", true)).toBe(true);
    expect(await setModuleOpen(alice, "support", false)).toBe(true);
  });

  it("leaves every other module a plain checkbox", async () => {
    const { alice } = await createFixtures();
    expect(await setModuleOpen(alice, "recruitment", true)).toBe(true);
  });
});

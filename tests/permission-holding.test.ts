import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, permissionHolding, taskAssignment } from "@/db/schema";
import { claimAsShadow, claimTask, releaseTask } from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { isKitchenOwner } from "@/lib/kitchen";
import { removePermissionGrant, setModuleOpen } from "@/lib/permissions";
import {
  listDataUnlockingModules,
  listPermissionHolds,
  listShortPermissionHolds,
} from "@/lib/permission-holds";
import {
  createFixtures,
  createRestrictedQuestion,
  grantPermission,
  insertTask,
  resetDatabase,
} from "./helpers";

// permission_grant records authority as configured; this records authority
// as acquired. The gap the table closes is that task_assignment rows are
// deleted outright on release, so before it "who held Kitchen, and for how
// long" had no answer at all — and a claim is the moment authority is
// acquired, which for both task-keyed routes in sensitive-data.ts's
// satisfiedRuleIds *is* the access.
//
// These tests assert the shape of that record rather than any behaviour,
// because the shape is where the guarantees are: an episode that survives
// its release, a snapshot that outlives the grant it recorded, and a table
// that never becomes a second authority path.

async function holdings() {
  return db.select().from(permissionHolding);
}

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

describe("permission_holding — a claim on a granted task", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records the holder, the task, and what the task was worth", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Kitchen lead" });
    await grantPermission(c.id, "kitchen", t.id);

    await claimTask(alice, t.id);

    const rows = await holdings();
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(alice.id);
    expect(rows[0].communityId).toBe(c.id);
    expect(rows[0].taskId).toBe(t.id);
    expect(rows[0].taskTitle).toBe("Kitchen lead");
    expect(rows[0].moduleKeys).toEqual(["kitchen"]);
    // Null means still held — the same meaning as view_as_log.endedAt.
    expect(rows[0].releasedAt).toBeNull();
  });

  it("writes nothing for a task that grants nothing", async () => {
    // The guard that keeps this from becoming a firehose. Logging every claim
    // in the app would record the whole community's task history for no
    // security value, since a task carrying no grant row mints no authority.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);

    await claimTask(alice, t.id);

    expect(await holdings()).toHaveLength(0);
  });

  it("records every module a multi-cardinality task grants", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await grantPermission(c.id, "support", t.id);

    await claimTask(alice, t.id);

    expect((await holdings())[0].moduleKeys.sort()).toEqual(["kitchen", "support"]);
  });

  it("agrees with the assignment's own claimedAt", async () => {
    // Both default to now(), which is transaction_timestamp(), so they match
    // because they share a transaction rather than because two clocks agree.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);

    await claimTask(alice, t.id);

    const [assignment] = await db
      .select()
      .from(taskAssignment)
      .where(eq(taskAssignment.taskId, t.id));
    const [holding] = await holdings();
    expect(holding.claimedAt.getTime()).toBe(assignment.claimedAt.getTime());
  });

  it("does not log a shadow", async () => {
    // Shadows are excluded from every holder count in this codebase
    // (listHoldersOfTasks, satisfiedRuleIds), so logging one would report
    // authority that never existed.
    const { community: c, branch, alice, bob } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);

    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    const rows = await holdings();
    expect(rows).toHaveLength(1);
    expect(rows[0].memberId).toBe(alice.id);
  });
});

describe("permission_holding — a release", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("closes the holding instead of deleting it", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);
    const [before] = await holdings();

    await releaseTask(alice, t.id);

    const rows = await holdings();
    expect(rows).toHaveLength(1);
    expect(rows[0].releasedAt).not.toBeNull();
    // claimedAt is the episode's start and must not move when it closes.
    expect(rows[0].claimedAt.getTime()).toBe(before.claimedAt.getTime());
  });

  it("opens a second episode on re-claim rather than reopening the first", async () => {
    // The property claim-then-release detection depends on: a member who
    // grabs a role and drops it leaves two rows, and collapsing them would
    // erase exactly the pattern worth noticing.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);

    await claimTask(alice, t.id);
    await releaseTask(alice, t.id);
    await claimTask(alice, t.id);

    const rows = await holdings();
    expect(rows).toHaveLength(2);
    const open = rows.filter((r) => r.releasedAt === null);
    expect(open).toHaveLength(1);
    expect(rows.filter((r) => r.releasedAt !== null)).toHaveLength(1);
  });

  it("still closes when the grant was stripped mid-hold", async () => {
    // The holding was real when it began, so it stays a real holding. Gating
    // the close on the task still carrying a grant would strand this row
    // open forever — and "open forever" is indistinguishable from
    // "currently held" to every reader of the table.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);
    await removePermissionGrant(alice, "kitchen", t.id);

    await releaseTask(alice, t.id);

    expect((await holdings())[0].releasedAt).not.toBeNull();
  });
});

describe("permission_holding — the snapshot is a tombstone, not a join", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps the module it recorded after the grant is gone", async () => {
    // Grants move. Read through a join at report time, this row would claim
    // the holder had no authority at all — the precise opposite of what
    // happened, and wrong in the direction that matters.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);

    await removePermissionGrant(alice, "kitchen", t.id);

    expect((await holdings())[0].moduleKeys).toEqual(["kitchen"]);
  });

  it("outlives its task, because task_id carries no foreign key", async () => {
    // deleteTask needs only an unclaimed task and its creator, so a task can
    // have its grant stripped and then be deleted. An FK here would either
    // block that or take the record of a real holding down with it.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);
    await releaseTask(alice, t.id);
    await removePermissionGrant(alice, "kitchen", t.id);

    await db.execute(`DELETE FROM task WHERE id = '${t.id}'`);

    const rows = await holdings();
    expect(rows).toHaveLength(1);
    expect(rows[0].taskTitle).toBe("A task");
  });

  it("is not an authority path: the holding survives, the capability does not", async () => {
    // The guarantee that keeps this table from becoming the Phase 63
    // second-authority-path failure in a worse position. A stale row here
    // must not be able to grant anything — so removing the grant ends the
    // capability even though a row saying "kitchen" is still sitting there.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);
    expect(await isKitchenOwner(alice)).toBe(true);

    await removePermissionGrant(alice, "kitchen", t.id);

    expect(await isKitchenOwner(alice)).toBe(false);
    expect((await holdings())[0].moduleKeys).toEqual(["kitchen"]);
  });
});

describe("permission_holding — the paths that bypass performClaimInTx", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records the backstop auto-filled when a blank cycle is started", async () => {
    // One of two places that mint authority outside performClaimInTx (the
    // other being the clone branch below). They looked like the least
    // important — backstop is the one module with no open checkbox (D11) and
    // is cycle-scoped — but a log with a known hole in it is worse than
    // none, because it reads complete.
    const { community: c, alice } = await createFixtures();
    await enableCycles(c.id);

    await createCycle(alice, { source: "blank", name: "2027 Season" });

    const rows = await holdings();
    expect(rows).toHaveLength(1);
    expect(rows[0].moduleKeys).toEqual(["backstop"]);
    expect(rows[0].memberId).toBe(alice.id);
    expect(rows[0].releasedAt).toBeNull();
  });

  it("records the backstop auto-filled onto a cloned cycle's task", async () => {
    // The clone branch that inserts the assignment directly rather than
    // delegating to createBackstopTask — the one path where the log call
    // reads a grant this transaction did not write.
    const { community: c, alice } = await createFixtures();
    await enableCycles(c.id);
    await createCycle(alice, { source: "blank", name: "2027 Season" });

    await createCycle(alice, { source: "clone_previous", name: "2028 Season", confirmed: true });

    const rows = await holdings();
    expect(rows).toHaveLength(2);
    // Two separate cycles, so two episodes — the same member holding the
    // same role in two scopes is two facts, not one holder counted twice.
    expect(rows.every((r) => r.moduleKeys[0] === "backstop")).toBe(true);
    expect(new Set(rows.map((r) => r.taskId)).size).toBe(2);
  });
});

// ───────────────────────────── the read side ─────────────────────────────

describe("listDataUnlockingModules", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("derives which modules read restricted answers from the rules, not a hardcoded list", async () => {
    // A community that attaches a restricted question to a module has made
    // that module a data-reading role. A hardcoded list would be wrong the
    // moment somebody attached a question to a module nobody anticipated.
    const { community: c, alice } = await createFixtures();
    await createRestrictedQuestion(
      alice,
      { label: "Allergies", responseType: "text", scope: "once_ever" },
      { audience: { unlockedByGrantModuleKey: "kitchen" } },
    );

    expect(await listDataUnlockingModules(c.id)).toEqual(new Set(["kitchen"]));
  });

  it("is empty when no rule names a module", async () => {
    const { community: c } = await createFixtures();
    expect(await listDataUnlockingModules(c.id)).toEqual(new Set());
  });

  it("does not treat an open module as a route to the data (D9)", async () => {
    // D9 settled that openness does not unlock a restricted question, so a
    // detector that counted openness here would flag every member of an open
    // community as capable of reading data nobody has actually opened to them.
    const { community: c, alice } = await createFixtures();
    await createRestrictedQuestion(
      alice,
      { label: "Allergies", responseType: "text", scope: "once_ever" },
      { audience: { unlockedByGrantModuleKey: "kitchen" } },
    );
    await setModuleOpen(alice, "kitchen", true);

    // Still just the module the rule names — the open flag adds nobody.
    expect(await listDataUnlockingModules(c.id)).toEqual(new Set(["kitchen"]));
  });
});

describe("listShortPermissionHolds", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** A closed episode of an exact duration, written straight to the log. */
  async function episode(
    c: { id: string },
    who: { id: string },
    moduleKey: "kitchen" | "support",
    taskId: string,
    durationMs: number,
    taskTitle = "A task",
  ) {
    const claimedAt = new Date(Date.now() - durationMs - 1000);
    await db.insert(permissionHolding).values({
      communityId: c.id,
      memberId: who.id,
      taskId,
      taskTitle,
      moduleKeys: [moduleKey],
      claimedAt,
      releasedAt: new Date(claimedAt.getTime() + durationMs),
    });
  }

  it("flags a member who repeatedly claims and drops the same role", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);

    // Claim/release three times. Each episode is milliseconds long, which is
    // the real shape of the thing being looked for.
    for (let i = 0; i < 3; i++) {
      await claimTask(alice, t.id);
      await releaseTask(alice, t.id);
    }

    const flags = await listShortPermissionHolds(alice);
    expect(flags).toHaveLength(1);
    expect(flags[0].memberId).toBe(alice.id);
    expect(flags[0].memberName).toBe("Alice");
    expect(flags[0].moduleKeys).toEqual(["kitchen"]);
    expect(flags[0].episodes).toHaveLength(3);
  });

  it("does not flag one short hold — an ordinary day of checking a task", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);
    await releaseTask(alice, t.id);

    // Below the default minEpisodes of 3. Repetition is the signal; a single
    // short hold is a coordinator doing their job.
    expect(await listShortPermissionHolds(alice)).toEqual([]);
  });

  it("does not flag holds that ran long enough to be work", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    for (let i = 0; i < 4; i++) await episode(c, alice, "kitchen", t.id, 3 * 60 * 60 * 1000);

    expect(await listShortPermissionHolds(alice)).toEqual([]);
  });

  it("does not flag holds that are still open", async () => {
    // Whoever currently holds a role has, by definition, not dropped it —
    // and including open holds would flag every current holder, every time.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await claimTask(alice, t.id);

    expect(await listShortPermissionHolds(alice)).toEqual([]);
  });

  it("marks a flag whose module can read restricted answers", async () => {
    const { community: c, branch, alice } = await createFixtures();
    await createRestrictedQuestion(
      alice,
      { label: "Allergies", responseType: "text", scope: "once_ever" },
      { audience: { unlockedByGrantModuleKey: "kitchen" } },
    );
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    for (let i = 0; i < 3; i++) await episode(c, alice, "kitchen", t.id, 60 * 1000);

    const [flag] = await listShortPermissionHolds(alice);
    expect(flag.unlocksRestrictedData).toBe(true);
  });

  it("marks a flag whose module cannot read restricted answers", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "support", t.id);
    for (let i = 0; i < 3; i++) await episode(c, alice, "support", t.id, 60 * 1000);

    const [flag] = await listShortPermissionHolds(alice);
    expect(flag.unlocksRestrictedData).toBe(false);
  });

  it("keeps one community's holds out of another's report", async () => {
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    for (let i = 0; i < 3; i++) await episode(c, alice, "kitchen", t.id, 60 * 1000);

    // A second community, with its own member churning its own role.
    const other = await createFixtures();
    const otherTask = await insertTask(other.community.id, other.branch.id, other.alice.id);
    await grantPermission(other.community.id, "kitchen", otherTask.id);
    for (let i = 0; i < 3; i++)
      await episode(other.community, other.alice, "kitchen", otherTask.id, 60 * 1000);

    const fromFirst = await listShortPermissionHolds(alice);
    expect(fromFirst).toHaveLength(1);
    expect(fromFirst[0].memberId).toBe(alice.id);

    const fromOther = await listShortPermissionHolds(other.alice);
    expect(fromOther).toHaveLength(1);
    expect(fromOther[0].memberId).toBe(other.alice.id);
  });

  it("reports the duration of a closed hold and leaves an open one unknown", async () => {
    // An invented number for an open hold would sort as the longest hold in
    // any report built on this, so it is null instead.
    const { community: c, branch, alice } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id);
    await grantPermission(c.id, "kitchen", t.id);
    await episode(c, alice, "kitchen", t.id, 5 * 60 * 1000);
    await claimTask(alice, t.id);

    const rows = await listPermissionHolds(alice);
    expect(rows).toHaveLength(2);
    const open = rows.find((r) => r.releasedAt === null)!;
    const closed = rows.find((r) => r.releasedAt !== null)!;
    expect(open.durationMs).toBeNull();
    expect(closed.durationMs).toBe(5 * 60 * 1000);
  });
});
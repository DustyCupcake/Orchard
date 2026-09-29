import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as memberTable, settingsChange } from "@/db/schema";
import { recordSettingChanges } from "@/lib/settings/history";
import { createTier, updateCommunity } from "@/lib/settings";
import type { RecruitmentDecisionRule } from "@/lib/recruitment/evaluations";
import { createFixtures, resetDatabase } from "./helpers";

// A valid rule set: the last rule must be an unconditional fallback, or
// requireValidDecisionRules refuses it before the log is ever reached.
const RULES: RecruitmentDecisionRule[] = [
  { conditions: { minCounts: { proceed: 2, decline: 0 } }, outcome: "proceed" },
  { conditions: {}, outcome: "decline" },
];

async function allChanges() {
  return db.select().from(settingsChange).orderBy(asc(settingsChange.field));
}

describe("settings change log", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records one row per changed field, with who and which community", async () => {
    const { community: c, alice } = await createFixtures();

    await updateCommunity(alice, { name: "Renamed", cyclesEnabled: true });

    const rows = await allChanges();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.field).sort()).toEqual(["cyclesEnabled", "name"]);

    const name = rows.find((r) => r.field === "name")!;
    expect(name.oldValue).toBe("Test Community");
    expect(name.newValue).toBe("Renamed");
    expect(name.entity).toBe("community");
    expect(name.action).toBe("updated");
    expect(name.actorId).toBe(alice.id);
    expect(name.communityId).toBe(c.id);
    expect(name.entityId).toBe(c.id);
    expect(name.valuesWithheld).toBe(false);
  });

  // The reason the log diffs rather than logging submissions. Every settings
  // tab's form submits every field that tab owns on every save, so a log built
  // from what was posted would bury one real edit under every field that was
  // merely re-sent — and an admin who opens the Recruitment tab and saves
  // without touching anything is the common case, not the rare one.
  it("writes nothing when a save resubmits the values already stored", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { name: "Settled", cyclesEnabled: true });
    const afterFirstSave = (await allChanges()).length;
    expect(afterFirstSave).toBe(2);

    // Exactly what updateGeneralSettingsAction posts: every general field,
    // unchanged. The six fields this call adds are all already stored, and
    // the two it repeats were logged by the first save — so this call must
    // contribute nothing at all.
    await updateCommunity(alice, {
      name: "Settled",
      cyclesEnabled: true,
      phasesEnabled: false,
      onsiteModeEnabled: false,
      accentPrimary: null,
      logoUrl: null,
    });

    expect(await allChanges()).toHaveLength(afterFirstSave);
  });

  it("ignores fields the action did not submit", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { cyclesEnabled: true });

    // A second save that submits only `name`. cyclesEnabled is not in this
    // input at all, so it must not be logged a second time even though the
    // row still holds the value the first save wrote.
    await updateCommunity(alice, { name: "Only The Name" });

    const rows = await allChanges();
    expect(rows.filter((r) => r.field === "name")).toHaveLength(1);
    expect(rows.filter((r) => r.field === "cyclesEnabled")).toHaveLength(1);
  });

  it("records a cleared value as a change rather than as withheld", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { logoUrl: "https://example.test/logo.png" });
    await updateCommunity(alice, { logoUrl: null });

    const rows = await allChanges();
    const cleared = rows.find((r) => r.newValue === null)!;
    // Both read back as JS null, which is the whole reason valuesWithheld
    // exists — without it a cleared logo and a withheld value are the same row.
    expect(cleared.field).toBe("logoUrl");
    expect(cleared.valuesWithheld).toBe(false);
    expect(cleared.oldValue).toBe("https://example.test/logo.png");
  });

  it("records an array and an object field as themselves", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["shifts", "kitchen"], recruitmentDecisionRules: RULES });

    const rows = await allChanges();
    const modules = rows.find((r) => r.field === "modulesEnabled")!;
    expect(modules.oldValue).toEqual([]);
    expect(modules.newValue).toEqual(["shifts", "kitchen"]);

    const rules = rows.find((r) => r.field === "recruitmentDecisionRules")!;
    expect(rules.newValue).toEqual(RULES);
  });

  it("does not treat a reordered but equal rule set as a change", async () => {
    const { alice } = await createFixtures();
    await db.transaction(async (tx) => {
      // The same object with every key order reversed. Postgres jsonb
      // normalises key order on the way in and on the way out, so this is
      // what a real resubmission of an untouched textarea actually compares as.
      await recordSettingChanges(tx, {
        actor: alice,
        entity: "community",
        action: "updated",
        current: { rules: [{ conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" }] },
        changes: { rules: [{ outcome: "proceed", conditions: { minCounts: { proceed: 2 } } }] },
      });
    });

    expect(await allChanges()).toHaveLength(0);
  });

  // Array order is meaningful — decision rules are "evaluated top-to-bottom,
  // first match wins" — so the order-blind object comparison above must not
  // extend to reordering an array. modulesEnabled stands in for them here
  // because reversing a rule list would break the unconditional-fallback
  // invariant and never reach the log at all.
  it("does treat a reordered array as a change", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["kitchen", "shifts"] });
    await updateCommunity(alice, { modulesEnabled: ["shifts", "kitchen"] });

    const rows = await allChanges();
    expect(rows.filter((r) => r.field === "modulesEnabled")).toHaveLength(2);
  });

  it("records nothing when the update is refused", async () => {
    const { alice, community: c } = await createFixtures();
    const other = await createTier(alice, { name: "Real Tier" });
    expect(other.communityId).toBe(c.id);

    // A tier from another community: refused by the cross-community check
    // that runs before the write, so there is no change to record either.
    const otherFixtures = await createFixtures();
    const foreignTier = await createTier(otherFixtures.alice, { name: "Foreign" });
    await expect(
      updateCommunity(alice, { cycleInitiationTierId: foreignTier.id }),
    ).rejects.toThrow(/Tier not found/);

    // Scoped to the community entity, because the two createTier calls above
    // legitimately wrote tier rows of their own — this is about the refused
    // *community* update, not about the table being empty.
    const communityRows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "community"));
    expect(communityRows).toHaveLength(0);
    expect(foreignTier.communityId).toBe(otherFixtures.community.id);
  });

  it("keeps each community's log to itself", async () => {
    const { alice } = await createFixtures();
    const other = await createFixtures();

    await updateCommunity(alice, { name: "First" });
    await updateCommunity(other.alice, { name: "Second" });

    const mine = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.communityId, alice.communityId));
    expect(mine).toHaveLength(1);
    expect(mine[0].newValue).toBe("First");
  });

  it("labels a renamed community with the name it now has", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { name: "After The Rename" });

    const [row] = await allChanges();
    // The label identifies the entity as it is now, which is the name someone
    // looking for this row later will recognise.
    expect(row.entityLabel).toBe("After The Rename");
  });

  describe("withheld values", () => {
    it("marks the row so a reader can tell it from a cleared value", async () => {
      const { alice } = await createFixtures();
      await db.transaction(async (tx) => {
        await recordSettingChanges(tx, {
          actor: alice,
          entity: "bulk_member_import",
          action: "committed",
          current: { loginEmail: null },
          changes: { loginEmail: "someone@example.test" },
          withheld: ["loginEmail"],
        });
      });

      const [row] = await allChanges();
      expect(row.valuesWithheld).toBe(true);
      expect(row.newValue).toBeNull();
      expect(row.oldValue).toBeNull();
    });

    // Withholding the value must not withhold the accountability — the whole
    // reason to log a login email change is that someone should be able to
    // see that it happened and who did it.
    it("still records the actor and the time on a withheld row", async () => {
      const { alice } = await createFixtures();
      await db.transaction(async (tx) => {
        await recordSettingChanges(tx, {
          actor: alice,
          entity: "bulk_member_import",
          action: "committed",
          // Nothing existed before an import, so there is no prior row to
          // compare against.
          current: {},
          changes: { loginEmail: "someone@example.test" },
          withheld: ["loginEmail"],
        });
      });

      const [row] = await allChanges();
      expect(row.actorId).toBe(alice.id);
      expect(row.communityId).toBe(alice.communityId);
      expect(row.field).toBe("loginEmail");
      expect(row.changedAt).toBeInstanceOf(Date);
    });
  });
});

// ── the read side, and the entities beyond the community row ────────────────
//
// Everything above tests recordSettingChanges directly against a hand-built
// transaction. That proves the diff works; it does not prove that any real
// call site calls it. These tests go through the actual settings functions,
// because a log that is complete in isolation and empty in practice is the
// failure mode that matters — and the only thing that catches it is a test
// that forgets a hook.
describe("settings change log is actually written", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("records a branch's creation, edit and deletion under its own name", async () => {
    const { community: c, alice } = await createFixtures();

    const { createBranch, updateBranch, deleteBranch } = await import("@/lib/settings/branches");
    const created = await createBranch(alice, { name: "North side" });
    await updateBranch(alice, created.id, { name: "North side rota" });
    await deleteBranch(alice, created.id);

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "branch"))
      .orderBy(asc(settingsChange.changedAt));
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(["created", "updated", "deleted"]);

    // The tombstone test: the branch is gone, and every row still names it.
    // A read-time join would render all three as "—".
    for (const r of rows) {
      expect(r.entityLabel).toBeTruthy();
    }
    expect(rows[0].entityLabel).toBe("North side");
    expect(rows[1].entityLabel).toBe("North side rota");
    expect(rows[2].entityLabel).toBe("North side rota");

    const rename = rows[1];
    expect(rename.field).toBe("name");
    expect(rename.oldValue).toBe("North side");
    expect(rename.newValue).toBe("North side rota");
    expect(rename.communityId).toBe(c.id);
    expect(rename.actorId).toBe(alice.id);
  });

  // The nullable call-defaults are the interesting case for a create: null
  // means "inherit the community's default" (see createBranchInput's own
  // comment), so a log line saying "call agenda: nothing" would describe a
  // setting nobody chose. The create records the name and says nothing
  // about the three it inherited.
  it("does not log a branch's inherited call defaults as settings that were set", async () => {
    const { alice } = await createFixtures();
    const { createBranch } = await import("@/lib/settings/branches");

    await createBranch(alice, { name: "Defaults" });

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "branch"));
    expect(rows.map((r) => r.field)).toEqual(["name"]);
    expect(rows[0].newValue).toBe("Defaults");
  });

  // ...and the same branch with all three set does log them, which is what
  // makes the omission above a decision rather than a blanket.
  it("logs a branch's call defaults when they are actually chosen", async () => {
    const { alice } = await createFixtures();
    const { createBranch } = await import("@/lib/settings/branches");

    await createBranch(alice, {
      name: "Chosen",
      defaultCallHasAgenda: true,
      defaultCallNeedsSummary: false,
      defaultCallRequireRead: true,
    });

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "branch"));
    const defaults = rows.filter((r) => r.field.startsWith("defaultCall")).map((r) => r.field);
    expect(defaults.sort()).toEqual([
      "defaultCallHasAgenda",
      "defaultCallNeedsSummary",
      "defaultCallRequireRead",
    ]);
  });

  it("records a tier and an event type, and logs the replacement half of a permission move", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const { createTier } = await import("@/lib/settings/tiers");
    const { createCycleType } = await import("@/lib/settings/cycle-types");
    const { setPermissionGrant } = await import("@/lib/permissions");
    const { insertTask } = await import("./helpers");

    // One row per changed *field*, so a create is several rows — and a tier
    // with no criterion config set logs only its name, for the same reason
    // a branch with inherited defaults does.
    const tier = await createTier(alice, { name: "Coordinator" });
    const tierRows = await db.select().from(settingsChange).where(eq(settingsChange.entity, "tier"));
    expect(tierRows.map((r) => r.field)).toEqual(["name"]);
    expect(tierRows[0].entityLabel).toBe("Coordinator");

    const cycleType = await createCycleType(alice, { name: "Regular meeting" });
    const cycleTypeRows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "cycle_type"));
    expect(cycleTypeRows.map((r) => r.field)).toEqual(["name"]);
    expect(cycleTypeRows[0].entityLabel).toBe("Regular meeting");

    // Two grants of the same single-cardinality module in the same scope:
    // the second replaces the first, and the log has to say what it
    // replaced or the row reads as a bare new grant.
    const taskA = await insertTask(c.id, branch.id, alice.id, { title: "Autumn rota" });
    const taskB = await insertTask(c.id, branch.id, alice.id, { title: "Spring rota" });
    await setPermissionGrant(alice, "budget", taskA.id);
    await setPermissionGrant(alice, "budget", taskB.id);

    const grantRows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "permission_grant"))
      // Oldest first, and by id within a timestamp — the same tiebreak
      // listSettingsChanges uses. Ordering on changedAt alone is not
      // deterministic when two saves land in the same microsecond, which
      // two adjacent awaits in a test do easily.
      .orderBy(asc(settingsChange.changedAt), asc(settingsChange.id));
    // Only `grantingTask` moves, so only it is logged — twice. The
    // moduleKey is submitted on both saves and identical on both, which is
    // exactly the case the per-field diff exists to drop.
    expect(grantRows).toHaveLength(2);
    expect(grantRows.every((r) => r.field === "grantingTask")).toBe(true);
    // The first grant has no predecessor, so it reads as created; the
    // second is the one that replaced it.
    const first = grantRows.find((r) => r.action === "created")!;
    const second = grantRows.find((r) => r.action === "updated")!;
    expect(first.oldValue).toBeNull();
    expect(first.newValue).toBe("Autumn rota");
    // The replacement is the whole content of the second change.
    expect(second.oldValue).toBe("Autumn rota");
    expect(second.newValue).toBe("Spring rota");
    expect(tier.id).toBeTruthy();
    expect(cycleType.id).toBeTruthy();
  });

  // A no-op write must write no log row. This is the property that makes the
  // log readable: addPermissionGrant is documented as a no-op when the grant
  // already exists, and re-ticking a ticked module checkbox is the same.
  it("writes nothing for an operation that changes nothing", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const { addPermissionGrant } = await import("@/lib/permissions");
    const { insertTask } = await import("./helpers");

    const t = await insertTask(c.id, branch.id, alice.id, {});
    await addPermissionGrant(alice, "branch_coordination", t.id);
    const after = await db.select().from(settingsChange).where(eq(settingsChange.entity, "permission_grant"));
    expect(after).toHaveLength(2); // moduleKey + grantingTask

    await addPermissionGrant(alice, "branch_coordination", t.id);
    const unchanged = await db.select().from(settingsChange).where(eq(settingsChange.entity, "permission_grant"));
    expect(unchanged).toHaveLength(2);
  });

  it("records module open and close, and not the re-tick of an open module", async () => {
    const { alice } = await createFixtures();
    const { setModuleOpen } = await import("@/lib/permissions");

    await setModuleOpen(alice, "recruitment", true);
    await setModuleOpen(alice, "recruitment", true); // already open
    await setModuleOpen(alice, "recruitment", false);

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "open_permission_grant"))
      .orderBy(asc(settingsChange.changedAt));
    // Open writes moduleKey + open; the re-tick writes nothing; the close
    // writes only `open`, since moduleKey did not change.
    const openRows = rows.filter((r) => r.field === "open");
    expect(rows).toHaveLength(3);
    expect(openRows).toHaveLength(2);
    expect(openRows[0].newValue).toBe(true);
    expect(openRows[1].newValue).toBe(false);
    expect(openRows[1].oldValue).toBe(true);
    for (const r of rows) {
      expect(r.entityLabel).toBeTruthy();
    }
  });

  // The one place values are withheld, and the reason the column exists: a
  // member-readable log that carried every imported login address would be
  // a roster of the whole community's login details.
  it("withholds login addresses from a bulk member import but still names the member", async () => {
    const { alice } = await createFixtures();
    const { commitBulkMemberImport } = await import("@/lib/settings/bulk-members");

    await commitBulkMemberImport(alice, [{ name: "Carol", email: "carol@example.test" }]);

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "bulk_member_import"));
    expect(rows).toHaveLength(2); // the name, and the withheld identity

    const nameRow = rows.find((r) => r.field === "memberName")!;
    expect(nameRow.newValue).toBe("Carol");
    expect(nameRow.entityLabel).toBe("Carol");
    expect(nameRow.valuesWithheld).toBe(false);

    const idRow = rows.find((r) => r.field === "memberIdentity")!;
    expect(idRow.valuesWithheld).toBe(true);
    expect(idRow.oldValue).toBeNull();
    expect(idRow.newValue).toBeNull();
    // Accountability survives the withholding, which is the point of the
    // flag rather than of a blank value.
    expect(idRow.actorId).toBe(alice.id);
  });

  it("records a question's audience rule against the question's name", async () => {
    const { alice } = await createFixtures();
    const { createProfileQuestion } = await import("@/lib/profile-questions/questions");

    await createProfileQuestion(alice, {
      label: "Do you have a health condition?",
      responseType: "text",
      scope: "once_ever",
      sensitive: true,
      emergencyAccess: false,
      audience: { unlockedByGrantModuleKey: "support" },
    });

    const rules = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "sensitive_field_rule"));
    // The chosen column plus `question`. The two columns that were *not*
    // chosen stay out of the log entirely: against an empty `current` a null
    // canonicalises equal to an absent value, so they are not changes. That
    // matters here — "unlocked by task: nothing" beside "unlocked by grant
    // module: support" would read as a half-built rule.
    expect(rules).toHaveLength(2);
    // The rule has no name of its own, so the entity is the question —
    // otherwise the row could not answer "who can see the answer to X?".
    for (const r of rules) {
      expect(r.entityLabel).toBe("Do you have a health condition?");
    }
    const unlock = rules.find((r) => r.field === "unlockedByGrantModuleKey")!;
    expect(unlock.newValue).toBe("support");
    expect(rules.find((r) => r.field === "question")!.newValue).toBe(
      "Do you have a health condition?",
    );
    expect(rules.filter((r) => r.field === "unlockedByTaskId")).toHaveLength(0);
    expect(rules.filter((r) => r.field === "unlockedByTierId")).toHaveLength(0);
  });

  it("records a profile question's create and archive", async () => {
    const { alice } = await createFixtures();
    const { createProfileQuestion, archiveProfileQuestion } = await import(
      "@/lib/profile-questions/questions"
    );

    const q = await createProfileQuestion(alice, {
      label: "Favourite fruit",
      responseType: "text",
      scope: "once_ever",
    });
    await archiveProfileQuestion(alice, q.id);

    const rows = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.entity, "profile_question"))
      .orderBy(asc(settingsChange.changedAt));
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("created");
    expect(actions).toContain("archived");
    for (const r of rows) {
      expect(r.entityLabel).toBe("Favourite fruit");
    }
  });
});

// ── reading the log ─────────────────────────────────────────────────────────
describe("reading the settings change log", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns the community's rows newest first, with actor names resolved", async () => {
    const { community: c, alice, bob } = await createFixtures();
    await updateCommunity(alice, { name: "First" });
    await updateCommunity(bob, { name: "Second" });

    const { listSettingsChanges } = await import("@/lib/settings/history");
    const rows = await listSettingsChanges(alice);

    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0].actorName).toBe("Bob");
    expect(rows[rows.length - 1].actorName).toBe("Alice");
    // Every row is in this community and no other.
    for (const r of rows) {
      expect(r.actorId === alice.id || r.actorId === bob.id).toBe(true);
    }
    expect(c.id).toBeTruthy();
  });

  // The reason actorName is resolved at read time and never stored: a member
  // who renames themselves must not leave their old name written into
  // history.
  it("shows the actor's current name, not the name they had at the time", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { name: "Renamed" });
    await db.update(memberTable).set({ name: "Alice Renamed" }).where(eq(memberTable.id, alice.id));

    const { listSettingsChanges } = await import("@/lib/settings/history");
    const rows = await listSettingsChanges(alice);
    expect(rows[0].actorName).toBe("Alice Renamed");
  });

  // A departed actor is not representable rather than merely handled:
  // settings_change.actor_id has a foreign key to member with no onDelete,
  // so a member who wrote to the log cannot be deleted out from under it —
  // and there is no member-deletion path in the app to try. This is the
  // same constraint the other 47 *By columns in this schema carry, and it
  // is asserted here because it is what lets listSettingsChanges resolve
  // names with a bare lookup and no "someone who has left" fallback.
  it("refuses to delete a member who has written to the log", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { name: "Renamed" });

    await expect(db.delete(memberTable).where(eq(memberTable.id, alice.id))).rejects.toThrow();

    const { listSettingsChanges } = await import("@/lib/settings/history");
    const rows = await listSettingsChanges(alice);
    expect(rows[0].actorName).toBe("Alice");
  });

  it("filters by entity, and counts every entity independently of the filter", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const { createBranch } = await import("@/lib/settings/branches");
    const { createTier } = await import("@/lib/settings/tiers");

    await updateCommunity(alice, { name: "Renamed" });
    await createBranch(alice, { name: "North" });
    await createTier(alice, { name: "Coordinator" });

    const { listSettingsChanges, countSettingsChangesByEntity } = await import("@/lib/settings/history");
    const branchesOnly = await listSettingsChanges(alice, { entity: "branch" });
    expect(branchesOnly).toHaveLength(1);
    expect(branchesOnly[0].entityLabel).toBe("North");

    // The counts describe the whole log, not the filtered slice — otherwise
    // the filter row would show a count that changes when you click it.
    const counts = await countSettingsChangesByEntity(alice);
    expect(counts.community).toBeGreaterThanOrEqual(1);
    expect(counts.branch).toBe(1);
    expect(counts.tier).toBe(1);
    // A count is per field, like a row — the same rule the list follows.
    expect(counts.community).toBe((await listSettingsChanges(alice, { entity: "community" })).length);
    expect(c.id).toBeTruthy();
    expect(branch.id).toBeTruthy();
  });

  it("scopes to the actor's own community", async () => {
    const { alice } = await createFixtures();
    const other = await createFixtures();
    await updateCommunity(alice, { name: "Mine" });
    await updateCommunity(other.alice, { name: "Theirs" });

    const { listSettingsChanges } = await import("@/lib/settings/history");
    const mine = await listSettingsChanges(alice);
    expect(mine.every((r) => r.entityLabel !== "Theirs")).toBe(true);
  });

  it("describes a change as a sentence, and says so when values were withheld", async () => {
    const { describeChange } = await import("@/lib/settings/history");

    expect(describeChange({ action: "updated", field: "name", valuesWithheld: false, oldValue: "A", newValue: "B" })).toBe(
      "name from A to B",
    );
    expect(
      describeChange({ action: "created", field: "cyclesEnabled", valuesWithheld: false, oldValue: null, newValue: true }),
    ).toBe("whether the community runs events set to on");
    expect(
      describeChange({ action: "deleted", field: "name", valuesWithheld: false, oldValue: "A", newValue: null }),
    ).toBe("name removed");
    // A field with no label entry falls through to its column name rather
    // than throwing, so a new column is ugly and not fatal.
    expect(
      describeChange({ action: "updated", field: "somethingBrandNew", valuesWithheld: false, oldValue: 1, newValue: 2 }),
    ).toBe("somethingBrandNew from 1 to 2");
    // The withheld case has to say the value is absent rather than showing a
    // blank arrow, which would read as a cleared setting.
    expect(
      describeChange({ action: "created", field: "memberIdentity", valuesWithheld: true, oldValue: null, newValue: null }),
    ).toBe("member identity changed — values not recorded");
  });

  it("reads booleans and arrays as words, not as JSON", async () => {
    const { describeChange } = await import("@/lib/settings/history");
    expect(
      describeChange({
        action: "updated",
        field: "modulesEnabled",
        valuesWithheld: false,
        oldValue: ["kitchen", "budget"],
        newValue: ["kitchen"],
      }),
    ).toBe("which modules are switched on from kitchen, budget to kitchen");
    expect(
      describeChange({ action: "updated", field: "modulesEnabled", valuesWithheld: false, oldValue: [], newValue: ["x"] }),
    ).toBe("which modules are switched on from nothing to x");
  });
});

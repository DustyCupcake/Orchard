import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { settingsChange } from "@/db/schema";
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

    expect(await allChanges()).toHaveLength(0);
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

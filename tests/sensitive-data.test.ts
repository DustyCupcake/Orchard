import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import { createTier, updateCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  createSensitiveFieldAccessRule,
  deleteSensitiveFieldAccessRule,
  getSensitiveDataTable,
  listSensitiveFieldAccessRules,
  listUnlockedFields,
  updateOwnSensitiveData,
} from "@/lib/sensitive-data";
import { AppError, NotFoundError } from "@/lib/errors";
import { createConsentPurpose, grantConsent, withdrawConsent } from "@/lib/consent";
import { createFixtures, resetDatabase } from "./helpers";

async function insertTask(communityId: string, branchId: string, createdBy: string) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Catering coordination",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
    })
    .returning();
  return row;
}

describe("isModuleEnabled", () => {
  it("is false by default, true once listed", () => {
    expect(isModuleEnabled({ modulesEnabled: [] }, "sensitive_data")).toBe(false);
    expect(isModuleEnabled({ modulesEnabled: ["sensitive_data"] }, "sensitive_data")).toBe(true);
  });
});

describe("a member's own sensitive data", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects updates while the module is off", async () => {
    const { alice } = await createFixtures();
    await expect(
      updateOwnSensitiveData(alice, { allergies: "peanuts" }),
    ).rejects.toThrow(AppError);
  });

  it("is always editable by the member themselves once the module is on", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });

    const updated = await updateOwnSensitiveData(alice, {
      allergies: "peanuts",
      healthConditions: "asthma",
      emergencyContact: "Jane, 555-1234",
      orientation: "ace",
    });
    expect(updated.allergies).toBe("peanuts");
    expect(updated.healthConditions).toBe("asthma");
    expect(updated.emergencyContact).toBe("Jane, 555-1234");
    expect(updated.orientation).toBe("ace");
  });
});

describe("sensitive field access rules", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects a rule with neither or both of task/tier set", async () => {
    const { alice, branch } = await createFixtures();
    await expect(
      createSensitiveFieldAccessRule(alice, { fieldKey: "allergies" }),
    ).rejects.toThrow(AppError);

    const t = await insertTask(alice.communityId, branch.id, alice.id);
    const tierRow = await createTier(alice, { name: "Kitchen" });
    await expect(
      createSensitiveFieldAccessRule(alice, {
        fieldKey: "allergies",
        unlockedByTaskId: t.id,
        unlockedByTierId: tierRow.id,
      }),
    ).rejects.toThrow(AppError);
  });

  it("rejects a task or tier from another community", async () => {
    const { alice } = await createFixtures();
    const { branch: strangerBranch, alice: strangerAlice } = await createFixtures();
    const strangerTask = await insertTask(strangerAlice.communityId, strangerBranch.id, strangerAlice.id);

    await expect(
      createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: strangerTask.id }),
    ).rejects.toThrow(NotFoundError);
  });

  it("creates, lists, and deletes rules", async () => {
    const { alice, branch } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await createSensitiveFieldAccessRule(alice, {
      fieldKey: "allergies",
      unlockedByTaskId: t.id,
    });
    expect(created.fieldKey).toBe("allergies");

    const rules = await listSensitiveFieldAccessRules(alice);
    expect(rules.map((r) => r.id)).toEqual([created.id]);

    await deleteSensitiveFieldAccessRule(alice, created.id);
    expect(await listSensitiveFieldAccessRules(alice)).toHaveLength(0);
  });
});

describe("unlocking others' fields", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("unlocks via a currently-held task, not a shadow of it", async () => {
    const { alice, bob, branch } = await createFixtures();
    const cateringTask = await insertTask(alice.communityId, branch.id, alice.id);
    await createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: cateringTask.id });

    expect(await listUnlockedFields(alice)).toEqual([]);

    await claimTask(alice, cateringTask.id);
    expect(await listUnlockedFields(alice)).toEqual(["allergies"]);
    expect(await listUnlockedFields(bob)).toEqual([]);
  });

  it("unlocks via a tier the actor currently carries", async () => {
    const { alice } = await createFixtures();
    const safetyTier = await createTier(alice, { name: "Safety officer" });
    await createSensitiveFieldAccessRule(alice, {
      fieldKey: "health_conditions",
      unlockedByTierId: safetyTier.id,
    });

    expect(await listUnlockedFields(alice)).toEqual([]);

    await db.update(member).set({ tierIds: [safetyTier.id] }).where(eq(member.id, alice.id));
    const refetched = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
    expect(await listUnlockedFields(refetched)).toEqual(["health_conditions"]);
  });

  it("combines multiple unlocked fields from separate rules", async () => {
    const { alice, branch } = await createFixtures();
    const cateringTask = await insertTask(alice.communityId, branch.id, alice.id);
    await claimTask(alice, cateringTask.id);
    const safetyTier = await createTier(alice, { name: "Safety officer" });
    await db.update(member).set({ tierIds: [safetyTier.id] }).where(eq(member.id, alice.id));

    await createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: cateringTask.id });
    await createSensitiveFieldAccessRule(alice, { fieldKey: "health_conditions", unlockedByTierId: safetyTier.id });

    const refetched = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
    expect(await listUnlockedFields(refetched)).toEqual(["health_conditions", "allergies"]);
  });
});

describe("getSensitiveDataTable", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects while the module is off", async () => {
    const { alice } = await createFixtures();
    await expect(getSensitiveDataTable(alice)).rejects.toThrow(AppError);
  });

  it("is empty when the actor is unlocked for nothing", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    const table = await getSensitiveDataTable(alice);
    expect(table).toEqual({ fields: [], rows: [] });
  });

  it("shows every member's value for exactly the fields the viewer is unlocked for", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    await updateOwnSensitiveData(bob, { allergies: "shellfish", healthConditions: "diabetic" });

    const cateringTask = await insertTask(alice.communityId, branch.id, alice.id);
    await claimTask(alice, cateringTask.id);
    await createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: cateringTask.id });

    const refetchedAlice = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
    const table = await getSensitiveDataTable(refetchedAlice);
    expect(table.fields).toEqual(["allergies"]);
    const bobRow = table.rows.find((r) => r.id === bob.id);
    expect(bobRow?.values).toEqual({ allergies: "shellfish" });
    // healthConditions never surfaces — alice isn't unlocked for it.
    expect(bobRow?.values.healthConditions).toBeUndefined();
  });

  it("never grants access to another community's rules or members", async () => {
    const { alice: strangerAlice } = await createFixtures();
    await db.update(community).set({ modulesEnabled: ["sensitive_data"] }).where(eq(community.id, strangerAlice.communityId));

    const { alice, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    const cateringTask = await insertTask(alice.communityId, branch.id, alice.id);
    await claimTask(alice, cateringTask.id);
    await createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: cateringTask.id });

    expect(await listUnlockedFields(strangerAlice)).toEqual([]);
  });
});

describe("Phase 46: consent gating of sensitive fields", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets a field populate freely when no gating purpose is configured (Phase 22's original behavior)", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    const updated = await updateOwnSensitiveData(alice, { allergies: "peanuts" });
    expect(updated.allergies).toBe("peanuts");
  });

  it("rejects populating a field whose gating purpose has no active consent", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesSensitiveField: "allergies",
      requiresExplicit: true,
    });

    await expect(updateOwnSensitiveData(alice, { allergies: "peanuts" })).rejects.toThrow(AppError);
  });

  it("allows the write once consent is granted, and always allows clearing a field back to null", async () => {
    const { alice } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    const purpose = await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesSensitiveField: "allergies",
      requiresExplicit: true,
    });
    await grantConsent(alice, purpose.id);

    const updated = await updateOwnSensitiveData(alice, { allergies: "peanuts" });
    expect(updated.allergies).toBe("peanuts");

    const cleared = await updateOwnSensitiveData(alice, { allergies: null });
    expect(cleared.allergies).toBeNull();
  });

  it("stops showing a field to an unlocked viewer the moment consent is withdrawn, re-checked live at read time", async () => {
    const { alice, bob, branch } = await createFixtures();
    await updateCommunity(alice, { modulesEnabled: ["sensitive_data"] });
    const purpose = await createConsentPurpose(alice, {
      key: "sensitive_health",
      label: "Health data",
      noticeText: "...",
      gatesSensitiveField: "allergies",
      requiresExplicit: true,
    });
    await grantConsent(bob, purpose.id);
    await updateOwnSensitiveData(bob, { allergies: "shellfish" });

    const cateringTask = await insertTask(alice.communityId, branch.id, alice.id);
    await claimTask(alice, cateringTask.id);
    await createSensitiveFieldAccessRule(alice, { fieldKey: "allergies", unlockedByTaskId: cateringTask.id });

    const refetchedAlice = (await db.select().from(member).where(eq(member.id, alice.id)))[0];
    const beforeWithdraw = await getSensitiveDataTable(refetchedAlice);
    expect(beforeWithdraw.rows.find((r) => r.id === bob.id)?.values.allergies).toBe("shellfish");

    await withdrawConsent(bob, purpose.id);

    const afterWithdraw = await getSensitiveDataTable(refetchedAlice);
    expect(afterWithdraw.rows.find((r) => r.id === bob.id)?.values.allergies).toBeNull();
  });
});

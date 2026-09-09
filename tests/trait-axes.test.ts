import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import {
  archiveTraitAxis,
  createTraitAxis,
  effortAxisValue,
  listMemberAxisValues,
  listOutstandingOnboardingAxes,
  listTaskAxisValues,
  listTaskAxisValuesForTasks,
  listTraitAxes,
  setTaskAxisValues,
  unarchiveTraitAxis,
  updateTraitAxis,
  upsertMemberAxisValue,
} from "@/lib/trait-axes";
import { AppError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("trait axes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates, lists (excluding archived by default), archives, and unarchives an axis", async () => {
    const { alice } = await createFixtures();
    const axis = await createTraitAxis(alice, { key: "autonomy", lowLabel: "guided", highLabel: "independent" });

    expect((await listTraitAxes(alice)).map((a) => a.id)).toEqual([axis.id]);

    await archiveTraitAxis(alice, axis.id);
    expect((await listTraitAxes(alice)).map((a) => a.id)).toEqual([]);
    expect((await listTraitAxes(alice, { includeArchived: true })).map((a) => a.id)).toEqual([axis.id]);

    await unarchiveTraitAxis(alice, axis.id);
    expect((await listTraitAxes(alice)).map((a) => a.id)).toEqual([axis.id]);
  });

  it("rejects optionLabels that don't have exactly 5 entries", async () => {
    const { alice } = await createFixtures();
    await expect(
      createTraitAxis(alice, {
        key: "autonomy",
        lowLabel: "guided",
        highLabel: "independent",
        optionLabels: ["only", "three", "here"],
      }),
    ).rejects.toThrow(AppError);
  });

  it("updates label/optionLabels/askAtOnboarding without touching key", async () => {
    const { alice } = await createFixtures();
    const axis = await createTraitAxis(alice, { key: "autonomy", lowLabel: "guided", highLabel: "independent" });

    const updated = await updateTraitAxis(alice, axis.id, { askAtOnboarding: true, sortOrder: 5 });
    expect(updated.key).toBe("autonomy");
    expect(updated.askAtOnboarding).toBe(true);
    expect(updated.sortOrder).toBe(5);
  });

  it("throws NotFoundError for an axis outside the actor's community", async () => {
    const { alice } = await createFixtures();
    await expect(
      updateTraitAxis(alice, "00000000-0000-0000-0000-000000000000", { lowLabel: "x" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("rejects an out-of-range axis value", async () => {
    const { alice } = await createFixtures();
    const axis = await createTraitAxis(alice, { key: "autonomy", lowLabel: "guided", highLabel: "independent" });
    await expect(upsertMemberAxisValue(alice, axis.id, 5)).rejects.toThrow(AppError);
    await expect(upsertMemberAxisValue(alice, axis.id, 1.5)).rejects.toThrow(AppError);
  });

  it("upsertMemberAxisValue replaces an existing value rather than duplicating the row", async () => {
    const { alice } = await createFixtures();
    const axis = await createTraitAxis(alice, { key: "autonomy", lowLabel: "guided", highLabel: "independent" });

    await upsertMemberAxisValue(alice, axis.id, 1);
    await upsertMemberAxisValue(alice, axis.id, -2);

    const values = await listMemberAxisValues(alice.id);
    expect(values.get(axis.id)).toBe(-2);
    expect(values.size).toBe(1);
  });

  it("setTaskAxisValues bulk-sets and later calls update in place rather than duplicating", async () => {
    const { alice, community, branch } = await createFixtures();
    const [t] = await db
      .insert(task)
      .values({
        communityId: community.id,
        branchId: branch.id,
        title: "T",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
      })
      .returning();
    const axisA = await createTraitAxis(alice, { key: "a", lowLabel: "lo", highLabel: "hi" });
    const axisB = await createTraitAxis(alice, { key: "b", lowLabel: "lo", highLabel: "hi" });

    await setTaskAxisValues(db, t.id, { [axisA.id]: 2, [axisB.id]: -1 });
    let values = await listTaskAxisValues(t.id);
    expect(values.get(axisA.id)).toBe(2);
    expect(values.get(axisB.id)).toBe(-1);

    await setTaskAxisValues(db, t.id, { [axisA.id]: 0 });
    values = await listTaskAxisValues(t.id);
    expect(values.get(axisA.id)).toBe(0);
    expect(values.get(axisB.id)).toBe(-1);

    const byTask = await listTaskAxisValuesForTasks([t.id]);
    expect(byTask.get(t.id)?.get(axisA.id)).toBe(0);
  });

  it("setTaskAxisValues silently ignores an out-of-range value rather than failing the whole batch", async () => {
    const { alice, community, branch } = await createFixtures();
    const [t] = await db
      .insert(task)
      .values({
        communityId: community.id,
        branchId: branch.id,
        title: "T",
        effort: "one_off",
        effortMagnitude: { duration: "few_hours" },
        createdBy: alice.id,
      })
      .returning();
    const axis = await createTraitAxis(alice, { key: "a", lowLabel: "lo", highLabel: "hi" });

    await setTaskAxisValues(db, t.id, { [axis.id]: 99 });
    expect((await listTaskAxisValues(t.id)).size).toBe(0);
  });

  it("effortAxisValue maps one_off/ongoing/owns_a_thing to -2/0/2", () => {
    expect(effortAxisValue("one_off")).toBe(-2);
    expect(effortAxisValue("ongoing")).toBe(0);
    expect(effortAxisValue("owns_a_thing")).toBe(2);
  });

  it("listOutstandingOnboardingAxes excludes axes the member has already answered", async () => {
    const { alice } = await createFixtures();
    const onboardingAxis = await createTraitAxis(alice, {
      key: "autonomy",
      lowLabel: "guided",
      highLabel: "independent",
      askAtOnboarding: true,
    });
    const laterAxis = await createTraitAxis(alice, {
      key: "solitary_social",
      lowLabel: "solitary",
      highLabel: "social",
      askAtOnboarding: false,
    });

    expect((await listOutstandingOnboardingAxes(alice)).map((a) => a.id)).toEqual([onboardingAxis.id]);

    await upsertMemberAxisValue(alice, onboardingAxis.id, 1);
    expect(await listOutstandingOnboardingAxes(alice)).toEqual([]);
    // Unaffected either way — it was never askAtOnboarding.
    expect(laterAxis.askAtOnboarding).toBe(false);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member } from "@/db/schema";
import { createCycle, resolveCrossCycleContext } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

// docs/development-plan.md's Phase 66 — resolveCrossCycleContext backs
// the task detail page's cross-cycle-boundary banner and its "?scope="
// confirm-switch prompt. Never itself writes Member.lastViewedCycleId
// (see switchToLinkedScopeAction, the actual writer, in
// src/app/(app)/cycles/scope-actions.ts — untested here since this
// codebase's server actions that redirect have no automated-test
// precedent; verified manually instead, same as every other phase's
// page-level restructuring).
describe("resolveCrossCycleContext", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("never flags a mismatch for a cycle-less object", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    await createCycle(alice, { source: "blank", name: "Some cycle" });

    const ctx = await resolveCrossCycleContext(alice, null, null);
    expect(ctx.mismatchedObjectCycle).toBeNull();
    expect(ctx.linkedScope).toBeNull();
  });

  it("no mismatch when the object's cycle is inside the aggregate active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const coming = await createCycle(alice, { source: "blank", name: "Coming" });
    await declareParticipation(alice, coming.id, { status: "coming" });

    const ctx = await resolveCrossCycleContext(alice, coming, null);
    expect(ctx.activeScope.kind).toBe("aggregate");
    expect(ctx.mismatchedObjectCycle).toBeNull();
  });

  it("flags a mismatch when the object's cycle is outside the aggregate active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const coming = await createCycle(alice, { source: "blank", name: "Coming" });
    const notComing = await createCycle(alice, { source: "blank", name: "Not coming", confirmed: true });
    await declareParticipation(alice, coming.id, { status: "coming" });
    await declareParticipation(alice, notComing.id, { status: "maybe" });

    const ctx = await resolveCrossCycleContext(alice, notComing, null);
    expect(ctx.mismatchedObjectCycle?.id).toBe(notComing.id);
  });

  it("no mismatch when the object's cycle matches a persisted single active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const chosen = await createCycle(alice, { source: "blank", name: "Chosen" });
    await db.update(member).set({ lastViewedCycleId: chosen.id }).where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    const ctx = await resolveCrossCycleContext(refetched, chosen, null);
    expect(ctx.activeScope).toEqual({ kind: "single", cycle: expect.objectContaining({ id: chosen.id }) });
    expect(ctx.mismatchedObjectCycle).toBeNull();
  });

  it("flags a mismatch when the object's cycle differs from a persisted single active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const chosen = await createCycle(alice, { source: "blank", name: "Chosen" });
    const other = await createCycle(alice, { source: "blank", name: "Other", confirmed: true });
    await db.update(member).set({ lastViewedCycleId: chosen.id }).where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    const ctx = await resolveCrossCycleContext(refetched, other, null);
    expect(ctx.mismatchedObjectCycle?.id).toBe(other.id);
  });

  it("ignores a scope param that matches the viewer's own active scope", async () => {
    const { alice } = await createFixtures();
    const ctx = await resolveCrossCycleContext(alice, null, "active");
    expect(ctx.linkedScope).toBeNull();
  });

  it("ignores an invalid or foreign scope param", async () => {
    const { alice } = await createFixtures();
    expect((await resolveCrossCycleContext(alice, null, "not-a-uuid")).linkedScope).toBeNull();

    const { community: strangerCommunity, alice: strangerAlice } = await createFixtures();
    await enableCycles(strangerCommunity.id);
    const strangerCycle = await createCycle(strangerAlice, { source: "blank", name: "Elsewhere" });
    expect((await resolveCrossCycleContext(alice, null, strangerCycle.id)).linkedScope).toBeNull();
  });

  it("surfaces a scope param naming a real cycle that disagrees with the viewer's active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const linked = await createCycle(alice, { source: "blank", name: "Linked" });

    const ctx = await resolveCrossCycleContext(alice, null, linked.id);
    expect(ctx.linkedScope).toEqual({
      segment: linked.id,
      scope: { kind: "single", cycle: expect.objectContaining({ id: linked.id }) },
    });
  });

  it("surfaces a '?scope=active' param that disagrees with a persisted single active scope", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const chosen = await createCycle(alice, { source: "blank", name: "Chosen" });
    await db.update(member).set({ lastViewedCycleId: chosen.id }).where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    const ctx = await resolveCrossCycleContext(refetched, null, "active");
    expect(ctx.linkedScope?.scope.kind).toBe("aggregate");
  });
});

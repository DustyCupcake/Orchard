import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member } from "@/db/schema";
import {
  closeCycle,
  createCycle,
  listOpenCycles,
  resolveDefaultScopeSegment,
  resolveSingleCycleScope,
  resolveViewScopeCycleForMember,
  resolveViewScopeFromSegment,
} from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

// docs/development-plan.md's Phase 65 — every resolver here backs
// either the URL-driven scope (resolveViewScopeFromSegment,
// resolveSingleCycleScope, resolveDefaultScopeSegment — used by
// /[cycleScope]/participation and /budget) or the off-URL scope
// (resolveViewScopeCycleForMember — used by Messages/Contribution,
// which never moved under the segment).
describe("listOpenCycles", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns every open cycle, excluding closed ones", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const open = await createCycle(alice, { source: "blank", name: "Open" });
    const closed = await createCycle(alice, { source: "blank", name: "Closed", confirmed: true });
    await closeCycle(alice, closed.id);

    const rows = await listOpenCycles(alice);
    expect(rows.map((c) => c.id)).toEqual([open.id]);
  });
});

describe("resolveViewScopeFromSegment", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("'active' resolves to the aggregate — every open cycle the member is coming to", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const coming = await createCycle(alice, { source: "blank", name: "Coming" });
    const notComing = await createCycle(alice, { source: "blank", name: "Not coming", confirmed: true });
    await declareParticipation(alice, coming.id, { status: "coming" });
    await declareParticipation(alice, notComing.id, { status: "maybe" });

    const scope = await resolveViewScopeFromSegment(alice, "active");
    expect(scope).toEqual({ kind: "aggregate", cycles: [expect.objectContaining({ id: coming.id })] });
  });

  it("a real cycle id resolves to it, whether open or closed", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const open = await createCycle(alice, { source: "blank", name: "Open" });
    const closed = await createCycle(alice, { source: "blank", name: "Closed", confirmed: true });
    await closeCycle(alice, closed.id);

    expect(await resolveViewScopeFromSegment(alice, open.id)).toMatchObject({ kind: "single", cycle: { id: open.id } });
    expect(await resolveViewScopeFromSegment(alice, closed.id)).toMatchObject({
      kind: "single",
      cycle: { id: closed.id },
    });
  });

  it("resolves to null for a malformed segment or a cycle from another community", async () => {
    const { alice } = await createFixtures();
    expect(await resolveViewScopeFromSegment(alice, "not-a-uuid")).toBeNull();

    const { community: strangerCommunity, alice: strangerAlice } = await createFixtures();
    await enableCycles(strangerCommunity.id);
    const strangerCycle = await createCycle(strangerAlice, { source: "blank", name: "Elsewhere" });
    expect(await resolveViewScopeFromSegment(alice, strangerCycle.id)).toBeNull();
  });
});

describe("resolveSingleCycleScope", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("a direct pick in the URL always resolves — never a prompt, even alongside other open cycles", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const picked = await createCycle(alice, { source: "blank", name: "Picked" });
    await createCycle(alice, { source: "blank", name: "Other", confirmed: true });

    expect(await resolveSingleCycleScope(alice, picked.id)).toEqual({
      kind: "resolved",
      cycle: expect.objectContaining({ id: picked.id }),
    });
  });

  it("'active' resolves automatically with 0 or 1 coming-to candidates, prompts with 2+", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    expect(await resolveSingleCycleScope(alice, "active")).toEqual({ kind: "none" });

    const first = await createCycle(alice, { source: "blank", name: "First" });
    await declareParticipation(alice, first.id, { status: "coming" });
    expect(await resolveSingleCycleScope(alice, "active")).toEqual({
      kind: "resolved",
      cycle: expect.objectContaining({ id: first.id }),
    });

    const second = await createCycle(alice, { source: "blank", name: "Second", confirmed: true });
    await declareParticipation(alice, second.id, { status: "coming" });
    const ambiguous = await resolveSingleCycleScope(alice, "active");
    expect(ambiguous.kind).toBe("ambiguous");
    if (ambiguous.kind === "ambiguous") {
      expect(ambiguous.candidates.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
    }
  });
});

describe("resolveViewScopeCycleForMember", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("prefers the member's persisted lastViewedCycleId when it still resolves", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const chosen = await createCycle(alice, { source: "blank", name: "Chosen" });
    const other = await createCycle(alice, { source: "blank", name: "Other", confirmed: true });
    await declareParticipation(alice, other.id, { status: "coming" }); // would otherwise be the sole aggregate candidate
    await db.update(member).set({ lastViewedCycleId: chosen.id }).where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    expect(await resolveViewScopeCycleForMember(refetched)).toEqual({
      kind: "resolved",
      cycle: expect.objectContaining({ id: chosen.id }),
    });
  });

  it("falls through to the aggregate default when lastViewedCycleId is stale or foreign", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "Only open cycle" });
    await declareParticipation(alice, cyc.id, { status: "coming" });
    await db
      .update(member)
      .set({ lastViewedCycleId: "00000000-0000-0000-0000-000000000000" })
      .where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    expect(await resolveViewScopeCycleForMember(refetched)).toEqual({
      kind: "resolved",
      cycle: expect.objectContaining({ id: cyc.id }),
    });
  });

  it("resolves to none/ambiguous exactly like the aggregate resolver when lastViewedCycleId is unset", async () => {
    const { alice } = await createFixtures();
    expect(await resolveViewScopeCycleForMember(alice)).toEqual({ kind: "none" });
  });
});

describe("resolveDefaultScopeSegment", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is 'active' with no persisted selection, or when the persisted one no longer resolves", async () => {
    const { alice } = await createFixtures();
    expect(await resolveDefaultScopeSegment(alice)).toBe("active");

    await db
      .update(member)
      .set({ lastViewedCycleId: "00000000-0000-0000-0000-000000000000" })
      .where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(await resolveDefaultScopeSegment(refetched)).toBe("active");
  });

  it("is the persisted cycle id when it still resolves — open or closed", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    await closeCycle(alice, cyc.id);
    await db.update(member).set({ lastViewedCycleId: cyc.id }).where(eq(member.id, alice.id));
    const [refetched] = await db.select().from(member).where(eq(member.id, alice.id));

    expect(await resolveDefaultScopeSegment(refetched)).toBe(cyc.id);
  });
});

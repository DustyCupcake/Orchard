import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, tier, tierRequest } from "@/db/schema";
import {
  decideTierRequest,
  leaveTier,
  listOwnTierRequestStates,
  listTierRequestsToConfirm,
  requestTier,
  withdrawTierRequest,
} from "@/lib/tier-requests";
import { anonymiseMember } from "@/lib/members/leave";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";
import { claimTask } from "@/lib/tasks";

// A manual tier gates real things (a sensitive-data audience can be
// "unlocked by tier X"; starting an event can be limited to a tier), and for
// a long time the only way to hold one was to tick it on your own profile.
// These pin the replacement: ask, have an Admin or an existing holder
// confirm, and leave whenever.

async function manualTier(communityId: string, name = "Experienced") {
  const [row] = await db.insert(tier).values({ communityId, name, criterionType: "manual" }).returning();
  return row;
}

async function fresh(id: string) {
  return (await db.select().from(member).where(eq(member.id, id)))[0]!;
}

// Alice becomes a real Admin (so "an Admin" is a thing Bob is not), and the
// community's Admins gate is latched shut.
async function withAdmin() {
  const f = await createFixtures();
  const adminsTask = await insertTask(f.community.id, f.branch.id, f.alice.id, {
    title: "Admins",
    openness: "community_endorsed",
  });
  await grantPermission(f.community.id, "admin", adminsTask.id);
  await claimTask(f.alice, adminsTask.id);
  await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, f.community.id));
  const [carol] = await db.insert(member).values({ communityId: f.community.id, name: "Carol" }).returning();
  return { ...f, alice: await fresh(f.alice.id), bob: await fresh(f.bob.id), carol };
}

describe("asking for a manual tier", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("grants nothing while it is pending", async () => {
    const { community: c, bob } = await withAdmin();
    const t = await manualTier(c.id);

    await requestTier(bob, t.id);

    expect((await fresh(bob.id)).tierIds).toEqual([]);
    expect((await listOwnTierRequestStates(bob)).get(t.id)?.status).toBe("pending");
  });

  it("refuses a second pending request, a request for a tier you hold, and a computed tier", async () => {
    const { community: c, bob } = await withAdmin();
    const t = await manualTier(c.id);
    await requestTier(bob, t.id);
    await expect(requestTier(bob, t.id)).rejects.toThrow(ConflictError);

    const [auto] = await db
      .insert(tier)
      .values({ communityId: c.id, name: "Veteran", criterionType: "tenure", criterionConfig: { min_days: 30 } })
      .returning();
    await expect(requestTier(bob, auto.id)).rejects.toThrow(/earned automatically/);

    await db.update(member).set({ tierIds: [t.id] }).where(eq(member.id, bob.id));
    await withdrawTierRequest(bob, (await db.select().from(tierRequest))[0]!.id);
    await expect(requestTier(await fresh(bob.id), t.id)).rejects.toThrow(/already in that tier/);
  });

  it("will not request a tier from another community", async () => {
    const { bob } = await withAdmin();
    const other = await createFixtures();
    const foreign = await manualTier(other.community.id);
    await expect(requestTier(bob, foreign.id)).rejects.toThrow(NotFoundError);
  });

  it("can be withdrawn, and only by the person who asked", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const req = await requestTier(bob, t.id);

    await expect(withdrawTierRequest(alice, req.id)).rejects.toThrow(NotFoundError);
    await withdrawTierRequest(bob, req.id);
    expect(await db.select().from(tierRequest)).toEqual([]);
  });
});

describe("confirming a tier request", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("an Admin can confirm, which is when the member actually gets the tier", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const req = await requestTier(bob, t.id);

    await decideTierRequest(alice, req.id, "approved");

    expect((await fresh(bob.id)).tierIds).toEqual([t.id]);
    const [row] = await db.select().from(tierRequest).where(eq(tierRequest.id, req.id));
    expect(row!.decision).toBe("approved");
    expect(row!.decidedBy).toBe(alice.id);
  });

  it("someone already in the tier can confirm, and a member who isn't cannot", async () => {
    const { community: c, bob, carol } = await withAdmin();
    const t = await manualTier(c.id);
    const [dave] = await db
      .insert(member)
      .values({ communityId: c.id, name: "Dave", tierIds: [t.id] })
      .returning();
    const req = await requestTier(bob, t.id);

    // Carol holds nothing and is not an Admin.
    await expect(decideTierRequest(carol, req.id, "approved")).rejects.toThrow(ForbiddenError);
    expect((await fresh(bob.id)).tierIds).toEqual([]);

    await decideTierRequest(dave, req.id, "approved");
    expect((await fresh(bob.id)).tierIds).toEqual([t.id]);
  });

  it("a holder cannot confirm their own request, but an Admin can", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);

    // Bob is in tier A and (somehow) has a pending request for it: a holder
    // may never be the one to decide their own.
    await db.update(member).set({ tierIds: [t.id] }).where(eq(member.id, bob.id));
    const [own] = await db.insert(tierRequest).values({ memberId: bob.id, tierId: t.id }).returning();
    await expect(decideTierRequest(await fresh(bob.id), own.id, "approved")).rejects.toThrow(ForbiddenError);

    // An Admin asking for a tier can confirm it themselves: they could
    // already redefine the tier and who may hold it, so a second signature
    // would only lock a one-Admin community out of its own tiers.
    const t2 = await manualTier(c.id, "Organisers");
    const adminReq = await requestTier(alice, t2.id);
    await decideTierRequest(alice, adminReq.id, "approved");
    expect((await fresh(alice.id)).tierIds).toContain(t2.id);
  });

  it("declining leaves the member without the tier, tells them, and lets them ask again", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const req = await requestTier(bob, t.id);

    await decideTierRequest(alice, req.id, "declined");
    expect((await fresh(bob.id)).tierIds).toEqual([]);
    expect((await listOwnTierRequestStates(bob)).get(t.id)?.status).toBe("declined");

    await requestTier(bob, t.id);
    expect((await listOwnTierRequestStates(bob)).get(t.id)?.status).toBe("pending");
  });

  it("is decided once, however many people press the button", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const req = await requestTier(bob, t.id);

    await decideTierRequest(alice, req.id, "approved");
    await expect(decideTierRequest(alice, req.id, "declined")).rejects.toThrow(/already been decided/);
    expect((await fresh(bob.id)).tierIds).toEqual([t.id]);
  });

  it("will not decide a request belonging to another community", async () => {
    const { community: c, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const req = await requestTier(bob, t.id);
    const other = await createFixtures();
    await expect(decideTierRequest(other.alice, req.id, "approved")).rejects.toThrow(NotFoundError);
  });
});

describe("who is asked to confirm", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("an Admin sees every pending request; a holder sees only their own tiers; nobody else sees any", async () => {
    const { community: c, alice, bob, carol } = await withAdmin();
    const a = await manualTier(c.id, "A");
    const b = await manualTier(c.id, "B");
    const [dave] = await db.insert(member).values({ communityId: c.id, name: "Dave", tierIds: [a.id] }).returning();
    await requestTier(bob, a.id);
    await requestTier(carol, b.id);

    expect((await listTierRequestsToConfirm(alice)).map((r) => r.tierName).sort()).toEqual(["A", "B"]);
    expect((await listTierRequestsToConfirm(dave)).map((r) => r.tierName)).toEqual(["A"]);
    expect(await listTierRequestsToConfirm(bob)).toEqual([]);
  });

  it("does not offer a holder their own request", async () => {
    const { community: c, bob } = await withAdmin();
    const a = await manualTier(c.id, "A");
    await db.update(member).set({ tierIds: [a.id] }).where(eq(member.id, bob.id));
    await db.insert(tierRequest).values({ memberId: bob.id, tierId: a.id });
    expect(await listTierRequestsToConfirm(await fresh(bob.id))).toEqual([]);
  });
});

describe("leaving", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("leaving a tier needs nobody's confirmation", async () => {
    const { community: c, bob } = await withAdmin();
    const t = await manualTier(c.id);
    await db.update(member).set({ tierIds: [t.id] }).where(eq(member.id, bob.id));
    await leaveTier(await fresh(bob.id), t.id);
    expect((await fresh(bob.id)).tierIds).toEqual([]);
  });

  it("a member who leaves the community takes their pending requests with them", async () => {
    const { community: c, alice, bob } = await withAdmin();
    const t = await manualTier(c.id);
    const decided = await requestTier(bob, t.id);
    await decideTierRequest(alice, decided.id, "declined");
    await requestTier(bob, t.id);

    await anonymiseMember(await fresh(bob.id), { keepName: false });

    const rows = await db.select().from(tierRequest).where(eq(tierRequest.memberId, bob.id));
    // The decided row stays as the record of who answered whom; the pending one is gone.
    expect(rows.map((r) => r.decision)).toEqual(["declined"]);
  });
});

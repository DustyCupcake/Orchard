import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, communityInvite, member, memberIdentity, task } from "@/db/schema";
import { updateCommunity } from "@/lib/settings";
import { claimAsShadow, claimTask } from "@/lib/tasks";
import { findOrCreateMemberByEmail } from "@/lib/member";
import {
  claimInquiry,
  communityInviteStatus,
  createCommunityInvite,
  isRecruitmentTaskHolder,
  listInquiries,
  listMyCommunityInvites,
  redeemCommunityInvite,
  resolveInquiry,
  revokeCommunityInvite,
  submitInquiry,
} from "@/lib/recruitment";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableRecruitment(communityId: string) {
  const [row] = await db.select().from(community).where(eq(community.id, communityId));
  await db
    .update(community)
    .set({ modulesEnabled: [...row.modulesEnabled, "recruitment"] })
    .where(eq(community.id, communityId));
}

async function insertTask(
  communityId: string,
  branchId: string,
  createdBy: string,
  overrides: Partial<typeof task.$inferInsert> = {},
) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Recruitment task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("createCommunityInvite / listMyCommunityInvites", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects when the recruitment module is off", async () => {
    const { alice } = await createFixtures();
    await expect(createCommunityInvite(alice, {})).rejects.toThrow(AppError);
  });

  it("creates a single-use invite with a real token and the given checkboxes", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);

    const invite = await createCommunityInvite(alice, {
      label: "For Dana",
      inviterThinksGoodFit: true,
      inviterKnowsPersonally: false,
    });
    expect(invite.token).toBeTruthy();
    expect(invite.label).toBe("For Dana");
    expect(invite.inviterThinksGoodFit).toBe(true);
    expect(invite.inviterKnowsPersonally).toBe(false);
    expect(invite.redeemedAt).toBeNull();
    expect(invite.revokedAt).toBeNull();
  });

  it("scopes the list to the creator's own invites within their community", async () => {
    const { alice, bob } = await createFixtures();
    await enableRecruitment(alice.communityId);
    await createCommunityInvite(alice, {});
    await createCommunityInvite(bob, {});

    const { alice: strangerAlice } = await createFixtures();
    await enableRecruitment(strangerAlice.communityId);
    await createCommunityInvite(strangerAlice, {});

    const aliceInvites = await listMyCommunityInvites(alice);
    expect(aliceInvites).toHaveLength(1);
    const bobInvites = await listMyCommunityInvites(bob);
    expect(bobInvites).toHaveLength(1);
  });
});

describe("revokeCommunityInvite", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("lets only the creator revoke, and marks revokedAt", async () => {
    const { alice, bob } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});

    await expect(revokeCommunityInvite(bob, invite.id)).rejects.toThrow(ForbiddenError);

    const revoked = await revokeCommunityInvite(alice, invite.id);
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("rejects revoking an invite that's already redeemed", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await redeemCommunityInvite(invite.token, { email: "newperson@example.com" });

    await expect(revokeCommunityInvite(alice, invite.id)).rejects.toThrow(ConflictError);
  });

  it("rejects revoking an already-revoked invite", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await revokeCommunityInvite(alice, invite.id);

    await expect(revokeCommunityInvite(alice, invite.id)).rejects.toThrow(ConflictError);
  });

  it("rejects revoking a nonexistent invite", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    await expect(
      revokeCommunityInvite(alice, "00000000-0000-0000-0000-000000000000"),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("communityInviteStatus", () => {
  it("derives not_found/valid/redeemed/revoked/expired correctly", () => {
    expect(communityInviteStatus(undefined)).toBe("not_found");

    const base = {
      id: "x",
      communityId: "x",
      createdBy: "x",
      token: "x",
      label: null,
      inviterThinksGoodFit: false,
      inviterKnowsPersonally: false,
      expiresAt: null,
      revokedAt: null,
      redeemedAt: null,
      redeemedByMemberId: null,
      createdAt: new Date(),
    };
    expect(communityInviteStatus(base)).toBe("valid");
    expect(communityInviteStatus({ ...base, redeemedAt: new Date() })).toBe("redeemed");
    expect(communityInviteStatus({ ...base, revokedAt: new Date() })).toBe("revoked");
    expect(communityInviteStatus({ ...base, expiresAt: new Date(Date.now() - 1000) })).toBe("expired");
    expect(communityInviteStatus({ ...base, expiresAt: new Date(Date.now() + 1000) })).toBe("valid");
  });
});

describe("redeemCommunityInvite", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a Member with referredByMemberId/joinedViaInviteId set, and marks the invite redeemed", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});

    const newMember = await redeemCommunityInvite(invite.token, { email: "dana@example.com" });
    expect(newMember.communityId).toBe(alice.communityId);
    expect(newMember.referredByMemberId).toBe(alice.id);
    expect(newMember.joinedViaInviteId).toBe(invite.id);
    expect(newMember.name).toBe("dana");

    const [identity] = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.memberId, newMember.id));
    expect(identity.provider).toBe("magic_link");
    expect(identity.loginEmail).toBe("dana@example.com");

    const [updatedInvite] = await db.select().from(communityInvite).where(eq(communityInvite.id, invite.id));
    expect(updatedInvite.redeemedAt).not.toBeNull();
    expect(updatedInvite.redeemedByMemberId).toBe(newMember.id);
  });

  it("rejects a token that doesn't exist", async () => {
    await expect(redeemCommunityInvite("garbage-token", { email: "dana@example.com" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects redeeming twice", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await redeemCommunityInvite(invite.token, { email: "dana@example.com" });

    await expect(redeemCommunityInvite(invite.token, { email: "someoneelse@example.com" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects a revoked invite", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await revokeCommunityInvite(alice, invite.id);

    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects an expired invite", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, { expiresAt: new Date(Date.now() + 1000).toISOString() });
    await db
      .update(communityInvite)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(communityInvite.id, invite.id));

    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects when the email already belongs to an existing member", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "magic_link",
      loginEmail: "alice@example.com",
    });

    await expect(redeemCommunityInvite(invite.token, { email: "alice@example.com" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects if the recruitment module gets turned off after the invite was created", async () => {
    const { alice } = await createFixtures();
    await enableRecruitment(alice.communityId);
    const invite = await createCommunityInvite(alice, {});
    await updateCommunity(alice, { modulesEnabled: [] });

    await expect(redeemCommunityInvite(invite.token, { email: "dana@example.com" })).rejects.toThrow(AppError);
  });
});

describe("findOrCreateMemberByEmail: Recruitment gating (Phase 32)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("still auto-creates a Member for an unrecognized email when Recruitment is off (the open-door default)", async () => {
    const { community: testCommunity } = await createFixtures();
    const created = await findOrCreateMemberByEmail(testCommunity, "newperson@example.com");
    expect(created).not.toBeNull();
    expect(created!.communityId).toBe(testCommunity.id);
  });

  it("returns null for an unrecognized email once Recruitment is on", async () => {
    const { community: testCommunity } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    const [refetched] = await db.select().from(community).where(eq(community.id, testCommunity.id));

    const result = await findOrCreateMemberByEmail(refetched, "newperson@example.com");
    expect(result).toBeNull();
  });

  it("an existing member still logs in exactly as before, module on or off", async () => {
    const { community: testCommunity, alice } = await createFixtures();
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "magic_link",
      loginEmail: "alice@example.com",
    });
    await enableRecruitment(testCommunity.id);
    const [refetched] = await db.select().from(community).where(eq(community.id, testCommunity.id));

    const result = await findOrCreateMemberByEmail(refetched, "alice@example.com");
    expect(result!.id).toBe(alice.id);
  });
});

describe("isRecruitmentTaskHolder", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false when no recruitment task is designated", async () => {
    const { alice } = await createFixtures();
    expect(await isRecruitmentTaskHolder(alice)).toBe(false);
  });

  it("is true only for whoever currently holds the designated task, real claims only", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    const [refetchedBob] = await db.select().from(member).where(eq(member.id, bob.id));

    expect(await isRecruitmentTaskHolder(refetchedAlice)).toBe(false);
    expect(await isRecruitmentTaskHolder(refetchedBob)).toBe(false);

    await claimTask(refetchedAlice, t.id);
    expect(await isRecruitmentTaskHolder(refetchedAlice)).toBe(true);
    expect(await isRecruitmentTaskHolder(refetchedBob)).toBe(false);
  });

  it("a shadow claim doesn't count as holding it", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    await claimTask(alice, t.id);
    await claimAsShadow(bob, t.id);

    expect(await isRecruitmentTaskHolder(bob)).toBe(false);
  });
});

describe("Inquiry: submit/list/claim/resolve", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects submitting when the recruitment module is off", async () => {
    const { community: testCommunity } = await createFixtures();
    await expect(
      submitInquiry(testCommunity.id, { message: "Hi!", contactInfo: "hi@example.com" }),
    ).rejects.toThrow(AppError);
  });

  it("creates a real, unclaimed inquiry once the module is on", async () => {
    const { community: testCommunity } = await createFixtures();
    await enableRecruitment(testCommunity.id);

    const created = await submitInquiry(testCommunity.id, { message: "Hi!", contactInfo: "hi@example.com" });
    expect(created.message).toBe("Hi!");
    expect(created.claimedBy).toBeNull();
    expect(created.resolvedAt).toBeNull();
  });

  it("listInquiries is gated to the current recruitment-task holder", async () => {
    const { community: testCommunity, alice, branch } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    await submitInquiry(testCommunity.id, { message: "Hi!", contactInfo: "hi@example.com" });

    await expect(listInquiries(alice)).rejects.toThrow(ForbiddenError);

    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    await claimTask(refetchedAlice, t.id);

    const list = await listInquiries(refetchedAlice);
    expect(list).toHaveLength(1);
  });

  it("is community-scoped — a stranger's inquiry never leaks in", async () => {
    const { community: testCommunity, alice, branch } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    await claimTask(refetchedAlice, t.id);

    const { community: strangerCommunity } = await createFixtures();
    await enableRecruitment(strangerCommunity.id);
    await submitInquiry(strangerCommunity.id, { message: "Elsewhere", contactInfo: "x@example.com" });

    expect(await listInquiries(refetchedAlice)).toHaveLength(0);
  });

  it("claiming is holder-gated and rejects a double-claim", async () => {
    const { community: testCommunity, alice, bob, branch } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    const created = await submitInquiry(testCommunity.id, { message: "Hi!", contactInfo: "hi@example.com" });

    await expect(claimInquiry(alice, created.id)).rejects.toThrow(ForbiddenError);

    const t = await insertTask(testCommunity.id, branch.id, alice.id, { capacity: 2 });
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    const [refetchedBob] = await db.select().from(member).where(eq(member.id, bob.id));
    await claimTask(refetchedAlice, t.id);
    await claimTask(refetchedBob, t.id);

    const claimed = await claimInquiry(refetchedAlice, created.id);
    expect(claimed.claimedBy).toBe(alice.id);

    await expect(claimInquiry(refetchedBob, created.id)).rejects.toThrow(ConflictError);
  });

  it("resolving is holder-gated, works regardless of claim state, and rejects a double-resolve", async () => {
    const { community: testCommunity, alice, branch } = await createFixtures();
    await enableRecruitment(testCommunity.id);
    const created = await submitInquiry(testCommunity.id, { message: "Hi!", contactInfo: "hi@example.com" });

    const t = await insertTask(testCommunity.id, branch.id, alice.id);
    await updateCommunity(alice, { recruitmentTaskId: t.id });
    const [refetchedAlice] = await db.select().from(member).where(eq(member.id, alice.id));
    await claimTask(refetchedAlice, t.id);

    const resolved = await resolveInquiry(refetchedAlice, created.id);
    expect(resolved.resolvedAt).not.toBeNull();
    expect(resolved.claimedBy).toBeNull();

    await expect(resolveInquiry(refetchedAlice, created.id)).rejects.toThrow(ConflictError);
  });
});

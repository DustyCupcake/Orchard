import { afterEach, beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  admission,
  community,
  contactMethod,
  member,
  memberIdentity,
  settingsChange,
  signInSetup,
  taskAssignment,
  unmatchedSignIn,
} from "@/db/schema";
import { createFixtures, grantPermission, insertTask, resetDatabase, setLanes } from "./helpers";
import { startMockZitadel, type MockZitadel } from "./mock-zitadel";
import { admitArrival, createAdmissionArrival } from "@/lib/recruitment";
import { anonymiseMember } from "@/lib/members/leave";
import { resolveOidcSignIn } from "@/lib/sign-in/resolve";
import { listUnmatchedSignIns, linkSignInToMember, turnAwaySignIn } from "@/lib/sign-in/unmatched";
import { listSignInTodos, markSignInSetUp, provisionSignIn, retrySignInSetup } from "@/lib/sign-in/provision";
import { describeMemberRemoval, removeEmptyMember } from "@/lib/sign-in/remove-member";
import { zitadelConfigFor } from "@/lib/zitadel";
import { ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";

// docs/admission-flow.md §6a. Two things are tested separately because they fail separately:
// whether a sign-in at the provider becomes the right member (never a duplicate, never a
// takeover on an unproven address), and whether admitting somebody gives them an account
// there. The provider is a stand-in that answers as the real tenant did in the spikes.

const memberOn = async (communityId: string, name: string, email: string) => {
  const [m] = await db.insert(member).values({ communityId, name }).returning();
  await db.insert(memberIdentity).values({ memberId: m.id, provider: "magic_link", loginEmail: email });
  return m;
};

const claims = (over: Partial<Parameters<typeof resolveOidcSignIn>[1]> = {}) => ({
  sub: "sub-1",
  email: "dana@example.com",
  emailVerified: true as boolean | null,
  nickname: null,
  givenName: "Dana",
  ...over,
});

async function setUp(opts: { policy?: "anyone_with_role" | "admitted_only"; provision?: boolean; revoke?: boolean } = {}) {
  const fixtures = await createFixtures();
  const [c] = await db
    .update(community)
    .set({
      oidcIssuerUrl: zitadel.url,
      oidcClientId: "client",
      oidcRequiredRole: "orchard",
      ssoJoinPolicy: opts.policy ?? "anyone_with_role",
      ssoCreateOnAdmit: opts.provision ?? false,
      ssoRevokeOnLeave: opts.revoke ?? false,
    })
    .where(eq(community.id, fixtures.community.id))
    .returning();
  return { ...fixtures, community: c };
}

// Admitted through the funnel, the way a recruited person is.
async function admitted(c: typeof community.$inferSelect, email = "dana@example.com", name = "Dana") {
  const [lane] = await setLanes(c.id, [{ name: "Open", kind: "public" }]);
  const { arrival } = await createAdmissionArrival({ communityId: c.id, cycleId: null, email, name, lane, route: "application" });
  const result = await admitArrival(arrival.id, { notify: false });
  if (result.waitlisted) throw new Error("unexpected waitlist");
  const [m] = await db.select().from(member).where(eq(member.id, result.memberId));
  return { arrival, member: m };
}

let zitadel: MockZitadel;
beforeAll(async () => {
  zitadel = await startMockZitadel();
  process.env.ZITADEL_TOKEN = "test-token";
  process.env.ZITADEL_PROJECT_ID = "project-1";
});
afterAll(async () => {
  await zitadel.close();
  delete process.env.ZITADEL_TOKEN;
  delete process.env.ZITADEL_PROJECT_ID;
});
beforeEach(async () => {
  await resetDatabase();
  zitadel.users.length = 0;
  zitadel.grants.length = 0;
  zitadel.calls.length = 0;
  zitadel.failWith = null;
  zitadel.refuseCreate = false;
});

describe("which member a sign-in at the provider is", () => {
  it("is the member it was already linked to, by `sub`", async () => {
    const { community: c } = await setUp();
    const m = await memberOn(c.id, "Dana", "dana@example.com");
    await db.insert(memberIdentity).values({ memberId: m.id, provider: "oidc", providerSubject: "sub-1", loginEmail: "dana@example.com" });
    const result = await resolveOidcSignIn(c, claims());
    expect(result).toMatchObject({ kind: "member", member: { id: m.id } });
  });

  it("links somebody admitted here by the provider's verified address — which is what ends the duplicate", async () => {
    const { community: c } = await setUp();
    const { member: dana } = await admitted(c);
    const result = await resolveOidcSignIn(c, claims());
    expect(result).toMatchObject({ kind: "member", member: { id: dana.id } });
    const ids = await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, dana.id));
    expect(ids.map((i) => i.provider).sort()).toEqual(["magic_link", "oidc"]);
    expect(ids.find((i) => i.provider === "oidc")!.providerSubject).toBe("sub-1");
    // And their next sign-in is just the `sub`.
    expect(await resolveOidcSignIn(c, claims())).toMatchObject({ kind: "member", member: { id: dana.id } });
    expect(await db.select().from(member).where(eq(member.communityId, c.id))).toHaveLength(3); // alice, bob, dana
  });

  it("never links on an address the provider did not confirm, however well it matches", async () => {
    const { community: c } = await setUp();
    const { member: dana } = await admitted(c);
    for (const emailVerified of [false, null]) {
      expect(await resolveOidcSignIn(c, claims({ sub: `s-${emailVerified}`, emailVerified }))).toEqual({ kind: "held" });
    }
    const [held] = await db.select().from(unmatchedSignIn).where(eq(unmatchedSignIn.providerSubject, "s-false"));
    expect(held.suggestedMemberId).toBe(dana.id);
    expect(await db.select().from(memberIdentity).where(and(eq(memberIdentity.memberId, dana.id), eq(memberIdentity.provider, "oidc")))).toHaveLength(0);
  });

  it("does not link a member who was not admitted here (a founder, an import) on the address alone — it holds them with that member suggested", async () => {
    const { community: c } = await setUp();
    const founder = await memberOn(c.id, "Founder", "dana@example.com");
    expect(await resolveOidcSignIn(c, claims())).toEqual({ kind: "held" });
    const [held] = await db.select().from(unmatchedSignIn);
    expect(held).toMatchObject({ suggestedMemberId: founder.id, emailVerified: true });
    // No second member was made for them.
    expect(await db.select().from(member).where(eq(member.communityId, c.id))).toHaveLength(3);
  });

  it("makes a member for somebody nobody has, when the community lets anyone with the role in", async () => {
    const { community: c } = await setUp({ policy: "anyone_with_role" });
    const result = await resolveOidcSignIn(c, claims({ email: "new@example.com" }));
    expect(result.kind).toBe("member");
    expect(await db.select().from(unmatchedSignIn)).toHaveLength(0);
  });

  it("holds them instead, when the community only lets admitted people in", async () => {
    const { community: c } = await setUp({ policy: "admitted_only" });
    expect(await resolveOidcSignIn(c, claims({ email: "new@example.com" }))).toEqual({ kind: "held" });
    expect(await db.select().from(member).where(eq(member.communityId, c.id))).toHaveLength(2);
  });

  it("is one held row however often they try, and stays turned away once turned away", async () => {
    const { community: c, alice } = await setUp({ policy: "admitted_only" });
    await resolveOidcSignIn(c, claims());
    await resolveOidcSignIn(c, claims());
    const [held] = await db.select().from(unmatchedSignIn);
    expect(held).toBeTruthy();
    expect(await db.select().from(unmatchedSignIn)).toHaveLength(1);
    await turnAwaySignIn(alice, held.id);
    expect(await resolveOidcSignIn(c, claims())).toEqual({ kind: "turned_away" });
  });
});

describe("an administrator dealing with a held sign-in", () => {
  it("connects it to the member it really is, even when the addresses differ", async () => {
    const { community: c, alice } = await setUp({ policy: "admitted_only" });
    const dana = await memberOn(c.id, "Dana", "dana@home.example");
    await resolveOidcSignIn(c, claims({ email: "dana@work.example" }));
    const [held] = await listUnmatchedSignIns(alice);
    await linkSignInToMember(alice, held.id, dana.id);

    expect(await resolveOidcSignIn(c, claims({ email: "dana@work.example" }))).toMatchObject({ kind: "member", member: { id: dana.id } });
    expect(await listUnmatchedSignIns(alice)).toHaveLength(0);
    const log = await db.select().from(settingsChange).where(eq(settingsChange.action, "linked_sign_in"));
    expect(log).toHaveLength(1);
  });

  it("refuses a member who already has a provider account, a stranger's member, and anyone's second go", async () => {
    const { community: c, alice } = await setUp({ policy: "admitted_only" });
    const dana = await memberOn(c.id, "Dana", "dana@example.com");
    await db.insert(memberIdentity).values({ memberId: dana.id, provider: "oidc", providerSubject: "other", loginEmail: "other@example.com" });
    await resolveOidcSignIn(c, claims({ sub: "s2", email: "x@example.com" }));
    const [held] = await listUnmatchedSignIns(alice);
    await expect(linkSignInToMember(alice, held.id, dana.id)).rejects.toThrow(ConflictError);
    const { alice: stranger } = await createFixtures();
    await expect(linkSignInToMember(stranger, held.id, dana.id)).rejects.toThrow(NotFoundError);
    const erin = await memberOn(c.id, "Erin", "erin@example.com");
    await linkSignInToMember(alice, held.id, erin.id);
    await expect(linkSignInToMember(alice, held.id, erin.id)).rejects.toThrow(/already been dealt with/);
  });
});

describe("giving an admitted person an account at the provider", () => {
  it("does nothing, and says nothing, when the community hasn't asked for it", async () => {
    const { community: c } = await setUp({ provision: false });
    const { member: dana } = await admitted(c);
    expect(await db.select().from(signInSetup)).toHaveLength(0);
    expect(zitadel.calls).toHaveLength(0);
    void dana;
  });

  it("creates the person, has the provider invite them, grants the role, and links the member by `sub`", async () => {
    const { community: c } = await setUp({ provision: true });
    const { member: dana } = await admitted(c);

    expect(zitadel.users).toHaveLength(1);
    expect(zitadel.users[0]).toMatchObject({ email: "dana@example.com", invited: true });
    expect(zitadel.grants).toEqual([expect.objectContaining({ userId: zitadel.users[0].id, projectId: "project-1", roleKeys: ["orchard"] })]);
    const [setup] = await db.select().from(signInSetup).where(eq(signInSetup.memberId, dana.id));
    expect(setup).toMatchObject({ status: "done", providerUserId: zitadel.users[0].id, lastError: null });
    const [identity] = await db.select().from(memberIdentity).where(and(eq(memberIdentity.memberId, dana.id), eq(memberIdentity.provider, "oidc")));
    expect(identity.providerSubject).toBe(zitadel.users[0].id);
    // Their first sign-in is that member, with nothing to match on.
    expect(await resolveOidcSignIn(c, claims({ sub: zitadel.users[0].id }))).toMatchObject({ kind: "member", member: { id: dana.id } });
  });

  it("finds a person who already has an account instead of making a second, and doesn't email them again", async () => {
    const { community: c } = await setUp({ provision: true });
    const existing = zitadel.seedUser("Dana@Example.com");
    const { member: dana } = await admitted(c);
    expect(zitadel.users).toHaveLength(1);
    expect(zitadel.users[0].invited).toBe(false);
    expect(zitadel.calls.some((x) => x.endsWith("/v2/users/new"))).toBe(false);
    expect(zitadel.grants).toHaveLength(1);
    const [identity] = await db.select().from(memberIdentity).where(and(eq(memberIdentity.memberId, dana.id), eq(memberIdentity.provider, "oidc")));
    expect(identity.providerSubject).toBe(existing.id);
  });

  it("is safe to run again: the grant that already exists is success, and nothing doubles", async () => {
    const { community: c } = await setUp({ provision: true });
    const { member: dana } = await admitted(c);
    const again = await provisionSignIn(dana.id);
    expect(again.setup).toMatchObject({ status: "done" });
    expect(again.invited).toBe(false);
    expect(zitadel.users).toHaveLength(1);
    expect(zitadel.grants).toHaveLength(1);
    expect(await db.select().from(memberIdentity).where(and(eq(memberIdentity.memberId, dana.id), eq(memberIdentity.provider, "oidc")))).toHaveLength(1);
  });

  it("admits anyway when the provider is down, and the to-do retries it successfully later", async () => {
    const { community: c, alice } = await setUp({ provision: true });
    zitadel.failWith = 503;
    const { arrival, member: dana } = await admitted(c);
    // Admission stood.
    expect((await db.select().from(admission).where(eq(admission.id, arrival.id)))[0].admittedMemberId).toBe(dana.id);
    const [setup] = await db.select().from(signInSetup).where(eq(signInSetup.memberId, dana.id));
    expect(setup).toMatchObject({ status: "pending" });
    expect(setup.lastError).toMatch(/503/);
    expect((await listSignInTodos(alice)).map((t) => t.name)).toEqual(["Dana"]);

    zitadel.failWith = null;
    const retried = await retrySignInSetup(alice, dana.id);
    expect(retried.setup).toMatchObject({ status: "done", attempts: 2 });
    expect(await listSignInTodos(alice)).toHaveLength(0);
  });

  it("marks a refusal it can't fix as needing an administrator, and keeps what the provider said", async () => {
    const { community: c } = await setUp({ provision: true });
    zitadel.refuseCreate = true;
    const { member: dana } = await admitted(c);
    const [setup] = await db.select().from(signInSetup).where(eq(signInSetup.memberId, dana.id));
    expect(setup).toMatchObject({ status: "failed" });
    expect(setup.lastError).toMatch(/invalid account details/);
    expect(setup.lastError).not.toMatch(/test-token/);
  });

  it("says plainly what to do by hand when the service token isn't set, and lets an administrator mark it done", async () => {
    const { community: c, alice } = await setUp({ provision: true });
    const saved = process.env.ZITADEL_TOKEN;
    delete process.env.ZITADEL_TOKEN;
    try {
      const { member: dana } = await admitted(c);
      const [setup] = await db.select().from(signInSetup).where(eq(signInSetup.memberId, dana.id));
      expect(setup).toMatchObject({ status: "failed" });
      expect(setup.lastError).toMatch(/by hand/);
      expect(zitadel.calls).toHaveLength(0);
      await markSignInSetUp(alice, dana.id);
      expect((await db.select().from(signInSetup).where(eq(signInSetup.memberId, dana.id)))[0].status).toBe("done");
      await expect(markSignInSetUp(alice, dana.id)).rejects.toThrow(ConflictError);
    } finally {
      process.env.ZITADEL_TOKEN = saved;
    }
  });

  it("only calls the paths that exist on a real tenant, and never puts the token where it could be stored", async () => {
    const { community: c } = await setUp({ provision: true });
    await admitted(c);
    expect(zitadel.calls.some((x) => x.includes("/v2/authorizations"))).toBe(false);
    expect(zitadelConfigFor({ ...c, oidcIssuerUrl: null })).toBeNull();
    expect(zitadelConfigFor(c)).toMatchObject({ baseUrl: zitadel.url, roleKey: "orchard", projectId: "project-1" });
  });
});

describe("leaving closes the door", () => {
  afterEach(() => {
    zitadel.failWith = null;
  });

  async function leaving(revoke: boolean) {
    const { community: c } = await setUp({ provision: true, revoke });
    const { member: dana } = await admitted(c);
    expect(zitadel.grants).toHaveLength(1);
    return dana;
  }

  it("takes the role back when the community asked for that", async () => {
    const dana = await leaving(true);
    const result = await anonymiseMember(dana, { keepName: false });
    expect(result.signInRevoked).toBe(true);
    expect(zitadel.grants).toHaveLength(0);
  });

  it("leaves the role alone when it didn't", async () => {
    const dana = await leaving(false);
    const result = await anonymiseMember(dana, { keepName: false });
    expect(result.signInRevoked).toBeNull();
    expect(zitadel.grants).toHaveLength(1);
  });

  it("still lets them leave when the provider is down, and says it didn't go through", async () => {
    const dana = await leaving(true);
    zitadel.failWith = 503;
    const result = await anonymiseMember(dana, { keepName: false });
    expect(result.signInRevoked).toBe(false);
    expect((await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, dana.id)))).toHaveLength(0);
  });
});

describe("removing a member who has nothing to their name", () => {
  it("deletes the member and what was only about them", async () => {
    const { community: c, alice } = await setUp();
    const dup = await memberOn(c.id, "Duplicate", "dup@example.com");
    await db.insert(contactMethod).values({ memberId: dup.id, type: "email", value: "dup@example.com", isPrimary: true });

    expect((await describeMemberRemoval(alice, dup.id)).blockers).toEqual([]);
    expect(await removeEmptyMember(alice, dup.id)).toEqual({ removed: "Duplicate" });

    expect(await db.select().from(member).where(eq(member.id, dup.id))).toHaveLength(0);
    expect(await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, dup.id))).toHaveLength(0);
    const log = await db.select().from(settingsChange).where(eq(settingsChange.action, "removed_empty_member"));
    expect(log).toHaveLength(1);
    expect(log[0].entityLabel).toBe("Duplicate");
  });

  it("refuses a member who holds a task, names it, and leaves them exactly as they were", async () => {
    const { community: c, alice, branch } = await setUp();
    const busy = await memberOn(c.id, "Busy", "busy@example.com");
    const t = await insertTask(c.id, branch.id, alice.id, { capacity: 2 });
    await db.insert(taskAssignment).values({ taskId: t.id, memberId: busy.id });

    const described = await describeMemberRemoval(alice, busy.id);
    expect(described.blockers).toEqual([{ table: "task_assignment", column: "member_id", count: 1 }]);
    await expect(removeEmptyMember(alice, busy.id)).rejects.toThrow(/can't be removed: they still have 1 in task assignment/);
    // Nothing was deleted on the way to refusing.
    expect(await db.select().from(member).where(eq(member.id, busy.id))).toHaveLength(1);
    expect(await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, busy.id))).toHaveLength(1);
  });

  it("refuses somebody the funnel admitted, because the arrival is its history", async () => {
    const { community: c, alice } = await setUp();
    const { member: dana } = await admitted(c);
    await expect(removeEmptyMember(alice, dana.id)).rejects.toThrow(/admission/);
  });

  it("refuses somebody another member was referred by, and a member who made a setting change", async () => {
    const { community: c, alice } = await setUp();
    const referrer = await memberOn(c.id, "Referrer", "r@example.com");
    const [friend] = await db.insert(member).values({ communityId: c.id, name: "Friend", referredByMemberId: referrer.id }).returning();
    await expect(removeEmptyMember(alice, referrer.id)).rejects.toThrow(/member/);
    void friend;
    // Alice has changed no setting yet; the removal above wrote none for the refused one.
    expect(await db.select().from(settingsChange).where(eq(settingsChange.action, "removed_empty_member"))).toHaveLength(0);
  });

  it("is for administrators, never yourself, and never another community's members", async () => {
    const { community: c, alice, bob, branch } = await setUp();
    const admins = await insertTask(c.id, branch.id, alice.id, { capacity: 1, openness: "community_endorsed" });
    await grantPermission(c.id, "admin", admins.id);
    await db.insert(taskAssignment).values({ taskId: admins.id, memberId: alice.id });
    await db.update(community).set({ adminsEverClaimed: true }).where(eq(community.id, c.id));
    const dup = await memberOn(c.id, "Duplicate", "dup@example.com");

    await expect(removeEmptyMember(bob, dup.id)).rejects.toThrow(ForbiddenError);
    await expect(removeEmptyMember(alice, alice.id)).rejects.toThrow(/can't remove yourself/);
    const other = await createFixtures();
    await expect(removeEmptyMember(alice, other.bob.id)).rejects.toThrow(NotFoundError);
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, memberIdentity } from "@/db/schema";
import { findOrCreateMemberByOidcSubject } from "@/lib/member";
import {
  buildOidcAuthorizationUrl,
  handleOidcCallback,
  hasRequiredRole,
  isOidcConfigured,
} from "@/lib/oidc";
import { createFixtures, resetDatabase } from "./helpers";
import { startMockOidcProvider, type MockOidcProvider } from "./mock-oidc";

describe("isOidcConfigured", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is false when nothing is configured", async () => {
    const { community: testCommunity } = await createFixtures();
    expect(isOidcConfigured(testCommunity)).toBe(false);
  });

  it("is false when only some of the three fields are set", async () => {
    const { community: testCommunity } = await createFixtures();
    const [partial] = await db
      .update(community)
      .set({ oidcIssuerUrl: "https://example.zitadel.cloud", oidcClientId: "abc" })
      .where(eq(community.id, testCommunity.id))
      .returning();
    expect(isOidcConfigured(partial)).toBe(false);
  });

  it("is true once issuer, client id, and required role are all set", async () => {
    const { community: testCommunity } = await createFixtures();
    const [configured] = await db
      .update(community)
      .set({
        oidcIssuerUrl: "https://example.zitadel.cloud",
        oidcClientId: "abc",
        oidcRequiredRole: "orchard_user",
      })
      .where(eq(community.id, testCommunity.id))
      .returning();
    expect(isOidcConfigured(configured)).toBe(true);
  });
});

describe("hasRequiredRole", () => {
  it("is false when no role is required", () => {
    expect(hasRequiredRole({ "urn:zitadel:iam:org:project:roles": { orchard_user: {} } }, null)).toBe(false);
  });

  it("is false when the claim is missing entirely", () => {
    expect(hasRequiredRole({}, "orchard_user")).toBe(false);
  });

  it("is false when the claim isn't an object", () => {
    expect(hasRequiredRole({ "urn:zitadel:iam:org:project:roles": "not-an-object" }, "orchard_user")).toBe(
      false,
    );
  });

  it("is true when the required role is a top-level key of the roles claim", () => {
    expect(
      hasRequiredRole(
        { "urn:zitadel:iam:org:project:roles": { orchard_user: { "org-1": "The Pit" } } },
        "orchard_user",
      ),
    ).toBe(true);
  });

  it("is false when the role claim exists but lacks the required role", () => {
    expect(
      hasRequiredRole({ "urn:zitadel:iam:org:project:roles": { some_other_role: {} } }, "orchard_user"),
    ).toBe(false);
  });
});

describe("findOrCreateMemberByOidcSubject", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a new Member + oidc MemberIdentity on first login", async () => {
    const { community: testCommunity } = await createFixtures();
    const created = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-1",
      emailVerified: true,
      email: "carol@example.com",
      nickname: "Carol",
      givenName: "Carol",
    });
    expect(created.name).toBe("Carol");

    const [identity] = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.memberId, created.id));
    expect(identity.provider).toBe("oidc");
    expect(identity.providerSubject).toBe("zitadel-sub-1");
    expect(identity.loginEmail).toBe("carol@example.com");
  });

  // The nickname chain is the whole point of the change, so each step gets
  // its own test rather than one "resolves a name" test that would pass
  // under any of three orders.
  it("prefers the IdP's nickname over the given name", async () => {
    const { community: testCommunity } = await createFixtures();
    const created = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-nick",
      emailVerified: true,
      email: "sam@example.com",
      nickname: "Sam",
      givenName: "Samuel",
    });
    expect(created.name).toBe("Sam");
  });

  it("falls back to the given name when there is no nickname", async () => {
    const { community: testCommunity } = await createFixtures();
    const created = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-given",
      emailVerified: true,
      email: "dave@example.com",
      nickname: null,
      givenName: "Dave",
    });
    expect(created.name).toBe("Dave");
  });

  it("falls back to the email's local part when neither name claim is given", async () => {
    const { community: testCommunity } = await createFixtures();
    const created = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-2",
      emailVerified: true,
      email: "dave@example.com",
      nickname: null,
      givenName: null,
    });
    expect(created.name).toBe("dave");
  });

  it("resolves to the same Member on a second login with the same sub", async () => {
    const { community: testCommunity } = await createFixtures();
    const first = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-3",
      emailVerified: true,
      email: "erin@example.com",
      nickname: "Erin",
      givenName: null,
    });
    const second = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-3",
      emailVerified: true,
      email: "erin@example.com",
      nickname: "Erin",
      givenName: null,
    });
    expect(second.id).toBe(first.id);

    const identities = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.memberId, first.id));
    expect(identities.length).toBe(1);
  });

  it("updates loginEmail in place when the IdP's email drifts, keeping the sub-keyed identity", async () => {
    const { community: testCommunity } = await createFixtures();
    const first = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-4",
      emailVerified: true,
      email: "old-address@example.com",
      nickname: "Frank",
      givenName: null,
    });
    const second = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-4",
      emailVerified: true,
      email: "new-address@example.com",
      nickname: "Frank",
      givenName: null,
    });
    expect(second.id).toBe(first.id);

    const [identity] = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.memberId, first.id));
    expect(identity.loginEmail).toBe("new-address@example.com");
  });

  it("never merges with a pre-existing magic_link identity sharing the same email — creates a distinct Member", async () => {
    const { community: testCommunity } = await createFixtures();
    const [magicLinkMember] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Grace" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: magicLinkMember.id,
      provider: "magic_link",
      loginEmail: "grace@example.com",
    });

    const oidcMember = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: "zitadel-sub-5",
      emailVerified: true,
      email: "grace@example.com",
      nickname: "Grace",
      givenName: null,
    });

    expect(oidcMember.id).not.toBe(magicLinkMember.id);
    const allMembersNamedGrace = await db
      .select()
      .from(member)
      .where(eq(member.communityId, testCommunity.id));
    expect(allMembersNamedGrace.filter((m) => m.name === "Grace").length).toBe(2);
  });
});

describe("OIDC authorization-code flow against a real mock provider", () => {
  let mockIdp: MockOidcProvider;

  beforeEach(async () => {
    await resetDatabase();
    mockIdp = await startMockOidcProvider();
  });

  afterEach(async () => {
    await mockIdp.close();
  });

  async function configuredCommunity(requiredRole = "orchard_user") {
    const { community: testCommunity } = await createFixtures();
    const [configured] = await db
      .update(community)
      .set({
        oidcIssuerUrl: mockIdp.issuerUrl,
        oidcClientId: mockIdp.clientId,
        oidcRequiredRole: requiredRole,
      })
      .where(eq(community.id, testCommunity.id))
      .returning();
    return configured;
  }

  it("resolves a real signed ID token end to end, confirming the required role", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";

    const { url, state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);
    expect(url.searchParams.get("client_id")).toBe(mockIdp.clientId);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");

    const code = mockIdp.prepareLogin({
      sub: "zitadel-sub-100",
      email: "holder@example.com",
      nonce,
      roles: { orchard_user: { "org-1": "The Pit" } },
    });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);

    const result = await handleOidcCallback(testCommunity, callbackUrl, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    expect(result.sub).toBe("zitadel-sub-100");
    expect(result.email).toBe("holder@example.com");
    expect(result.hasRequiredRole).toBe(true);
  });

  // These three run against the real signed-token path rather than by
  // passing claims straight to the lib, because the claim *shape* is the
  // thing most likely to break: Zitadel sends an empty nickname rather
  // than omitting it, and the previous code read a `name` claim this
  // doesn't request any more.
  it("reads nickname and given_name off a real ID token", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    const code = mockIdp.prepareLogin({
      sub: "zitadel-sub-nick-e2e",
      email: "nick@example.com",
      nonce,
      nickname: "Nicky",
      givenName: "Nicholas",
    });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);

    const result = await handleOidcCallback(testCommunity, callbackUrl, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    expect(result.nickname).toBe("Nicky");
    expect(result.givenName).toBe("Nicholas");
  });

  it("treats Zitadel's empty nickname claim as absent, not as a name", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    // No `nickname` passed, so the mock sends the empty string a real
    // Zitadel sends for a profile where nobody set one. `given_name` is
    // there precisely so a null nickname can't be mistaken for "no
    // profile claims at all".
    const code = mockIdp.prepareLogin({
      sub: "zitadel-sub-empty-nick",
      email: "givenonly@example.com",
      nonce,
      givenName: "Gina",
    });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);

    const result = await handleOidcCallback(testCommunity, callbackUrl, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    expect(result.nickname).toBeNull();
    expect(result.givenName).toBe("Gina");
  });

  it("ignores the full-name claim entirely, so a nickname is never shadowed by one", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    const code = mockIdp.prepareLogin({
      sub: "zitadel-sub-name-shadow",
      email: "shadow@example.com",
      nonce,
      name: "Toby Whitfield",
      nickname: "Toby",
    });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);

    const result = await handleOidcCallback(testCommunity, callbackUrl, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    const created = await findOrCreateMemberByOidcSubject(testCommunity, {
      sub: result.sub,
      email: result.email,
      emailVerified: result.emailVerified,
      nickname: result.nickname,
      givenName: result.givenName,
    });
    expect(created.name).toBe("Toby");
  });

  it("resolves the identity but reports no required role when the token lacks it", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    const code = mockIdp.prepareLogin({
      sub: "zitadel-sub-101",
      email: "no-role@example.com",
      nonce,
      roles: { some_other_role: {} },
    });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);

    const result = await handleOidcCallback(testCommunity, callbackUrl, {
      expectedState: state,
      expectedNonce: nonce,
      pkceCodeVerifier: codeVerifier,
    });

    expect(result.hasRequiredRole).toBe(false);
  });

  it("rejects a callback whose state doesn't match what was issued", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    const code = mockIdp.prepareLogin({ sub: "zitadel-sub-102", email: "x@example.com", nonce });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=tampered-state`);

    await expect(
      handleOidcCallback(testCommunity, callbackUrl, {
        expectedState: state,
        expectedNonce: nonce,
        pkceCodeVerifier: codeVerifier,
      }),
    ).rejects.toThrow();
  });

  it("rejects redeeming the same authorization code twice", async () => {
    const testCommunity = await configuredCommunity();
    const redirectUri = "http://localhost:3000/api/auth/oidc/callback";
    const { state, nonce, codeVerifier } = await buildOidcAuthorizationUrl(testCommunity, redirectUri);

    const code = mockIdp.prepareLogin({ sub: "zitadel-sub-103", email: "y@example.com", nonce });
    const callbackUrl = new URL(`${redirectUri}?code=${code}&state=${state}`);
    const checks = { expectedState: state, expectedNonce: nonce, pkceCodeVerifier: codeVerifier };

    await handleOidcCallback(testCommunity, callbackUrl, checks);
    await expect(handleOidcCallback(testCommunity, callbackUrl, checks)).rejects.toThrow();
  });
});

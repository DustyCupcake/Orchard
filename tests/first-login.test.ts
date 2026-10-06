import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contactMethod, member, memberIdentity } from "@/db/schema";
import { firstLoginDestination, firstLoginDestinationFor, markProfileCompleted } from "@/lib/first-login";
import { verifyOwnContactMethodByValue } from "@/lib/contact-methods";
import { findExistingMemberByLoginEmail } from "@/lib/member";
import { createFixtures, resetDatabase } from "./helpers";

describe("firstLoginDestination", () => {
  // The rule itself is one line; these two are here because both halves of
  // it are load-bearing and a null/undefined mix-up would be invisible.
  it("sends a member who has never been asked to /welcome", () => {
    expect(firstLoginDestination({ profileCompletedAt: null })).toBe("/welcome");
  });

  it("sends a member who has been asked, or has skipped, to the dashboard", () => {
    expect(firstLoginDestination({ profileCompletedAt: new Date() })).toBe("/dashboard");
  });

  // Invite redemption holds a Member *id*, not a row, and an id that
  // resolves to nothing must not produce a redirect to nowhere.
  it("sends an unresolvable id to /welcome rather than nowhere", async () => {
    expect(await firstLoginDestinationFor("00000000-0000-0000-0000-000000000000")).toBe("/welcome");
  });
});

describe("markProfileCompleted", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stamps the member on first call", async () => {
    const { alice } = await createFixtures();
    expect(alice.profileCompletedAt).toBeNull();

    const stamped = await markProfileCompleted(alice.id);
    expect(stamped?.profileCompletedAt).toBeInstanceOf(Date);
  });

  it("does not move the original timestamp when called again", async () => {
    const { alice } = await createFixtures();
    const first = await markProfileCompleted(alice.id, { onlyIfUnset: true });
    expect(first?.profileCompletedAt).toBeInstanceOf(Date);

    // Second call matches no rows (the column is no longer null) and
    // returns null — "nothing was updated", which is the honest answer
    // rather than a fresh timestamp that would rewrite when the member
    // first walked in.
    expect(await markProfileCompleted(alice.id, { onlyIfUnset: true })).toBeNull();

    const [after] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(after.profileCompletedAt?.getTime()).toBe(first?.profileCompletedAt?.getTime());
  });

  it("is what makes skip permanent — a skipped member is not asked again", async () => {
    const { alice } = await createFixtures();
    await markProfileCompleted(alice.id, { onlyIfUnset: true });
    expect(await firstLoginDestinationFor(alice.id)).toBe("/dashboard");
  });
});

describe("verifyOwnContactMethodByValue", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("marks the matching method verified", async () => {
    const { alice } = await createFixtures();
    const [row] = await db
      .insert(contactMethod)
      .values({ memberId: alice.id, type: "email", value: "invitee@example.com", visibility: "emergency_only" })
      .returning();
    expect(row.verifiedAt).toBeNull();

    const updated = await verifyOwnContactMethodByValue(alice.id, "invitee@example.com");
    expect(updated?.verifiedAt).toBeInstanceOf(Date);
  });

  // The security property. The value being matched is an address this app
  // mails a login link to, so it is a string an unauthenticated caller
  // chooses. Scoping to the member is what stops a verified-login for
  // alice@example.com stamping a verdict on bob's method.
  it("never touches another member's method even when the value matches", async () => {
    const { alice, bob } = await createFixtures();
    const [bobs] = await db
      .insert(contactMethod)
      .values({ memberId: bob.id, type: "email", value: "shared@example.com", visibility: "emergency_only" })
      .returning();

    const updated = await verifyOwnContactMethodByValue(alice.id, "shared@example.com");
    expect(updated).toBeNull();

    const [after] = await db.select().from(contactMethod).where(eq(contactMethod.id, bobs.id));
    expect(after.verifiedAt).toBeNull();
  });

  it("is a no-op on an already-verified row rather than moving its timestamp", async () => {
    const { alice } = await createFixtures();
    const [row] = await db
      .insert(contactMethod)
      .values({
        memberId: alice.id,
        type: "email",
        value: "done@example.com",
        visibility: "emergency_only",
        verifiedAt: new Date("2020-01-01"),
      })
      .returning();

    expect(await verifyOwnContactMethodByValue(alice.id, "done@example.com")).toBeNull();
    const [after] = await db.select().from(contactMethod).where(eq(contactMethod.id, row.id));
    expect(after.verifiedAt?.getFullYear()).toBe(2020);
  });
});

describe("a new member is offered first-login setup", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The column default is the entire mechanism. If any of the five
  // provisioning paths had to remember to write it, a sixth one would
  // forget and that member would silently never be asked.
  it("a member row created directly has not been asked", async () => {
    const { community: testCommunity } = await createFixtures();
    const [created] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "someone" })
      .returning();
    expect(created.profileCompletedAt).toBeNull();
    expect(await firstLoginDestinationFor(created.id)).toBe("/welcome");
  });

  it("every member in a fresh community starts unasked", async () => {
    const { community: testCommunity } = await createFixtures();
    const all = await db.select().from(member).where(eq(member.communityId, testCommunity.id));
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) {
      expect(m.profileCompletedAt).toBeNull();
    }
  });
});

describe("findExistingMemberByLoginEmail", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The shared lookup now backing both login and invite redemption, so
  // these three are the cases the two callers must agree on.
  it("finds a member by a magic_link identity", async () => {
    const { alice } = await createFixtures();
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "magic_link",
      loginEmail: "magic@example.com",
    });
    expect((await findExistingMemberByLoginEmail("magic@example.com"))?.id).toBe(alice.id);
  });

  it("finds a member by an OIDC identity", async () => {
    const { alice } = await createFixtures();
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "oidc",
      providerSubject: "sub-1",
      loginEmail: "oidc@example.com",
    });
    expect((await findExistingMemberByLoginEmail("oidc@example.com"))?.id).toBe(alice.id);
  });

  it("finds a member by their primary contact method", async () => {
    const { alice } = await createFixtures();
    await db.insert(contactMethod).values({
      memberId: alice.id,
      type: "email",
      value: "primary@example.com",
      visibility: "emergency_only",
      isPrimary: true,
    });
    expect((await findExistingMemberByLoginEmail("primary@example.com"))?.id).toBe(alice.id);
  });

  it("returns null for an address nobody holds", async () => {
    expect(await findExistingMemberByLoginEmail("nobody@example.com")).toBeNull();
  });
});


import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { contactMethod, memberIdentity, task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import {
  consumeContactMethodVerification,
  createContactMethod,
  deleteContactMethod,
  getVisibleContactMethods,
  isEmailContactMethod,
  isTaskOrGroupMate,
  listOwnContactMethods,
  requestContactMethodVerification,
  resolvePrimaryEmail,
  setPrimaryContactMethod,
  updateContactMethod,
} from "@/lib/contact-methods";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

// The confirmation email is the only thing standing between "a member typed
// an address" and "the community's mail goes there", so the tests that
// exercise verification mock the mailer at that seam rather than asserting
// on a console line the mailer only prints when no SMTP is configured.
vi.mock("@/lib/mailer", async () => {
  const actual = await vi.importActual<typeof import("@/lib/mailer")>("@/lib/mailer");
  return { ...actual, sendEmailVerificationEmail: vi.fn() };
});
import { sendEmailVerificationEmail } from "@/lib/mailer";

/** Mark a row verified the way a clicked link would, without a token. */
async function markVerified(id: string) {
  await db.update(contactMethod).set({ verifiedAt: new Date() }).where(eq(contactMethod.id, id));
}

async function insertTask(communityId: string, branchId: string, createdBy: string, capacity = 1) {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title: "Kitchen crew",
      effort: "owns_a_thing",
      effortMagnitude: { hours_per_week: 2 },
      createdBy,
      capacity,
    })
    .returning();
  return row;
}

describe("contact methods", () => {
  beforeEach(async () => {
    await resetDatabase();
    vi.mocked(sendEmailVerificationEmail).mockClear();
  });

  it("lets a member create, update and delete their own methods", async () => {
    const { alice } = await createFixtures();
    const created = await createContactMethod(alice, { type: "email", value: "alice@example.com", visibility: "everyone" });
    expect(created.memberId).toBe(alice.id);

    const updated = await updateContactMethod(alice, created.id, {
      type: "email",
      value: "alice2@example.com",
      visibility: "task_or_group_mates",
    });
    expect(updated.value).toBe("alice2@example.com");
    expect(updated.visibility).toBe("task_or_group_mates");

    await deleteContactMethod(alice, created.id);
    expect(await listOwnContactMethods(alice)).toHaveLength(0);
  });

  it("rejects editing or deleting someone else's method", async () => {
    const { alice, bob } = await createFixtures();
    const created = await createContactMethod(alice, { type: "phone", value: "555-1234", visibility: "everyone" });

    await expect(
      updateContactMethod(bob, created.id, { type: "phone", value: "hacked", visibility: "everyone" }),
    ).rejects.toThrow(ForbiddenError);
    await expect(deleteContactMethod(bob, created.id)).rejects.toThrow(ForbiddenError);
  });

  it("rejects an update/delete on a nonexistent method", async () => {
    const { alice } = await createFixtures();
    await expect(
      updateContactMethod(alice, crypto.randomUUID(), { type: "phone", value: "x", visibility: "everyone" }),
    ).rejects.toThrow(NotFoundError);
    await expect(deleteContactMethod(alice, crypto.randomUUID())).rejects.toThrow(NotFoundError);
  });

  it("always returns a member's own methods regardless of visibility", async () => {
    const { alice } = await createFixtures();
    await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "emergency_only" });
    const own = await listOwnContactMethods(alice);
    expect(own).toHaveLength(1);
  });

  describe("visibility resolution", () => {
    it("shows 'everyone' methods to any community member", async () => {
      const { alice, bob } = await createFixtures();
      await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });

      const visible = await getVisibleContactMethods(bob, alice.id);
      expect(visible).toHaveLength(1);
      expect(visible[0].value).toBe("a@example.com");
    });

    it("never shows 'emergency_only' methods via the ordinary visibility path", async () => {
      const { alice, bob } = await createFixtures();
      await createContactMethod(alice, { type: "phone", value: "555-0000", visibility: "emergency_only" });

      const visible = await getVisibleContactMethods(bob, alice.id);
      expect(visible).toHaveLength(0);
    });

    it("hides 'task_or_group_mates' methods from an unrelated member", async () => {
      const { alice, bob } = await createFixtures();
      await createContactMethod(alice, { type: "telegram", value: "@alice", visibility: "task_or_group_mates" });

      expect(await isTaskOrGroupMate(bob, alice.id)).toBe(false);
      const visible = await getVisibleContactMethods(bob, alice.id);
      expect(visible).toHaveLength(0);
    });

    it("shows 'task_or_group_mates' methods to a real task-mate (co-assigned to the same task)", async () => {
      const { alice, bob, branch } = await createFixtures();
      await createContactMethod(alice, { type: "telegram", value: "@alice", visibility: "task_or_group_mates" });
      const t = await insertTask(alice.communityId, branch.id, alice.id, 2);
      await claimTask(alice, t.id);
      await claimTask(bob, t.id);

      expect(await isTaskOrGroupMate(bob, alice.id)).toBe(true);
      const visible = await getVisibleContactMethods(bob, alice.id);
      expect(visible).toHaveLength(1);
    });

    it("shows 'task_or_group_mates' methods to a branch-mate holding a different task in the same branch", async () => {
      const { alice, bob, branch } = await createFixtures();
      await createContactMethod(alice, { type: "telegram", value: "@alice", visibility: "task_or_group_mates" });
      const aliceTask = await insertTask(alice.communityId, branch.id, alice.id);
      const bobTask = await insertTask(alice.communityId, branch.id, alice.id);
      await claimTask(alice, aliceTask.id);
      await claimTask(bob, bobTask.id);

      expect(await isTaskOrGroupMate(bob, alice.id)).toBe(true);
      const visible = await getVisibleContactMethods(bob, alice.id);
      expect(visible).toHaveLength(1);
    });
  });

  // The primary address: who mail goes to, and what it takes to point it
  // somewhere. This is the behaviour that didn't exist before 0084 — every
  // send read the login address, and nothing in the UI could see or change
  // it.
  describe("the primary address", () => {
    it("falls back to the login address for a member who hasn't chosen one", async () => {
      const { alice } = await createFixtures();
      await db.insert(memberIdentity).values({
        memberId: alice.id,
        provider: "magic_link",
        loginEmail: "login@example.com",
      });
      expect(await resolvePrimaryEmail(alice.id)).toBe("login@example.com");
    });

    it("resolves nothing at all for a member with no address anywhere", async () => {
      const { alice } = await createFixtures();
      // The one case where "no address" is a real answer rather than a bug,
      // and the reason every call site treats null as skip rather than as
      // "send to undefined".
      expect(await resolvePrimaryEmail(alice.id)).toBeNull();
    });

    it("refuses an unverified address, and says what to do about it", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, {
        type: "email",
        value: "alice@example.com",
        visibility: "everyone",
      });
      await expect(setPrimaryContactMethod(alice, created.id)).rejects.toThrow(/Confirm this address/);
    });

    it("refuses a non-email row outright", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, {
        type: "telegram",
        value: "@alice",
        visibility: "everyone",
      });
      // Verified or not, a telegram handle is not somewhere mail can go.
      await markVerified(created.id);
      await expect(setPrimaryContactMethod(alice, created.id)).rejects.toThrow(/Only an email address/);
    });

    it("refuses somebody else's row", async () => {
      const { alice, bob } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await markVerified(created.id);
      await expect(setPrimaryContactMethod(bob, created.id)).rejects.toThrow(ForbiddenError);
    });

    it("moves the flag rather than accumulating primaries", async () => {
      const { alice } = await createFixtures();
      const first = await createContactMethod(alice, { type: "email", value: "one@example.com", visibility: "everyone" });
      const second = await createContactMethod(alice, { type: "email", value: "two@example.com", visibility: "everyone" });
      await markVerified(first.id);
      await markVerified(second.id);

      await setPrimaryContactMethod(alice, first.id);
      expect(await resolvePrimaryEmail(alice.id)).toBe("one@example.com");

      await setPrimaryContactMethod(alice, second.id);
      expect(await resolvePrimaryEmail(alice.id)).toBe("two@example.com");

      const primaries = (await listOwnContactMethods(alice)).filter((m) => m.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].id).toBe(second.id);
    });

    it("ignores a primary row that lost its verification", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await markVerified(created.id);
      await setPrimaryContactMethod(alice, created.id);
      await db.insert(memberIdentity).values({
        memberId: alice.id,
        provider: "magic_link",
        loginEmail: "login@example.com",
      });

      // Defence in depth, not a reachable state through the UI: the write
      // side refuses an unverified primary, and the read side re-checks
      // anyway — because the read is what actually sends mail.
      await db.update(contactMethod).set({ verifiedAt: null }).where(eq(contactMethod.id, created.id));
      expect(await resolvePrimaryEmail(alice.id)).toBe("login@example.com");
    });

    it("will not delete the primary, and says how to replace it first", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await markVerified(created.id);
      await setPrimaryContactMethod(alice, created.id);

      // The alternative — cascading the flag away — would leave a member
      // receiving nothing at all with no error anywhere.
      await expect(deleteContactMethod(alice, created.id)).rejects.toThrow(/Point it somewhere else/);
    });

    it("drops both verification and primary when the address is edited", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await markVerified(created.id);
      await setPrimaryContactMethod(alice, created.id);

      const updated = await updateContactMethod(alice, created.id, {
        type: "email",
        value: "somewhere-else@example.com",
        visibility: "everyone",
      });
      // Two hazards, one trigger: a verifiedAt still standing on an
      // address nobody proved control of, and delivery aimed at text typed
      // a second ago.
      expect(updated.verifiedAt).toBeNull();
      expect(updated.isPrimary).toBe(false);
    });

    it("keeps verification and primary when only the visibility or label changes", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await markVerified(created.id);
      await setPrimaryContactMethod(alice, created.id);

      const updated = await updateContactMethod(alice, created.id, {
        type: "Email",
        value: "a@example.com",
        visibility: "everyone",
      });
      // The address is unchanged, so it is still the address that was
      // verified — a relabel isn't a re-pointing.
      expect(updated.verifiedAt).not.toBeNull();
      expect(updated.isPrimary).toBe(true);
    });
  });

  describe("verification", () => {
    it("marks a row verified when its own member follows the link", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, {
        type: "email",
        value: "alice@example.com",
        visibility: "everyone",
      });

      await requestContactMethodVerification(alice, created.id, "https://orchard.test");
      expect(sendEmailVerificationEmail).toHaveBeenCalledWith(
        "alice@example.com",
        expect.stringContaining("/profile?verify="),
      );

      const token = String((sendEmailVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0][1]).split("verify=")[1];
      const result = await consumeContactMethodVerification(alice, token);
      expect(result).toMatchObject({ ok: true, value: "alice@example.com" });
      expect((await listOwnContactMethods(alice))[0].verifiedAt).not.toBeNull();
    });

    it("is one-time", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await requestContactMethodVerification(alice, created.id, "https://orchard.test");
      const token = String((sendEmailVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0][1]).split("verify=")[1];

      expect((await consumeContactMethodVerification(alice, token)).ok).toBe(true);
      // A token found in a mailbox must not be spendable twice.
      expect((await consumeContactMethodVerification(alice, token)).ok).toBe(false);
    });

    it("refuses a token belonging to another member, and burns it", async () => {
      // A forwarded link is the case this guards: the token names a member,
      // and the recipient is not them. Both checks matter, and the burn
      // means a rejected attempt still costs a new link.
      const { alice, bob } = await createFixtures();
      const created = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
      await requestContactMethodVerification(alice, created.id, "https://orchard.test");
      const token = String((sendEmailVerificationEmail as ReturnType<typeof vi.fn>).mock.calls[0][1]).split("verify=")[1];

      expect((await consumeContactMethodVerification(bob, token)).ok).toBe(false);
      expect((await consumeContactMethodVerification(alice, token)).ok).toBe(false);
      expect((await listOwnContactMethods(alice))[0].verifiedAt).toBeNull();
    });

    it("refuses to send a confirmation for a non-email row", async () => {
      const { alice } = await createFixtures();
      const created = await createContactMethod(alice, { type: "phone", value: "555-1234", visibility: "everyone" });
      await expect(requestContactMethodVerification(alice, created.id, "https://orchard.test")).rejects.toThrow(/Only an email address/);
    });
  });

  describe("isEmailContactMethod", () => {
    it("accepts an email type with an address-shaped value", () => {
      expect(isEmailContactMethod({ type: "email", value: "a@example.com" })).toBe(true);
      expect(isEmailContactMethod({ type: "Email", value: " a@example.com " })).toBe(true);
    });

    it("rejects a non-email type, and an email type with a nonsense value", () => {
      // "type" is free text, so this predicate is the only thing standing
      // between a telegram handle and the primary-address column.
      expect(isEmailContactMethod({ type: "telegram", value: "@alice" })).toBe(false);
      expect(isEmailContactMethod({ type: "email", value: "alice" })).toBe(false);
      expect(isEmailContactMethod({ type: "email", value: "alice@example" })).toBe(false);
      expect(isEmailContactMethod({ type: "telegram", value: "a@example.com" })).toBe(false);
    });
  });
});

// The 0085 backfill is a migration, so no test can run it — the assertions
// below pin the *invariants* it exists to establish, on the same shapes its
// guards check, so that a later change to either side has to notice.
describe("at most one primary, which is what the backfill has to preserve", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("holds after a member moves their primary, whichever order they do it in", async () => {
    const { alice } = await createFixtures();
    const a = await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });
    const b = await createContactMethod(alice, { type: "email", value: "b@example.com", visibility: "everyone" });
    await markVerified(a.id);
    await markVerified(b.id);

    await setPrimaryContactMethod(alice, b.id);
    await setPrimaryContactMethod(alice, a.id);
    // Re-setting the same row is the case a naive clear-then-set handles
    // wrongly only if the clear and the set are separate statements.
    await setPrimaryContactMethod(alice, a.id);

    const primaries = (await listOwnContactMethods(alice)).filter((m) => m.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0].id).toBe(a.id);
  });

  it("is a property of a member, not of the community", async () => {
    // Two members in one community each having one is the normal state; the
    // invariant is per member and the backfill's DISTINCT ON is per member
    // too. A global uniqueness rule would make the second member's row a
    // constraint violation instead of a second primary.
    const { alice, bob } = await createFixtures();
    for (const who of [alice, bob]) {
      const row = await createContactMethod(who, { type: "email", value: `${who.name}@example.com`, visibility: "everyone" });
      await markVerified(row.id);
      await setPrimaryContactMethod(who, row.id);
    }
    const aPrimary = (await listOwnContactMethods(alice)).filter((m) => m.isPrimary);
    const bPrimary = (await listOwnContactMethods(bob)).filter((m) => m.isPrimary);
    expect(aPrimary).toHaveLength(1);
    expect(bPrimary).toHaveLength(1);
  });

  it("survives a member who has several identities but no primary row yet", async () => {
    // The exact shape 0085's DISTINCT ON exists for: one person, two
    // member_identity rows. Provisioning gives a new member one identity,
    // so this is only reachable for a pre-backfill account, but the
    // backfill is the thing that must not create two primaries from it.
    const { alice } = await createFixtures();
    await db.insert(memberIdentity).values({ memberId: alice.id, provider: "magic_link", loginEmail: "one@example.com" });
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "oidc",
      providerSubject: "sub-1",
      loginEmail: "two@example.com",
    });

    // Whichever the backfill picked, the read side is unambiguous and the
    // member has somewhere their mail goes.
    expect(await resolvePrimaryEmail(alice.id)).toBe("one@example.com");
    expect((await listOwnContactMethods(alice)).filter((m) => m.isPrimary).length).toBeLessThanOrEqual(1);
  });
});

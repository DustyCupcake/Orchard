import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, memberIdentity } from "@/db/schema";
import {
  commitBulkMemberImport,
  parseBulkMemberRows,
  previewBulkMemberImport,
} from "@/lib/settings";
import { ForbiddenError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("parseBulkMemberRows", () => {
  it("parses Name,email pairs one per line, lowercasing the email", () => {
    const { rows, malformedLines } = parseBulkMemberRows(
      "Alice,Alice@Example.com\nBob, bob@example.com \n",
    );
    expect(rows).toEqual([
      { name: "Alice", email: "alice@example.com" },
      { name: "Bob", email: "bob@example.com" },
    ]);
    expect(malformedLines).toEqual([]);
  });

  it("skips blank lines and strips surrounding quotes", () => {
    const { rows } = parseBulkMemberRows('\n"Carol","carol@example.com"\n\n');
    expect(rows).toEqual([{ name: "Carol", email: "carol@example.com" }]);
  });

  it("flags a line missing a name, an email, or an @ as malformed", () => {
    const { rows, malformedLines } = parseBulkMemberRows(
      "Dave\nEve,not-an-email\n,frank@example.com\nGood,good@example.com",
    );
    expect(rows).toEqual([{ name: "Good", email: "good@example.com" }]);
    expect(malformedLines).toEqual(["Dave", "Eve,not-an-email", ",frank@example.com"]);
  });
});

describe("bulk member import CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("separates already-claimed rows from genuinely new ones", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const [existingMember] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Existing" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: existingMember.id,
      provider: "magic_link",
      loginEmail: "existing@example.com",
    });

    const { newRows, alreadyExistsRows } = await previewBulkMemberImport(alice, [
      { name: "Existing", email: "existing@example.com" },
      { name: "New Person", email: "new@example.com" },
    ]);

    expect(newRows).toEqual([{ name: "New Person", email: "new@example.com" }]);
    expect(alreadyExistsRows).toEqual([{ name: "Existing", email: "existing@example.com" }]);
  });

  it("rejects a non-admin once the Admins task has ever been claimed", async () => {
    const { alice, bob } = await createFixtures();
    await db
      .update(community)
      .set({ adminsEverClaimed: true })
      .where(eq(community.id, alice.communityId));

    await expect(
      previewBulkMemberImport(bob, [{ name: "New", email: "new@example.com" }]),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      commitBulkMemberImport(bob, [{ name: "New", email: "new@example.com" }]),
    ).rejects.toThrow(ForbiddenError);
  });

  it("creates a real Member + magic_link MemberIdentity per genuinely new row", async () => {
    const { alice } = await createFixtures();

    const { created } = await commitBulkMemberImport(alice, [
      { name: "New Person", email: "new@example.com" },
      { name: "Second Person", email: "second@example.com" },
    ]);
    expect(created).toBe(2);

    const [identity] = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.loginEmail, "new@example.com"));
    expect(identity.provider).toBe("magic_link");

    const [createdMember] = await db.select().from(member).where(eq(member.id, identity.memberId));
    expect(createdMember.name).toBe("New Person");
    expect(createdMember.communityId).toBe(alice.communityId);
  });

  it("skips an already-claimed email rather than erroring or duplicating it", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const [existingMember] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Existing" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: existingMember.id,
      provider: "magic_link",
      loginEmail: "existing@example.com",
    });

    const { created } = await commitBulkMemberImport(alice, [
      { name: "Existing", email: "existing@example.com" },
      { name: "New Person", email: "new@example.com" },
    ]);
    expect(created).toBe(1);

    const identities = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.loginEmail, "existing@example.com"));
    expect(identities).toHaveLength(1);
  });

  it("re-checks at commit time, skipping a row that became claimed after the review step ran", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const rows = [{ name: "Race Person", email: "race@example.com" }];

    const preview = await previewBulkMemberImport(alice, rows);
    expect(preview.newRows).toEqual(rows);

    // Someone else joins with that same email in the gap between review and confirm.
    const [racer] = await db
      .insert(member)
      .values({ communityId: testCommunity.id, name: "Got There First" })
      .returning();
    await db.insert(memberIdentity).values({
      memberId: racer.id,
      provider: "magic_link",
      loginEmail: "race@example.com",
    });

    const { created } = await commitBulkMemberImport(alice, rows);
    expect(created).toBe(0);

    const identities = await db
      .select()
      .from(memberIdentity)
      .where(eq(memberIdentity.loginEmail, "race@example.com"));
    expect(identities).toHaveLength(1);
    expect(identities[0].memberId).toBe(racer.id);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  browseInterest,
  contactMethod,
  member,
  memberIdentity,
  memberLanguage,
  profileAnswer,
  profileQuestion,
  settingsChange,
  task,
  taskAssignment,
} from "@/db/schema";
import { anonymiseMember, hasLeft } from "@/lib/members/leave";
import { updateCommunity } from "@/lib/settings";
import { claimTask } from "@/lib/tasks";
import { createFixtures, insertTask, resetDatabase } from "./helpers";

/**
 * Leaving is the first thing in this schema that removes or anonymises a
 * member, and the reason it is shaped this way is in the function's own
 * comment: 37 tables hold a member FK and only two cascade anywhere, so a
 * `DELETE FROM member` cannot work. These tests are mostly about what must
 * *survive* — the change log above all, since its `actor_id` is the FK that
 * makes a departing member undeletable at all.
 */
describe("a member leaving", () => {
  beforeEach(resetDatabase);

  async function leave(opts: { keepName?: boolean } = {}) {
    const { alice } = await createFixtures();
    const result = await anonymiseMember(alice, { keepName: opts.keepName ?? false });
    const [row] = await db.select().from(member).where(eq(member.id, alice.id));
    return { alice, result, row };
  }

  it("replaces the name with a placeholder, and the placeholder is derived from the id", async () => {
    const { alice, row } = await leave();
    expect(row.name).not.toBe("Alice");
    expect(row.name).toMatch(/^Former member [0-9a-f]{4}$/);
    // Stable: the same member always reads the same way afterwards, so a
    // comment thread doesn't show them as two different people.
    expect(row.name).toBe(`Former member ${alice.id.slice(0, 4)}`);
    expect(hasLeft(row)).toBe(true);
  });

  // A counter would be guessable, so "Former member #3" could be mapped
  // onto the third person to leave. A uuid prefix cannot be.
  it("does not use a sequential or guessable identifier", async () => {
    const { alice } = await createFixtures();
    const { bob } = await createFixtures();
    await anonymiseMember(alice, { keepName: false });
    await anonymiseMember(bob, { keepName: false });
    const [a] = await db.select().from(member).where(eq(member.id, alice.id));
    const [b] = await db.select().from(member).where(eq(member.id, bob.id));
    expect(a.name).not.toBe("Former member #1");
    expect(a.name).not.toBe(b.name);
  });

  it("keeps the name when the member consents, and still deletes their data", async () => {
    const { row } = await leave({ keepName: true });
    expect(row.name).toBe("Alice");
    expect(hasLeft(row)).toBe(false);
    const identities = await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, row.id));
    expect(identities).toHaveLength(0);
  });

  // The one thing the whole function is shaped around: settings_change.
  // actor_id is NOT NULL with no onDelete, so before this existed a member
  // who had ever changed a setting could not be deleted at all.
  it("keeps the settings change log, and it still reads as that member's work", async () => {
    const { community: c, alice } = await createFixtures();
    await updateCommunity(alice, { name: "Renamed by Alice" });
    await anonymiseMember(alice, { keepName: false });

    const changes = await db
      .select()
      .from(settingsChange)
      .where(eq(settingsChange.actorId, alice.id));
    expect(changes).toHaveLength(1);
    expect(changes[0].newValue).toBe("Renamed by Alice");

    // And the read side resolves it to the placeholder, not to a name that
    // is still on file somewhere.
    const { listSettingsChanges } = await import("@/lib/settings/history");
    const [row] = await db.select().from(member).where(eq(member.id, alice.id));
    const rows = await listSettingsChanges(row);
    expect(c.id).toBeTruthy();
    expect(rows[0].actorName).toBe(`Former member ${alice.id.slice(0, 4)}`);
  });

  it("deletes the login identity whatever the member decided about their name", async () => {
    const { alice } = await createFixtures();
    await db.insert(memberIdentity).values({
      memberId: alice.id,
      provider: "magic_link",
      loginEmail: "alice@example.test",
    });
    await anonymiseMember(alice, { keepName: true });
    const identities = await db.select().from(memberIdentity).where(eq(memberIdentity.memberId, alice.id));
    expect(identities).toHaveLength(0);
  });

  it("deletes every profile answer, including ones feeding a published indicator", async () => {
    const { alice } = await createFixtures();
    const { createProfileQuestion } = await import("@/lib/profile-questions/questions");
    const plain = await createProfileQuestion(alice, { label: "Favourite fruit", responseType: "text", scope: "once_ever" });
    const published = await createProfileQuestion(alice, {
      label: "How many hours a week",
      responseType: "number",
      scope: "once_ever",
      publishedAsIndicator: true,
      // Required by the schema for a published indicator, and not incidental
      // here: this is the question whose answers feed a figure the
      // community reasoned about, so the test only means anything if one
      // was really publishable.
      allowPreferNotToSay: true,
    });

    // The question rows are the community's wording, and survive. The
    // answers do not — including the one feeding a figure the community
    // reasoned about, because a person asking for their data to go
    // outranks an aggregate.
    const { answerProfileQuestion } = await import("@/lib/profile-questions/answers");
    await answerProfileQuestion(alice, plain.id, { status: "answered", value: "Apples" });
    await answerProfileQuestion(alice, published.id, { status: "answered", value: 12 });
    expect(
      await db.select().from(profileAnswer).where(eq(profileAnswer.memberId, alice.id)),
    ).toHaveLength(2);

    const result = await anonymiseMember(alice, { keepName: false });
    expect(result.deletedAnswers).toBe(2);

    const answers = await db.select().from(profileAnswer).where(eq(profileAnswer.memberId, alice.id));
    expect(answers).toHaveLength(0);
    const questions = await db.select().from(profileQuestion);
    expect(questions.map((q) => q.id)).toEqual(
      expect.arrayContaining([plain.id, published.id]),
    );
  });

  it("deletes contact methods, which are the most identifying rows there are", async () => {
    const { alice } = await createFixtures();
    await db.insert(contactMethod).values({ memberId: alice.id, type: "phone", value: "+44 7700 900123" });
    await anonymiseMember(alice, { keepName: false });
    const rows = await db.select().from(contactMethod).where(eq(contactMethod.memberId, alice.id));
    expect(rows).toHaveLength(0);
  });

  it("deletes per-member attribute rows", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Somebody might like this" });
    const [language] = await db.insert(memberLanguage).values({ memberId: alice.id, language: "cy" }).returning();
    const [interest] = await db
      .insert(browseInterest)
      .values({ taskId: t.id, memberId: alice.id })
      .returning();
    expect(language).toBeTruthy();
    expect(interest).toBeTruthy();

    await anonymiseMember(alice, { keepName: false });
    expect(await db.select().from(memberLanguage).where(eq(memberLanguage.memberId, alice.id))).toHaveLength(0);
    expect(await db.select().from(browseInterest).where(eq(browseInterest.memberId, alice.id))).toHaveLength(0);
  });

  // Task holdings are the one shared row that IS deleted, because a task
  // held by somebody who cannot sign in is a task nobody can pick up.
  it("releases every task they held, and the task becomes claimable again", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Treasurer" });
    await claimTask(alice, t.id);
    const [before] = await db.select().from(task).where(eq(task.id, t.id));
    expect(before.status).toBe("claimed");

    const result = await anonymiseMember(alice, { keepName: false });
    expect(result.releasedTasks).toBe(1);

    const [after] = await db.select().from(task).where(eq(task.id, t.id));
    expect(after.status).toBe("unclaimed");
    expect(await db.select().from(taskAssignment).where(eq(taskAssignment.memberId, alice.id))).toHaveLength(0);
  });

  // A permission grant is keyed on the TASK, not the member, so releasing
  // the holder leaves the grant pointing at a task nobody holds. That is
  // the existing "unheld" warning on the settings screen, not a new
  // failure — but it is the consequence worth knowing about.
  it("leaves a permission grant pointing at a now-unheld task rather than silently dropping it", async () => {
    const { community: c, alice, branch } = await createFixtures();
    const { setPermissionGrant } = await import("@/lib/permissions");
    const t = await insertTask(c.id, branch.id, alice.id, { title: "Budget owner" });
    await setPermissionGrant(alice, "budget", t.id);
    await claimTask(alice, t.id);

    await anonymiseMember(alice, { keepName: false });

    const { listGrantsWithTaskInfo } = await import("@/lib/permissions");
    const grants = await listGrantsWithTaskInfo(c.id);
    expect(grants.map((g) => g.moduleKey)).toEqual(["budget"]);
    expect(grants[0].taskId).toBe(t.id);
  });

  it("clears the tags and tiers that would keep granting access to someone who left", async () => {
    const { alice } = await createFixtures();
    const [tier] = await db
      .update(member)
      .set({ tags: ["coordinator"] })
      .where(eq(member.id, alice.id))
      .returning();
    expect(tier.tags).toEqual(["coordinator"]);

    await anonymiseMember(tier, { keepName: false });
    const [after] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(after.tags).toEqual([]);
  });

  it("is idempotent enough to be safe to retry", async () => {
    const { alice } = await createFixtures();
    await db.insert(contactMethod).values({ memberId: alice.id, type: "email", value: "a@b.test" });
    await anonymiseMember(alice, { keepName: false });
    // A second run finds nothing to delete and must not throw — a member
    // whose first attempt half-failed should be able to press the button
    // again rather than being locked out by their own earlier failure.
    await expect(anonymiseMember({ ...alice, name: "Alice" }, { keepName: false })).resolves.toBeTruthy();
  });
});

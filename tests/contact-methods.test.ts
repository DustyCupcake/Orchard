import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { task } from "@/db/schema";
import { claimTask } from "@/lib/tasks";
import {
  createContactMethod,
  deleteContactMethod,
  getVisibleContactMethods,
  isTaskOrGroupMate,
  listOwnContactMethods,
  updateContactMethod,
} from "@/lib/contact-methods";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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
});

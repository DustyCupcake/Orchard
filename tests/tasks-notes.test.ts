import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task } from "@/db/schema";
import {
  addComment,
  addResource,
  addWikiRevision,
  getTaskNotes,
  listComments,
  listResources,
  listWikiRevisions,
} from "@/lib/tasks";
import { createCycle } from "@/lib/cycles";
import { NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
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
      title: "Water the trees",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("task wiki", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps every edit as a new revision, most recent first", async () => {
    const { branch, alice, bob } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    await addWikiRevision(alice, t.id, { content: "First pass at the how-to." });
    await addWikiRevision(bob, t.id, { content: "Updated with the new supplier." });

    const revisions = await listWikiRevisions(alice, t.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].content).toBe("Updated with the new supplier.");
    expect(revisions[0].editedBy).toBe(bob.id);
    expect(revisions[1].content).toBe("First pass at the how-to.");
  });

  it("is editable by any member, not just the task's creator", async () => {
    const { branch, alice, bob } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await addWikiRevision(bob, t.id, { content: "Bob's tip" });
    expect(created.editedBy).toBe(bob.id);
  });

  it("rejects operating on a task outside the actor's community", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const { alice: strangerAlice } = await createFixtures();
    await expect(
      addWikiRevision(strangerAlice, t.id, { content: "sneaky" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("task comments", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("keeps a chronological, open thread", async () => {
    const { branch, alice, bob } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    await addComment(alice, t.id, { body: "Started on this." });
    await addComment(bob, t.id, { body: "Let me know if you need a hand." });

    const comments = await listComments(alice, t.id);
    expect(comments.map((c) => c.body)).toEqual([
      "Started on this.",
      "Let me know if you need a hand.",
    ]);
    expect(comments[1].memberId).toBe(bob.id);
  });
});

describe("task resources", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("stores a labeled link with an optional tag", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const created = await addResource(alice, t.id, {
      label: "Order form we used",
      url: "https://example.com/order-form",
      tag: "purchase link",
    });

    expect(created.label).toBe("Order form we used");
    expect(created.tag).toBe("purchase link");

    const resources = await listResources(alice, t.id);
    expect(resources).toHaveLength(1);
  });
});

describe("getTaskNotes", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns wiki, comments, and resources together", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    await addWikiRevision(alice, t.id, { content: "How to do it" });
    await addComment(alice, t.id, { body: "A note" });
    await addResource(alice, t.id, { label: "Link", url: "https://example.com" });

    const notes = await getTaskNotes(alice, t.id);
    expect(notes.wikiRevisions).toHaveLength(1);
    expect(notes.comments).toHaveLength(1);
    expect(notes.resources).toHaveLength(1);
  });

  it("returns empty arrays for a task with no notes yet", async () => {
    const { branch, alice } = await createFixtures();
    const t = await insertTask(alice.communityId, branch.id, alice.id);

    const notes = await getTaskNotes(alice, t.id);
    expect(notes).toEqual({ wikiRevisions: [], comments: [], resources: [] });
  });
});

// See docs/spec.md's "Carrying forward across cycles": the wiki summary
// and resource list are meant to come along on clone as the new task's
// starting point, the same way Task milestones' own carry-forward is
// tested in tests/task-milestones.test.ts's "carrying forward through a
// Cycle clone" block.
describe("carrying forward through a Cycle clone", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("carries only the current wiki revision forward, attributed to its original author", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: previous.id });

    await addWikiRevision(alice, t.id, { content: "First pass at the how-to." });
    await addWikiRevision(bob, t.id, { content: "Updated with the new supplier." });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const [clonedTask] = await db.select().from(task).where(eq(task.cycleId, cloned.id));

    const clonedRevisions = await listWikiRevisions(alice, clonedTask.id);
    expect(clonedRevisions).toHaveLength(1);
    expect(clonedRevisions[0].content).toBe("Updated with the new supplier.");
    expect(clonedRevisions[0].editedBy).toBe(bob.id); // preserved, not reassigned to alice (the cloning actor)

    // The original task's full history is untouched.
    const originalRevisions = await listWikiRevisions(alice, t.id);
    expect(originalRevisions).toHaveLength(2);
  });

  it("copies every resource wholesale, attributed to its original adder", async () => {
    const { community: testCommunity, branch, alice, bob } = await createFixtures();
    await enableCycles(testCommunity.id);
    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    const t = await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: previous.id });

    await addResource(alice, t.id, { label: "Order form we used", url: "https://example.com/order-form" });
    await addResource(bob, t.id, { label: "Sign design", url: "https://example.com/sign", tag: "design asset" });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const [clonedTask] = await db.select().from(task).where(eq(task.cycleId, cloned.id));

    const clonedResources = await listResources(alice, clonedTask.id);
    expect(clonedResources).toHaveLength(2);
    const signResource = clonedResources.find((r) => r.label === "Sign design")!;
    expect(signResource.url).toBe("https://example.com/sign");
    expect(signResource.tag).toBe("design asset");
    expect(signResource.addedBy).toBe(bob.id); // preserved, not reassigned to alice (the cloning actor)
  });

  it("leaves a cloned task with no wiki or resources when the source task had none", async () => {
    const { community: testCommunity, branch, alice } = await createFixtures();
    await enableCycles(testCommunity.id);
    const previous = await createCycle(alice, { source: "blank", name: "2026 Season" });
    await insertTask(testCommunity.id, branch.id, alice.id, { cycleId: previous.id });

    const cloned = await createCycle(alice, { source: "clone_previous", name: "2027 Season", confirmed: true });
    const [clonedTask] = await db.select().from(task).where(eq(task.cycleId, cloned.id));

    const notes = await getTaskNotes(alice, clonedTask.id);
    expect(notes).toEqual({ wikiRevisions: [], comments: [], resources: [] });
  });
});

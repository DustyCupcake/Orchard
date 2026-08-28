import { beforeEach, describe, expect, it } from "vitest";
import {
  addWikiPageRevision,
  createWikiPage,
  getWikiPage,
  listTaskWikiIndex,
  listWikiPageRevisions,
  listWikiPages,
  markWikiPageDuplicate,
} from "@/lib/wiki-pages";
import { addWikiRevision } from "@/lib/tasks";
import { NotFoundError } from "@/lib/errors";
import { db } from "@/db";
import { task } from "@/db/schema";
import { createFixtures, resetDatabase } from "./helpers";

async function insertTask(communityId: string, branchId: string, createdBy: string, title = "Water the trees") {
  const [row] = await db
    .insert(task)
    .values({
      communityId,
      branchId,
      title,
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
    })
    .returning();
  return row;
}

describe("wiki pages: creation", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a general page with real content up front, not pending", async () => {
    const { alice } = await createFixtures();
    const page = await createWikiPage(alice, {
      title: "How the walkie-talkies work",
      content: "Channel 3, always.",
    });

    expect(page.branchId).toBeNull();
    expect(page.questionPending).toBe(false);

    const revisions = await listWikiPageRevisions(alice, page.id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0].content).toBe("Channel 3, always.");
  });

  it("creates a bare FAQ question with no body, flagged question_pending", async () => {
    const { alice } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Where do we park RVs?" });

    expect(page.questionPending).toBe(true);
    const revisions = await listWikiPageRevisions(alice, page.id);
    expect(revisions).toHaveLength(0);
  });

  it("files a page under a branch when given one, validated against the actor's community", async () => {
    const { alice, branch } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Fruit setup notes", branchId: branch.id });
    expect(page.branchId).toBe(branch.id);

    const { branch: strangerBranch } = await createFixtures();
    await expect(
      createWikiPage(alice, { title: "sneaky", branchId: strangerBranch.id }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("wiki pages: revisions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("is editable by any member, keeping every edit as a new revision, most recent first", async () => {
    const { alice, bob } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Kitchen cleanup routine", content: "v1" });

    await addWikiPageRevision(bob, page.id, { content: "v2, updated after the audit" });

    const revisions = await listWikiPageRevisions(alice, page.id);
    expect(revisions).toHaveLength(2);
    expect(revisions[0].content).toBe("v2, updated after the audit");
    expect(revisions[0].editedBy).toBe(bob.id);
    expect(revisions[1].content).toBe("v1");
  });

  it("answering a pending question's first revision clears question_pending", async () => {
    const { alice, bob } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Where do we park RVs?" });
    expect(page.questionPending).toBe(true);

    await addWikiPageRevision(bob, page.id, { content: "The east lot, past the gate." });

    const { page: updated } = await getWikiPage(alice, page.id);
    expect(updated.questionPending).toBe(false);
  });

  it("rejects operating on a page outside the actor's community", async () => {
    const { alice } = await createFixtures();
    const page = await createWikiPage(alice, { title: "General note", content: "hi" });

    const { alice: strangerAlice } = await createFixtures();
    await expect(
      addWikiPageRevision(strangerAlice, page.id, { content: "sneaky" }),
    ).rejects.toThrow(NotFoundError);
  });
});

describe("wiki pages: resolving as a duplicate", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("points a pending question at an existing page, clearing pending and dropping it from the main index", async () => {
    const { alice } = await createFixtures();
    const canonical = await createWikiPage(alice, {
      title: "Where do we park RVs?",
      content: "The east lot.",
    });
    const duplicate = await createWikiPage(alice, { title: "RV parking spot?" });

    const updated = await markWikiPageDuplicate(alice, duplicate.id, {
      duplicateOfPageId: canonical.id,
    });
    expect(updated.duplicateOfPageId).toBe(canonical.id);
    expect(updated.questionPending).toBe(false);

    const index = await listWikiPages(alice);
    expect(index.map((p) => p.id)).not.toContain(duplicate.id);
    expect(index.map((p) => p.id)).toContain(canonical.id);

    const { alsoAskedAs } = await getWikiPage(alice, canonical.id);
    expect(alsoAskedAs.map((p) => p.id)).toEqual([duplicate.id]);
  });

  it("rejects marking a page as a duplicate of itself", async () => {
    const { alice } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Something", content: "x" });
    await expect(
      markWikiPageDuplicate(alice, page.id, { duplicateOfPageId: page.id }),
    ).rejects.toThrow();
  });
});

describe("wiki pages: listing", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns each page's latest revision alongside it", async () => {
    const { alice } = await createFixtures();
    const page = await createWikiPage(alice, { title: "Doc", content: "v1" });
    await addWikiPageRevision(alice, page.id, { content: "v2" });

    const pages = await listWikiPages(alice);
    const found = pages.find((p) => p.id === page.id);
    expect(found?.latestRevision?.content).toBe("v2");
  });

  it("filters by branch when asked", async () => {
    const { alice, branch } = await createFixtures();
    await createWikiPage(alice, { title: "General page", content: "x" });
    const branchPage = await createWikiPage(alice, {
      title: "Branch page",
      branchId: branch.id,
      content: "y",
    });

    const filtered = await listWikiPages(alice, branch.id);
    expect(filtered.map((p) => p.id)).toEqual([branchPage.id]);
  });
});

describe("task wiki index", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces every task's current wiki revision grouped by branch, without new storage", async () => {
    const { alice, branch } = await createFixtures();
    const t1 = await insertTask(alice.communityId, branch.id, alice.id, "Set up the kitchen");
    const t2 = await insertTask(alice.communityId, branch.id, alice.id, "No wiki yet");

    await addWikiRevision(alice, t1.id, { content: "First pass" });
    await addWikiRevision(alice, t1.id, { content: "Updated pass" });

    const groups = await listTaskWikiIndex(alice);
    expect(groups).toHaveLength(1);
    expect(groups[0].branchName).toBe(branch.name);
    expect(groups[0].entries.map((e) => e.taskId)).toEqual([t1.id]);
    expect(groups[0].entries[0].content).toBe("Updated pass");
    // t2 has no wiki revision at all, so it's absent — a view, not new
    // storage, so a task with nothing written up just doesn't appear.
    expect(groups[0].entries.map((e) => e.taskId)).not.toContain(t2.id);
  });
});

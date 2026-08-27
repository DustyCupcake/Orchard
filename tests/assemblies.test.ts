import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assembly, assemblyQuestion } from "@/db/schema";
import {
  addAgendaItem,
  computeAssemblyPhase,
  createAssembly,
  getAssembly,
  listAssemblies,
  submitAssemblyResponse,
} from "@/lib/assemblies";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

const MIN = 60_000;

async function insertAssembly(
  communityId: string,
  proposedBy: string,
  overrides: Partial<typeof assembly.$inferInsert> = {},
) {
  const now = Date.now();
  const [row] = await db
    .insert(assembly)
    .values({
      communityId,
      title: "Where should the barrio go?",
      proposedBy,
      agendaEndsAt: new Date(now - 3 * MIN),
      noticeEndsAt: new Date(now - 2 * MIN),
      votingEndsAt: new Date(now + 10 * MIN),
      ...overrides,
    })
    .returning();
  return row;
}

describe("createAssembly", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("computes agenda/notice/voting end times from the given minute durations", async () => {
    const { alice } = await createFixtures();
    const before = Date.now();

    const a = await createAssembly(alice, {
      title: "Should we add a new Branch?",
      agendaMinutes: 10,
      noticeMinutes: 5,
      votingMinutes: 20,
    });

    expect(a.agendaEndsAt.getTime()).toBeGreaterThanOrEqual(before + 10 * MIN);
    expect(a.noticeEndsAt.getTime()).toBeGreaterThanOrEqual(a.agendaEndsAt.getTime() + 5 * MIN - 1000);
    expect(a.votingEndsAt.getTime()).toBeGreaterThanOrEqual(a.noticeEndsAt.getTime() + 20 * MIN - 1000);
    expect(a.proposedBy).toBe(alice.id);
  });

  it("is open to any member — no gate", async () => {
    const { bob } = await createFixtures();
    const a = await createAssembly(bob, {
      title: "Anyone can call one",
      agendaMinutes: 0,
      noticeMinutes: 0,
      votingMinutes: 1,
    });
    expect(a.title).toBe("Anyone can call one");
  });
});

describe("computeAssemblyPhase", () => {
  it("returns agenda, notice, voting, or closed based on now vs. the three timestamps", () => {
    const now = new Date(1000 * MIN);
    const a = {
      agendaEndsAt: new Date(1000 * MIN + 10 * MIN),
      noticeEndsAt: new Date(1000 * MIN + 20 * MIN),
      votingEndsAt: new Date(1000 * MIN + 30 * MIN),
    } as Parameters<typeof computeAssemblyPhase>[0];

    expect(computeAssemblyPhase(a, now)).toBe("agenda");
    expect(computeAssemblyPhase(a, new Date(1000 * MIN + 15 * MIN))).toBe("notice");
    expect(computeAssemblyPhase(a, new Date(1000 * MIN + 25 * MIN))).toBe("voting");
    expect(computeAssemblyPhase(a, new Date(1000 * MIN + 35 * MIN))).toBe("closed");
  });
});

describe("addAgendaItem", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("adds an item during the agenda phase", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });

    const item = await addAgendaItem(alice, a.id, { text: "Where on the map?" });
    expect(item.text).toBe("Where on the map?");
    expect(item.addedBy).toBe(alice.id);
  });

  it("rejects adding an item once the agenda phase has ended", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const a = await insertAssembly(testCommunity.id, alice.id); // agenda already closed by default

    await expect(addAgendaItem(alice, a.id, { text: "Too late" })).rejects.toThrow(ConflictError);
  });

  it("rejects a choice-type item with no options", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });

    await expect(
      addAgendaItem(alice, a.id, { text: "Which spot?", responseType: "single_choice" }),
    ).rejects.toThrow(AppError);
  });

  it("rejects adding an item to an Assembly from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, community: strangerCommunity } = await createFixtures();
    const now = Date.now();
    const stranger = await insertAssembly(strangerCommunity.id, strangerAlice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });

    await expect(addAgendaItem(alice, stranger.id, { text: "Hijack" })).rejects.toThrow(NotFoundError);
  });
});

describe("submitAssemblyResponse", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects voting during the agenda phase", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });
    const item = await addAgendaItem(alice, a.id, { text: "Where?" });

    await expect(submitAssemblyResponse(alice, item.id, { value: "here" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects voting during the notice phase", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now - 5 * MIN),
      noticeEndsAt: new Date(now + 10 * MIN),
      votingEndsAt: new Date(now + 20 * MIN),
    });
    // Insert the agenda item directly since addAgendaItem itself would reject outside agenda phase.
    const [item] = await db
      .insert(assemblyQuestion)
      .values({ assemblyId: a.id, addedBy: alice.id, text: "Where?" })
      .returning();

    await expect(submitAssemblyResponse(alice, item.id, { value: "here" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("accepts voting during the voting phase, and rejects once closed", async () => {
    const { alice, bob, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now - 10 * MIN),
      noticeEndsAt: new Date(now - 5 * MIN),
      votingEndsAt: new Date(now + 10 * MIN),
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({
        assemblyId: a.id,
        addedBy: alice.id,
        text: "Pancakes or eggs?",
        responseType: "single_choice",
        options: ["pancakes", "eggs"],
      })
      .returning();

    const response = await submitAssemblyResponse(bob, item.id, { value: "pancakes" });
    expect(response.value).toBe("pancakes");

    await db.update(assembly).set({ votingEndsAt: new Date(now - 1000) }).where(eq(assembly.id, a.id));
    await expect(submitAssemblyResponse(bob, item.id, { value: "eggs" })).rejects.toThrow(ConflictError);
  });

  it("validates value against responseType/options, and upserts on resubmission", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now - 10 * MIN),
      noticeEndsAt: new Date(now - 5 * MIN),
      votingEndsAt: new Date(now + 10 * MIN),
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({
        assemblyId: a.id,
        addedBy: alice.id,
        text: "Which spot?",
        responseType: "multi_choice",
        options: ["north", "south", "east"],
      })
      .returning();

    await expect(submitAssemblyResponse(alice, item.id, { value: "north" })).rejects.toThrow(
      ConflictError,
    );

    const first = await submitAssemblyResponse(alice, item.id, { value: ["north", "east"] });
    expect(first.value).toEqual(["north", "east"]);

    const second = await submitAssemblyResponse(alice, item.id, { value: ["south"] });
    expect(second.id).toBe(first.id);
    expect(second.value).toEqual(["south"]);
  });
});

describe("getAssembly / listAssemblies", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns each agenda item with its responses and the actor's own response", async () => {
    const { alice, bob, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now - 10 * MIN),
      noticeEndsAt: new Date(now - 5 * MIN),
      votingEndsAt: new Date(now + 10 * MIN),
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({ assemblyId: a.id, addedBy: alice.id, text: "Where?" })
      .returning();
    await submitAssemblyResponse(bob, item.id, { value: "here" });

    const detail = await getAssembly(alice, a.id);
    expect(detail.phase).toBe("voting");
    expect(detail.questions).toHaveLength(1);
    expect(detail.questions[0].responses).toHaveLength(1);
    expect(detail.questions[0].myResponse).toBeNull();

    const bobView = await getAssembly(bob, a.id);
    expect(bobView.questions[0].myResponse?.value).toBe("here");
  });

  it("scopes listAssemblies to the actor's own community", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const { alice: strangerAlice, community: strangerCommunity } = await createFixtures();
    await insertAssembly(testCommunity.id, alice.id);
    await insertAssembly(strangerCommunity.id, strangerAlice.id);

    const list = await listAssemblies(alice);
    expect(list).toHaveLength(1);
    expect(list[0].communityId).toBe(testCommunity.id);
  });

  it("rejects fetching an Assembly from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, community: strangerCommunity } = await createFixtures();
    const stranger = await insertAssembly(strangerCommunity.id, strangerAlice.id);

    await expect(getAssembly(alice, stranger.id)).rejects.toThrow(NotFoundError);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assembly, assemblyQuestion, community as communityTable } from "@/db/schema";
import {
  addAgendaItem,
  addAgendaItemInput,
  computeAssemblyPhase,
  createAssembly,
  FOUNDING_SETTINGS_GROUPS,
  FOUNDING_SETTINGS_ITEMS,
  FOUNDING_SETTINGS_TEMPLATE_KEY,
  FOUNDERS_PROMPT_WINDOW_DAYS,
  getAssembly,
  getFoundersAssemblyPromptState,
  isAwaitingMyAnswer,
  listAssemblies,
  listOpenAssemblies,
  removeAgendaItem,
  submitAssemblyResponse,
  submitAssemblyResponses,
  templateGroupForMapping,
} from "@/lib/assemblies";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS } from "@/lib/permissions";
import { OPENNESS_LABELS } from "@/lib/format";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
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

describe("agenda item options", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("trims each option and drops blank ones", () => {
    const parsed = addAgendaItemInput.parse({
      text: "  Which way?  ",
      responseType: "single_choice",
      options: [" north ", "", "   ", "south"],
    });
    expect(parsed.text).toBe("Which way?");
    expect(parsed.options).toEqual(["north", "south"]);
  });

  it("rejects two options worded the same", () => {
    // Not cosmetic: two radios sharing a name AND a value are one control
    // to the browser, so the tally would count one answer as two.
    expect(() =>
      addAgendaItemInput.parse({
        text: "Which way?",
        responseType: "single_choice",
        options: ["north", "north"],
      }),
    ).toThrow(/distinct/);
  });

  it("rejects a whitespace-only item", () => {
    expect(() => addAgendaItemInput.parse({ text: "   " })).toThrow();
  });

  it("never stores options on a written-answer item", async () => {
    // The old comma-separated field was on screen for every response
    // type, so typing options and then switching to Free text committed
    // options that could never be displayed, voted on, or edited again.
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });

    const item = await addAgendaItem(alice, a.id, {
      text: "Anything else?",
      responseType: "text",
      options: ["yes", "no"],
    });
    expect(item.options).toEqual([]);
  });

  it("keeps options on a choice item, trimmed", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });

    const item = await addAgendaItem(alice, a.id, {
      text: "Which way?",
      responseType: "single_choice",
      options: [" north, south ", "east"],
    });
    expect(item.options).toEqual(["north, south", "east"]);
  });
});

describe("founding settings template", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("seeds the whole agenda, with its settings mapping, in one call", async () => {
    const { alice } = await createFixtures();

    const a = await createAssembly(alice, {
      title: "Founding settings",
      agendaMinutes: 60,
      noticeMinutes: 60,
      votingMinutes: 60,
      templateKey: FOUNDING_SETTINGS_TEMPLATE_KEY,
    });
    expect(a.templateKey).toBe(FOUNDING_SETTINGS_TEMPLATE_KEY);

    const detail = await getAssembly(alice, a.id);
    expect(detail.questions).toHaveLength(FOUNDING_SETTINGS_ITEMS.length);

    // Every seeded item must say which setting it becomes — that's the
    // whole reason an advisory result is actionable.
    for (const q of detail.questions) {
      expect(q.settingsMapping).toBeTruthy();
      expect(templateGroupForMapping(q.settingsMapping)).toBeTruthy();
    }

    // A choice item seeded from a template has to be answerable.
    const choice = detail.questions.find((q) => q.responseType !== "text");
    expect(choice!.options.length).toBeGreaterThan(0);
  });

  it("covers the areas the settings screen actually configures", () => {
    const groupTitles = new Set(FOUNDING_SETTINGS_ITEMS.map((i) => i.group));
    expect(groupTitles).toEqual(new Set(FOUNDING_SETTINGS_GROUPS.map((g) => g.title)));
  });

  it("derives its option sets from the live label maps, so they can't drift", () => {
    // If a module or permission module is added, the template's options
    // follow automatically rather than going quietly stale.
    const moduleOptions = FOUNDING_SETTINGS_ITEMS.find((i) =>
      i.text.includes("should this community actually use"),
    )!.options;
    expect(moduleOptions).toEqual(MODULE_DEFINITIONS.map((m) => m.label));

    const grantOptions = FOUNDING_SETTINGS_ITEMS.find((i) =>
      i.text.includes("deliberately accountable"),
    )!.options;
    expect(grantOptions).toEqual(PERMISSION_MODULE_KEYS.map((k) => PERMISSION_MODULE_LABELS[k]));

    const opennessOptions = FOUNDING_SETTINGS_ITEMS.find((i) =>
      i.text.includes("critical task"),
    )!.options;
    expect(opennessOptions).toContain(OPENNESS_LABELS.community_endorsed);
  });

  it("leaves a from-scratch Assembly untemplated and empty", async () => {
    const { alice } = await createFixtures();
    const a = await createAssembly(alice, {
      title: "Where should the barrio go?",
      agendaMinutes: 60,
      noticeMinutes: 60,
      votingMinutes: 60,
    });
    expect(a.templateKey).toBeNull();
    expect((await getAssembly(alice, a.id)).questions).toHaveLength(0);
  });
});

describe("withdrawing an agenda item", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("removes an item you added, while the agenda is open", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });
    const item = await addAgendaItem(alice, a.id, { text: "Oops, meant for another thread" });

    await removeAgendaItem(alice, item.id);
    expect((await getAssembly(alice, a.id)).questions).toHaveLength(0);
  });

  it("refuses to remove somebody else's item", async () => {
    // An open agenda needs an exit for mistakes, but not a delete
    // button on other people's questions.
    const { alice, bob, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });
    const item = await addAgendaItem(alice, a.id, { text: "Mine" });

    await expect(removeAgendaItem(bob, item.id)).rejects.toThrow(ForbiddenError);
    expect((await getAssembly(alice, a.id)).questions).toHaveLength(1);
  });

  it("refuses once the agenda window has closed", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const now = Date.now();
    const a = await insertAssembly(testCommunity.id, alice.id, {
      agendaEndsAt: new Date(now - 5 * MIN),
      noticeEndsAt: new Date(now + 10 * MIN),
      votingEndsAt: new Date(now + 20 * MIN),
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({ assemblyId: a.id, addedBy: alice.id, text: "Too late" })
      .returning();

    await expect(removeAgendaItem(alice, item.id)).rejects.toThrow(ConflictError);
  });

  it("rejects a question from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, community: strangerCommunity } = await createFixtures();
    const now = Date.now();
    const stranger = await insertAssembly(strangerCommunity.id, strangerAlice.id, {
      agendaEndsAt: new Date(now + 10 * MIN),
      noticeEndsAt: new Date(now + 20 * MIN),
      votingEndsAt: new Date(now + 30 * MIN),
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({ assemblyId: stranger.id, addedBy: strangerAlice.id, text: "Theirs" })
      .returning();

    await expect(removeAgendaItem(alice, item.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("submitAssemblyResponses (whole ballot at once)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function votingAssemblyWithQuestions(communityId: string, memberId: string) {
    const now = Date.now();
    const a = await insertAssembly(communityId, memberId, {
      agendaEndsAt: new Date(now - 10 * MIN),
      noticeEndsAt: new Date(now - 5 * MIN),
      votingEndsAt: new Date(now + 10 * MIN),
    });
    const [choice, multi, text] = await db
      .insert(assemblyQuestion)
      .values([
        {
          assemblyId: a.id,
          addedBy: memberId,
          text: "Which one?",
          responseType: "single_choice",
          options: ["north", "south"],
        },
        {
          assemblyId: a.id,
          addedBy: memberId,
          text: "Which days?",
          responseType: "multi_choice",
          options: ["sat", "sun"],
        },
        { assemblyId: a.id, addedBy: memberId, text: "Anything else?" },
      ])
      .returning();
    return { a, choice, multi, text };
  }

  it("saves every answered item in one call", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const { choice, multi, text } = await votingAssemblyWithQuestions(testCommunity.id, alice.id);

    const result = await submitAssemblyResponses(
      alice,
      [choice.id, multi.id, text.id],
      { [choice.id]: "north", [multi.id]: ["sat", "sun"], [text.id]: "no thanks" },
    );

    expect(result.failed).toEqual([]);
    expect(result.saved).toHaveLength(3);

    const detail = await getAssembly(alice, (await listAssemblies(alice))[0].id);
    const byText = new Map(detail.questions.map((q) => [q.text, q.myResponse?.value]));
    expect(byText.get("Which one?")).toBe("north");
    expect(byText.get("Which days?")).toEqual(["sat", "sun"]);
    expect(byText.get("Anything else?")).toBe("no thanks");
  });

  it("skips a blank answer instead of failing the ballot", async () => {
    // Leaving one blank is how a member says "no view on that one" —
    // treating it as an error would make a partial ballot unsubmittable.
    const { alice, community: testCommunity } = await createFixtures();
    const { choice, multi, text } = await votingAssemblyWithQuestions(testCommunity.id, alice.id);

    const result = await submitAssemblyResponses(
      alice,
      [choice.id, multi.id, text.id],
      { [choice.id]: "south", [multi.id]: [], [text.id]: "   " },
    );

    expect(result.failed).toEqual([]);
    expect(result.saved).toEqual([choice.id]);

    const detail = await getAssembly(alice, (await listAssemblies(alice))[0].id);
    expect(detail.questions.find((q) => q.id === multi.id)!.myResponse).toBeNull();
  });

  it("keeps the good answers when one is invalid, and says which failed", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const { choice, multi, text } = await votingAssemblyWithQuestions(testCommunity.id, alice.id);


    const result = await submitAssemblyResponses(
      alice,
      [choice.id, multi.id, text.id],
      // "east" is not one of this question's options.
      { [choice.id]: "east", [multi.id]: ["sat"], [text.id]: "fine" },
    );

    expect(result.saved).toEqual([multi.id, text.id]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].questionId).toBe(choice.id);

    const detail = await getAssembly(alice, (await listAssemblies(alice))[0].id);
    expect(detail.questions.find((q) => q.id === text.id)!.myResponse?.value).toBe("fine");
  });

  it("updates an existing answer rather than adding a second one", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const { choice } = await votingAssemblyWithQuestions(testCommunity.id, alice.id);
    const a = (await listAssemblies(alice))[0];

    await submitAssemblyResponses(alice, [choice.id], { [choice.id]: "north" });
    await submitAssemblyResponses(alice, [choice.id], { [choice.id]: "south" });

    const detail = await getAssembly(alice, a.id);
    const q = detail.questions.find((x) => x.id === choice.id)!;
    expect(q.responses).toHaveLength(1);
    expect(q.myResponse?.value).toBe("south");
  });

  it("refuses every item once voting has closed", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const { choice } = await votingAssemblyWithQuestions(testCommunity.id, alice.id);
    const a = (await listAssemblies(alice))[0];
    await db.update(assembly).set({ votingEndsAt: new Date(Date.now() - 1000) }).where(eq(assembly.id, a.id));

    const result = await submitAssemblyResponses(alice, [choice.id], { [choice.id]: "north" });
    expect(result.saved).toEqual([]);
    expect(result.failed[0].message).toMatch(/isn't open/);
  });

  it("will not answer an item belonging to another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, community: strangerCommunity } = await createFixtures();
    const { choice } = await votingAssemblyWithQuestions(strangerCommunity.id, strangerAlice.id);

    const result = await submitAssemblyResponses(alice, [choice.id], { [choice.id]: "north" });
    expect(result.saved).toEqual([]);
    // Not "voting isn't open" — that would be both wrong and a hint
    // that someone else's Assembly exists.
    expect(result.failed[0].message).toMatch(/isn't in this community/);
  });
});

describe("isAwaitingMyAnswer / listOpenAssemblies", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("counts only a voting-phase Assembly with unanswered questions", () => {
    // The badge the Community nav group carries. Counting an open
    // agenda or a notice-phase Assembly here would work against
    // spec.md's "no built-in urgent notification, on purpose" — it would
    // nag for things you're not able to act on yet.
    expect(isAwaitingMyAnswer({ phase: "voting", questionCount: 3, myResponseCount: 0 })).toBe(true);
    expect(isAwaitingMyAnswer({ phase: "voting", questionCount: 3, myResponseCount: 2 })).toBe(true);
    expect(isAwaitingMyAnswer({ phase: "voting", questionCount: 3, myResponseCount: 3 })).toBe(false);
    expect(isAwaitingMyAnswer({ phase: "agenda", questionCount: 3, myResponseCount: 0 })).toBe(false);
    expect(isAwaitingMyAnswer({ phase: "notice", questionCount: 3, myResponseCount: 0 })).toBe(false);
    expect(isAwaitingMyAnswer({ phase: "closed", questionCount: 3, myResponseCount: 0 })).toBe(false);
    // Voting, but nothing to answer.
    expect(isAwaitingMyAnswer({ phase: "voting", questionCount: 0, myResponseCount: 0 })).toBe(false);
  });

  it("lists only un-closed Assemblies, flagging the ones that need this member", async () => {
    const { alice, bob } = await createFixtures();
    const now = Date.now();

    const open = await createAssembly(alice, {
      title: "Still open",
      // Straight to voting: an agenda-phase Assembly is deliberately not
      // "awaiting my answer", which is the whole point of the predicate.
      agendaMinutes: 0,
      noticeMinutes: 0,
      votingMinutes: 60,
    });
    const done = await createAssembly(alice, {
      title: "Already closed",
      agendaMinutes: 0,
      noticeMinutes: 0,
      votingMinutes: 1,
    });
    await db
      .update(assembly)
      .set({ votingEndsAt: new Date(now - 60_000) })
      .where(eq(assembly.id, done.id));

    const [item] = await db
      .insert(assemblyQuestion)
      .values({
        assemblyId: open.id,
        addedBy: alice.id,
        text: "Which one?",
        responseType: "single_choice",
        options: ["a", "b"],
      })
      .returning();

    const before = await listOpenAssemblies(bob);
    expect(before.map((a) => a.title)).toEqual(["Still open"]);
    expect(before[0].needsMyAnswer).toBe(true);
    expect(before[0].questionCount).toBe(1);
    expect(before[0].myResponseCount).toBe(0);

    await submitAssemblyResponse(bob, item.id, { value: "a" });
    const after = await listOpenAssemblies(bob);
    expect(after[0].needsMyAnswer).toBe(false);
    expect(after[0].myResponseCount).toBe(1);
  });

  it("does not treat another member's finished ballot as yours", async () => {
    const { alice, bob } = await createFixtures();
    const a = await createAssembly(alice, {
      title: "Shared",
      agendaMinutes: 0,
      noticeMinutes: 0,
      votingMinutes: 60,
    });
    const [item] = await db
      .insert(assemblyQuestion)
      .values({ assemblyId: a.id, addedBy: alice.id, text: "Yes or no?" })
      .returning();
    await submitAssemblyResponse(alice, item.id, { value: "yes" });

    expect((await listOpenAssemblies(bob))[0].needsMyAnswer).toBe(true);
    expect((await listOpenAssemblies(alice))[0].needsMyAnswer).toBe(false);
  });
});

describe("getFoundersAssemblyPromptState", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("offers the prompt when it has never been shown, and stamps the clock", async () => {
    const { community: testCommunity } = await createFixtures();
    const [row] = await db
      .select()
      .from(communityTable)
      .where(eq(communityTable.id, testCommunity.id));
    expect(row.foundersAssemblyPromptedAt).toBeNull();

    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("show");

    const [after] = await db
      .select()
      .from(communityTable)
      .where(eq(communityTable.id, testCommunity.id));
    expect(after.foundersAssemblyPromptedAt).not.toBeNull();
  });

  it("keeps offering it inside the two-week window", async () => {
    const { community: testCommunity } = await createFixtures();
    await db
      .update(communityTable)
      .set({ foundersAssemblyPromptedAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) })
      .where(eq(communityTable.id, testCommunity.id));

    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("show");
  });

  it("stops offering it after a fortnight, and does not bring it back", async () => {
    const { community: testCommunity } = await createFixtures();
    const longAgo = new Date(Date.now() - (FOUNDERS_PROMPT_WINDOW_DAYS + 1) * 24 * 60 * 60 * 1000);
    await db
      .update(communityTable)
      .set({ foundersAssemblyPromptedAt: longAgo })
      .where(eq(communityTable.id, testCommunity.id));

    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("hidden");
    // A hidden prompt must not re-stamp and restart its own window.
    const [after] = await db
      .select()
      .from(communityTable)
      .where(eq(communityTable.id, testCommunity.id));
    expect(after.foundersAssemblyPromptedAt?.getTime()).toBe(longAgo.getTime());
  });

  it("disappears as soon as the settings Assembly exists, whatever the clock says", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("show");

    await createAssembly(alice, {
      title: "Founding settings",
      agendaMinutes: 60,
      noticeMinutes: 60,
      votingMinutes: 60,
      templateKey: FOUNDING_SETTINGS_TEMPLATE_KEY,
    });

    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("hidden");
  });

  it("does not mistake an ordinary Assembly for the settings one", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await createAssembly(alice, {
      title: "Where should the barrio go?",
      agendaMinutes: 60,
      noticeMinutes: 60,
      votingMinutes: 60,
    });
    expect(await getFoundersAssemblyPromptState(testCommunity.id)).toBe("show");
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

  // The three-value free_text/single_choice/multi_choice enum this used
  // to have became the shared six, so an agenda item can now ask for a
  // date or a figure — "how much of the budget does the seed capital
  // need?" was previously inexpressible, which for a body deciding how
  // to spend a real budget is a genuine hole.
  it("accepts the shared field shapes, and stores each as its own type", async () => {
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
        text: "How much seed capital do we need?",
        responseType: "number",
        min: 100,
      })
      .returning();

    expect((await submitAssemblyResponse(alice, item.id, { value: "2500" })).value).toBe(2500);
    await expect(submitAssemblyResponse(alice, item.id, { value: "50" })).rejects.toThrow(/at least/);
    await expect(submitAssemblyResponse(alice, item.id, { value: "lots" })).rejects.toThrow(ConflictError);

    // Abstaining from an item is a complete position, and a member does
    // it by not submitting — but pressing the button on an empty box has
    // to be reported, not silently ignored. `assembly_response.value` is
    // NOT NULL, so this is rejected as a value rather than failing on
    // the constraint, and the wording says what's actually wrong
    // instead of calling the answer "required".
    await expect(submitAssemblyResponse(alice, item.id, { value: "" })).rejects.toThrow(
      /leave this item unanswered/,
    );
  });

  // The escape hatch on a vote. The tally can't attribute free text to
  // an option, so the assembly page counts those separately rather than
  // letting the percentages disagree with the response count above them;
  // this is the lib half of that, confirming the words actually get
  // stored rather than being rejected as an invalid option.
  it("stores free text on a choice item that offers an escape hatch", async () => {
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
        text: "Which spot?",
        responseType: "single_choice",
        options: ["north", "south"],
        allowOther: true,
      })
      .returning();

    await submitAssemblyResponse(alice, item.id, { value: "north" });
    expect((await submitAssemblyResponse(bob, item.id, { value: "the hill" })).value).toBe("the hill");

    const detail = await getAssembly(alice, a.id);
    // Both responses are present, and the second is attributable to no
    // option — which is what the page's separate "wrote their own
    // answer" row exists to account for.
    expect(detail.questions[0].responses).toHaveLength(2);
    expect(detail.questions[0].responses.map((r) => r.value).sort()).toEqual(["north", "the hill"]);
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

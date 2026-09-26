import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, profileAnswer, task, taskAssignment } from "@/db/schema";
import { closeCycle, createCycle } from "@/lib/cycles";
import { claimTask } from "@/lib/tasks";
import {
  answerProfileQuestion,
  archiveProfileQuestion,
  createProfileQuestion,
  getCurrentCycle,
  getCurrentPhase,
  listCapacitySignal,
  listOnceEverAnswers,
  listOutstandingQuestions,
  listOutstandingRequiredQuestions,
  listProfileQuestions,
  unarchiveProfileQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, grantPermission, resetDatabase } from "./helpers";

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
      title: "Some task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("ProfileQuestion CRUD", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("creates a once_ever free-text question", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
    });
    expect(q.scope).toBe("once_ever");
    expect(q.phaseNameHint).toBeNull();
  });

  it("rejects a phase-scoped question with no phaseNameHint", async () => {
    const { alice } = await createFixtures();
    await expect(
      createProfileQuestion(alice, {
        label: "Availability — Build",
        responseType: "text",
        scope: "phase",
      } as never),
    ).rejects.toThrow(AppError);
  });

  it("rejects a choice-type question with no options", async () => {
    const { alice } = await createFixtures();
    await expect(
      createProfileQuestion(alice, {
        label: "Arrival method",
        responseType: "single_choice",
        scope: "once_ever",
      } as never),
    ).rejects.toThrow(AppError);
  });

  it("clears every field-shape flag that no longer applies when the type changes", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Hours a week",
      responseType: "number",
      scope: "once_ever",
      min: 1,
      max: 40,
      step: 1,
    });
    expect(q).toMatchObject({ min: 1, max: 40, step: 1 });

    // Becoming a choice field: options arrive, the number bounds go, and
    // the escape hatch becomes meaningful for the first time.
    const asChoice = await updateProfileQuestion(alice, q.id, {
      responseType: "single_choice",
      options: ["a few", "a lot"],
      allowOther: true,
    });
    expect(asChoice).toMatchObject({ responseType: "single_choice", options: ["a few", "a lot"], allowOther: true });
    expect(asChoice.min).toBeNull();
    expect(asChoice.max).toBeNull();
    expect(asChoice.step).toBeNull();

    // Becoming a text field: the escape hatch stops meaning anything.
    const asText = await updateProfileQuestion(alice, q.id, {
      responseType: "text",
      options: [],
      multiline: true,
      validation: "email",
    });
    expect(asText).toMatchObject({ responseType: "text", multiline: true, validation: "email" });
    expect(asText.options).toEqual([]);
    expect(asText.allowOther).toBe(false);
  });

  it("leaves the field-shape columns alone when only the label changes", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Hours",
      responseType: "number",
      scope: "once_ever",
      min: 2,
      max: 20,
    });
    const renamed = await updateProfileQuestion(alice, q.id, { label: "Hours available" });
    expect(renamed).toMatchObject({ label: "Hours available", min: 2, max: 20 });
  });

  it("updates label/required/feedsCapacitySignal, leaving scope/type alone when not asked to change them", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    const updated = await updateProfileQuestion(alice, q.id, { label: "Pronouns (optional)", required: true });
    expect(updated.label).toBe("Pronouns (optional)");
    expect(updated.required).toBe(true);
    expect(updated.scope).toBe("once_ever");
    expect(updated.responseType).toBe("text");
  });

  // docs/development-plan.md's Phase 58 — responseType/options become
  // genuinely editable post-creation too ("editable the same as a
  // freshly-created one"), a real loosening of this table's previous
  // "structural shape doesn't change" posture. scope/phaseNameHint stay
  // fixed regardless — they're not part of updateProfileQuestionInput
  // at all, so there's no way to change them through this path.
  describe("Phase 58: editing responseType/options post-creation", () => {
    it("can switch a free_text question into a choice type with options", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Preferred contact",
        responseType: "text",
        scope: "once_ever",
      });
      const updated = await updateProfileQuestion(alice, q.id, {
        responseType: "single_choice",
        options: ["Email", "Phone"],
      });
      expect(updated.responseType).toBe("single_choice");
      expect(updated.options).toEqual(["Email", "Phone"]);
    });

    it("rejects switching to a choice type with no options given", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Preferred contact",
        responseType: "text",
        scope: "once_ever",
      });
      await expect(updateProfileQuestion(alice, q.id, { responseType: "single_choice" })).rejects.toThrow(
        AppError,
      );
    });

    it("clears stale options when switching away from a choice type", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Preferred contact",
        responseType: "single_choice",
        options: ["Email", "Phone"],
        scope: "once_ever",
      });
      const updated = await updateProfileQuestion(alice, q.id, { responseType: "text" });
      expect(updated.responseType).toBe("text");
      expect(updated.options).toEqual([]);
    });

    it("can add an option to an already-choice-typed question without resending responseType", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Preferred contact",
        responseType: "single_choice",
        options: ["Email"],
        scope: "once_ever",
      });
      const updated = await updateProfileQuestion(alice, q.id, { options: ["Email", "Phone"] });
      expect(updated.options).toEqual(["Email", "Phone"]);
      expect(updated.responseType).toBe("single_choice");
    });

    it("editing responseType/options never touches an existing ProfileAnswer's own recorded value", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Preferred contact",
        responseType: "text",
        scope: "once_ever",
      });
      const { answerProfileQuestion, listOnceEverAnswers } = await import("@/lib/profile-questions/answers");
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "carrier pigeon" });

      await updateProfileQuestion(alice, q.id, { label: "Preferred contact method (renamed)" });

      const answers = await listOnceEverAnswers(alice);
      const mine = answers.find((a) => a.question.id === q.id);
      expect(mine?.answer.value).toBe("carrier pigeon");
    });
  });

  it("archives and unarchives, and archived questions are excluded from the default list", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Retired question",
      responseType: "text",
      scope: "once_ever",
    });

    await archiveProfileQuestion(alice, q.id);
    const active = await listProfileQuestions(alice);
    expect(active.find((r) => r.id === q.id)).toBeUndefined();

    const withArchived = await listProfileQuestions(alice, { includeArchived: true });
    expect(withArchived.some((r) => r.id === q.id && r.archivedAt !== null)).toBe(true);

    await unarchiveProfileQuestion(alice, q.id);
    const activeAgain = await listProfileQuestions(alice);
    expect(activeAgain.some((r) => r.id === q.id)).toBe(true);
  });

  it("rejects updating/archiving a question from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice } = await createFixtures();
    const strangerQuestion = await createProfileQuestion(strangerAlice, {
      label: "Elsewhere",
      responseType: "text",
      scope: "once_ever",
    });

    await expect(updateProfileQuestion(alice, strangerQuestion.id, { label: "Hijacked" })).rejects.toThrow(
      NotFoundError,
    );
    await expect(archiveProfileQuestion(alice, strangerQuestion.id)).rejects.toThrow(NotFoundError);
  });
});

describe("answering profile questions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("answers a once_ever question with cycleId null, and it becomes editable via listOnceEverAnswers", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
    });

    const answer = await answerProfileQuestion(alice, q.id, { status: "answered", value: "Jane, 555-1234" });
    expect(answer.cycleId).toBeNull();
    expect(answer.value).toBe("Jane, 555-1234");

    const onceEver = await listOnceEverAnswers(alice);
    expect(onceEver).toHaveLength(1);
    expect(onceEver[0].answer.value).toBe("Jane, 555-1234");
  });

  it("listOnceEverAnswers({ surface }) narrows to answered questions tagged for that surface", async () => {
    const { alice } = await createFixtures();
    const onboardingTagged = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
      surfaces: ["onboarding"],
    });
    const untagged = await createProfileQuestion(alice, {
      label: "Favorite color",
      responseType: "text",
      scope: "once_ever",
    });
    await answerProfileQuestion(alice, onboardingTagged.id, { status: "answered", value: "she/her" });
    await answerProfileQuestion(alice, untagged.id, { status: "answered", value: "blue" });

    const forOnboarding = await listOnceEverAnswers(alice, { surface: "onboarding" });
    expect(forOnboarding).toHaveLength(1);
    expect(forOnboarding[0].question.id).toBe(onboardingTagged.id);

    const everything = await listOnceEverAnswers(alice);
    expect(everything).toHaveLength(2);
  });

  it("re-answering the same question updates the existing row rather than creating a second one", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });

    await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
    const second = await answerProfileQuestion(alice, q.id, { status: "answered", value: "they/them" });

    const rows = await db.select().from(profileAnswer).where(eq(profileAnswer.memberId, alice.id));
    expect(rows).toHaveLength(1);
    expect(second.value).toBe("they/them");
  });

  it("defers a required question without a value, clearing any prior value", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "T-shirt size",
      responseType: "single_choice",
      options: ["S", "M", "L"],
      scope: "once_ever",
      required: true,
    });

    await answerProfileQuestion(alice, q.id, { status: "answered", value: "M" });
    const deferred = await answerProfileQuestion(alice, q.id, { status: "deferred" });
    expect(deferred.status).toBe("deferred");
    expect(deferred.value).toBeNull();
  });

  it("rejects a single_choice answer outside the option list", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Arrival method",
      responseType: "single_choice",
      options: ["car", "bike"],
      scope: "once_ever",
    });

    await expect(
      answerProfileQuestion(alice, q.id, { status: "answered", value: "teleport" }),
    ).rejects.toThrow(ConflictError);
  });

  it("accepts a multi_choice answer as a subset of options", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Skills",
      responseType: "multi_choice",
      options: ["carpentry", "electrical", "cooking"],
      scope: "once_ever",
    });

    const answer = await answerProfileQuestion(alice, q.id, {
      status: "answered",
      value: ["carpentry", "cooking"],
    });
    expect(answer.value).toEqual(["carpentry", "cooking"]);
  });

  it("accepts a well-formed date answer and rejects a malformed one", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Birthday",
      responseType: "date",
      scope: "once_ever",
    });

    const answer = await answerProfileQuestion(alice, q.id, { status: "answered", value: "1990-07-14" });
    expect(answer.value).toBe("1990-07-14");

    await expect(
      answerProfileQuestion(alice, q.id, { status: "answered", value: "not a date" }),
    ).rejects.toThrow(ConflictError);
    await expect(
      answerProfileQuestion(alice, q.id, { status: "answered", value: "07/14/1990" }),
    ).rejects.toThrow(ConflictError);
  });

  it("stores a boolean as a real boolean, and rejects anything that isn't yes or no", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "boolean",
      scope: "once_ever",
    });

    // "no" is a real answer, not an absent one — which is exactly why
    // isBlankValue doesn't treat false as blank.
    const no = await answerProfileQuestion(alice, q.id, { status: "answered", value: "false" });
    expect(no.value).toBe(false);
    const yes = await answerProfileQuestion(alice, q.id, { status: "answered", value: "true" });
    expect(yes.value).toBe(true);

    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "maybe" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("stores a number as a real number, enforcing min/max", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Hours a week you can give",
      responseType: "number",
      scope: "once_ever",
      min: 1,
      max: 40,
      step: 1,
    });

    const answer = await answerProfileQuestion(alice, q.id, { status: "answered", value: "12" });
    expect(answer.value).toBe(12);

    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "0" })).rejects.toThrow(/at least/);
    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "60" })).rejects.toThrow(/at most/);
    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "lots" })).rejects.toThrow(ConflictError);
  });

  it("checks a text field's format when one is configured", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Best way to reach you",
      responseType: "text",
      scope: "once_ever",
      validation: "email",
    });

    const ok = await answerProfileQuestion(alice, q.id, { status: "answered", value: "sam@example.com" });
    expect(ok.value).toBe("sam@example.com");

    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "sam at example" })).rejects.toThrow(
      /email/,
    );

    // The same field with no format check accepts it — the check belongs
    // to the shape, not to "text".
    const unchecked = await createProfileQuestion(alice, {
      label: "Anything",
      responseType: "text",
      scope: "once_ever",
    });
    await expect(
      answerProfileQuestion(alice, unchecked.id, { status: "answered", value: "sam at example" }),
    ).resolves.toBeTruthy();
  });

  // The escape hatch is the whole reason a choice list can be aggregated
  // without being a closed door: the list stays countable, and the tail
  // is still captured as words.
  it("accepts free text on a choice field that offers an escape hatch, and refuses it otherwise", async () => {
    const { alice } = await createFixtures();
    const open = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "single_choice",
      options: ["she/her", "he/him", "they/them"],
      scope: "once_ever",
      allowOther: true,
    });
    const closed = await createProfileQuestion(alice, {
      label: "Pronouns (no escape)",
      responseType: "single_choice",
      options: ["she/her", "he/him", "they/them"],
      scope: "once_ever",
    });

    // A real option still validates, and the free text stores as an
    // ordinary string so an aggregate needs no special case to count it.
    expect((await answerProfileQuestion(alice, open.id, { status: "answered", value: "they/them" })).value).toBe(
      "they/them",
    );
    expect((await answerProfileQuestion(alice, open.id, { status: "answered", value: "xe/xem" })).value).toBe("xe/xem");

    await expect(answerProfileQuestion(alice, closed.id, { status: "answered", value: "xe/xem" })).rejects.toThrow(
      /one of the options/,
    );
  });

  it("keeps a multi_choice escape hatch to one piece of free text", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "What do you need on site?",
      responseType: "multi_choice",
      options: ["bed", "power", "fridge"],
      scope: "once_ever",
      allowOther: true,
    });

    const answer = await answerProfileQuestion(alice, q.id, {
      status: "answered",
      value: ["bed", "a tent pole"],
    });
    expect(answer.value).toEqual(["bed", "a tent pole"]);

    await expect(
      answerProfileQuestion(alice, q.id, { status: "answered", value: ["a tent pole", "a big tarp"] }),
    ).rejects.toThrow(/own words/);
  });

  it("stores a long text answer as a plain string, same as a short one", async () => {
    const { alice } = await createFixtures();
    const short = await createProfileQuestion(alice, {
      label: "T-shirt size",
      responseType: "text",
      scope: "once_ever",
    });
    const long = await createProfileQuestion(alice, {
      label: "Anything the site should know",
      responseType: "text",
      scope: "once_ever",
      multiline: true,
    });

    // multiline is presentational — the stored value is a string either
    // way, so nothing downstream has to know which kind it was.
    expect((await answerProfileQuestion(alice, short.id, { status: "answered", value: "M" })).value).toBe("M");
    expect((await answerProfileQuestion(alice, long.id, { status: "answered", value: "line one\nline two" })).value).toBe(
      "line one\nline two",
    );
  });

  it("stamps the current cycle's id on a per_cycle answer, and rejects when there's no current cycle", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Post-cycle feedback opt-in",
      responseType: "single_choice",
      options: ["yes", "no"],
      scope: "per_cycle",
    });

    await expect(answerProfileQuestion(alice, q.id, { status: "answered", value: "yes" })).rejects.toThrow(
      ConflictError,
    );

    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "2027 Season" });
    const answered = await answerProfileQuestion(alice, q.id, { status: "answered", value: "yes" });
    expect(answered.cycleId).toBe(cyc.id);
  });
});

describe("current cycle/phase resolution", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("getCurrentCycle returns the most recently started cycle, or null with none", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    expect(await getCurrentCycle(testCommunity.id)).toBeNull();

    await enableCycles(testCommunity.id);
    await createCycle(alice, { source: "blank", name: "Old" });
    const newer = await createCycle(alice, { source: "clone_previous", name: "New", confirmed: true });

    const current = await getCurrentCycle(testCommunity.id);
    expect(current?.id).toBe(newer.id);
  });

  it("getCurrentPhase picks the earliest phase that hasn't ended yet, or null if all have", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);

    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [
        { name: "Recruiting", order: 0, startDate: null, endDate: yesterday },
        { name: "Build", order: 1, startDate: null, endDate: nextWeek },
      ],
    });

    const current = await getCurrentPhase(testCommunity.id);
    expect(current?.name).toBe("Build");
  });

  it("returns null when every phase has already ended", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await enableCycles(testCommunity.id);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Recruiting", order: 0, startDate: null, endDate: yesterday }],
    });

    expect(await getCurrentPhase(testCommunity.id)).toBeNull();
  });
});

describe("listOutstandingQuestions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("surfaces an unanswered once_ever question and excludes an answered one", async () => {
    const { alice } = await createFixtures();
    const unanswered = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
    });
    const answered = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    await answerProfileQuestion(alice, answered.id, { status: "answered", value: "they/them" });

    const outstanding = await listOutstandingQuestions(alice);
    const ids = outstanding.map((o) => o.question.id);
    expect(ids).toContain(unanswered.id);
    expect(ids).not.toContain(answered.id);
  });

  it("re-surfaces a deferred question", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "T-shirt size",
      responseType: "text",
      scope: "once_ever",
    });
    await answerProfileQuestion(alice, q.id, { status: "deferred" });

    const outstanding = await listOutstandingQuestions(alice);
    expect(outstanding.some((o) => o.question.id === q.id)).toBe(true);
  });

  it("a phase-scoped question doesn't surface without a matching current phase", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "Build",
    });

    // No cycle at all yet.
    expect(await listOutstandingQuestions(alice)).toHaveLength(0);

    // A cycle exists, but its phase is named differently.
    await enableCycles(testCommunity.id);
    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Recruiting", order: 0, startDate: null, endDate: null }],
    });
    expect(await listOutstandingQuestions(alice)).toHaveLength(0);
  });

  it("a phase-scoped question surfaces once the current cycle has a matching phase name", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "build",
    });

    await enableCycles(testCommunity.id);
    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: null, endDate: null }],
    });

    const outstanding = await listOutstandingQuestions(alice);
    expect(outstanding.some((o) => o.question.id === q.id)).toBe(true);
  });

  // phaseForCycle deliberately ignores start dates (it answers "which
  // phase drives the nav highlight", where a not-yet-started phase is
  // still the one coming up). That's wrong for questions: a community
  // that lays out its whole season up front shouldn't have every future
  // phase's questions counting against every member from day one.
  it("a phase-scoped question does not surface before its phase has started", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const upcoming = await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "Build",
      required: true,
    });

    const nextMonth = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

    await enableCycles(testCommunity.id);
    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: nextMonth, endDate: null }],
    });

    // Not outstanding for the page, and not counted against the badge.
    expect((await listOutstandingQuestions(alice)).some((o) => o.question.id === upcoming.id)).toBe(false);
    expect(await listOutstandingRequiredQuestions(alice)).toHaveLength(0);
  });

  it("a phase-scoped question does surface once its phase has started", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const started = await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "Build",
      required: true,
    });

    const lastMonth = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    await enableCycles(testCommunity.id);
    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: lastMonth, endDate: null }],
    });

    const outstanding = await listOutstandingQuestions(alice);
    expect(outstanding.some((o) => o.question.id === started.id)).toBe(true);
    expect((await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id)).toContain(started.id);
  });
});

describe("listOutstandingQuestions with an explicit cycleId", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The declare-joining controls name the event they just declared for, so
  // /questions can be "this event's questions" rather than "whatever cycle
  // this member last declared on" — the two differ whenever a member has
  // declared for more than one open event.
  it("resolves a per_cycle question against the named event, not the declared one", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "single_choice",
      options: ["yes", "no"],
      scope: "per_cycle",
    });
    await enableCycles(testCommunity.id);
    const first = await createCycle(alice, { source: "blank", name: "First" });
    const second = await createCycle(alice, { source: "blank", name: "Second", confirmed: true });

    // Answered against `first` explicitly, while the member's own declared
    // cycle resolves to something else (or nothing, here).
    const answered = await answerProfileQuestion(alice, q.id, {
      status: "answered",
      value: "yes",
      cycleId: first.id,
    });
    expect(answered.cycleId).toBe(first.id);

    // So asking about `first` is satisfied, but asking about `second` isn't.
    const aboutFirst = await listOutstandingQuestions(alice, { cycleId: first.id });
    expect(aboutFirst.some((o) => o.question.id === q.id)).toBe(false);
    const aboutSecond = await listOutstandingQuestions(alice, { cycleId: second.id });
    expect(aboutSecond.some((o) => o.question.id === q.id)).toBe(true);
  });

  it("rejects a cycleId from another community rather than stamping the answer anywhere", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "text",
      scope: "per_cycle",
    });

    // A second community, with its own open cycle — a client-supplied uuid
    // naming someone else's event must not be able to stamp an answer
    // against it.
    const stranger = await createFixtures();
    await enableCycles(stranger.community.id);
    const foreign = await createCycle(stranger.alice, { source: "blank", name: "Foreign" });

    await expect(
      answerProfileQuestion(alice, q.id, { status: "answered", value: "no", cycleId: foreign.id }),
    ).rejects.toThrow(NotFoundError);

    const rows = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, q.id));
    expect(rows).toHaveLength(0);
  });

  it("degrades to no event-scoped questions for an unknown or closed cycleId", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "text",
      scope: "per_cycle",
    });
    await enableCycles(testCommunity.id);
    const cyc = await createCycle(alice, { source: "blank", name: "Season" });
    await closeCycle(alice, cyc.id);

    // A stale link shouldn't error — /questions is a link target, and
    // links go stale.
    expect(await listOutstandingQuestions(alice, { cycleId: cyc.id })).toHaveLength(0);
    expect(
      await listOutstandingQuestions(alice, { cycleId: "00000000-0000-0000-0000-000000000000" }),
    ).toHaveLength(0);
  });
});

describe("listOutstandingRequiredQuestions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  // The count behind the Dashboard element and badge, which is what makes
  // the one-click "I'm coming" safe to offer without walking the member
  // through that event's questions first.
  it("counts only required questions with no answer at all", async () => {
    const { alice } = await createFixtures();
    const required = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
      required: true,
    });
    const optional = await createProfileQuestion(alice, {
      label: "T-shirt size",
      responseType: "text",
      scope: "once_ever",
    });
    const answeredRequired = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
      required: true,
    });
    await answerProfileQuestion(alice, answeredRequired.id, { status: "answered", value: "they/them" });

    const outstanding = await listOutstandingRequiredQuestions(alice);
    expect(outstanding.map((o) => o.question.id)).toEqual([required.id]);
    expect(outstanding.map((o) => o.question.id)).not.toContain(optional.id);
  });

  // profile_answer.ts's own schema comment: a deferred status satisfies a
  // required question without a guessed or fabricated value. Nagging past
  // an explicit "I don't know yet" would punish the honesty that button
  // exists to allow, and would never clear.
  it("treats a deferred answer to a required question as satisfied", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
      required: true,
    });
    await answerProfileQuestion(alice, q.id, { status: "deferred" });

    // Still answerable later on /questions (deferred counts as outstanding
    // there), but no longer something the Dashboard badge chases.
    expect((await listOutstandingQuestions(alice)).some((o) => o.question.id === q.id)).toBe(true);
    expect(await listOutstandingRequiredQuestions(alice)).toHaveLength(0);
  });

  // "I don't know yet" is the right answer for a bed count in March and
  // the wrong answer the week the community books transport. A due date
  // makes a deferral time-boxed instead of permanent.
  it("a deferred answer stops satisfying the question once its due date passes", async () => {
    const { alice } = await createFixtures();
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

    const overdue = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "text",
      scope: "once_ever",
      required: true,
      requiredBy: yesterday,
    });
    const stillTime = await createProfileQuestion(alice, {
      label: "Vehicle size",
      responseType: "text",
      scope: "once_ever",
      required: true,
      requiredBy: nextWeek,
    });
    await answerProfileQuestion(alice, overdue.id, { status: "deferred" });
    await answerProfileQuestion(alice, stillTime.id, { status: "deferred" });

    // Only the one whose date has passed.
    const ids = (await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id);
    expect(ids).toContain(overdue.id);
    expect(ids).not.toContain(stillTime.id);
  });

  it("rejects a due date on a question that isn't required", async () => {
    const { alice } = await createFixtures();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    await expect(
      createProfileQuestion(alice, {
        label: "T-shirt size",
        responseType: "text",
        scope: "once_ever",
        requiredBy: tomorrow,
      }),
    ).rejects.toThrow(/due date/i);

    // ...and on a question with no "I don't know yet" to apply it to.
    await expect(
      createProfileQuestion(alice, {
        label: "T-shirt size",
        responseType: "text",
        scope: "once_ever",
        required: true,
        allowDeferral: false,
        requiredBy: tomorrow,
      }),
    ).rejects.toThrow(/due date/i);
  });

  // Some questions have no "not yet" — a date of birth, a legal name.
  // There the button isn't offered, and a stored deferral isn't an
  // answer, so the question stays on the list.
  it("a deferral on a non-deferrable question doesn't satisfy it", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Date of birth",
      responseType: "date",
      scope: "once_ever",
      required: true,
      allowDeferral: false,
    });
    expect(q.allowDeferral).toBe(false);
    await answerProfileQuestion(alice, q.id, { status: "deferred" });

    expect((await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id)).toContain(q.id);

    await answerProfileQuestion(alice, q.id, { status: "answered", value: "1990-04-01" });
    expect((await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id)).not.toContain(q.id);
  });

  it("defaults to allowing deferral but not prefer-not-to-say", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
    });
    expect(q.allowDeferral).toBe(true);
    // Offering a way out of answering by default would quietly make every
    // question optional; it's a per-question decision.
    expect(q.allowPreferNotToSay).toBe(false);
  });

  // A refusal is not an unfinished form. Once given it's permanent, and
  // nothing chases it — no due date, no nag.
  it("a declined answer satisfies a required question permanently, past any due date", async () => {
    const { alice } = await createFixtures();
    const longAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const q = await createProfileQuestion(alice, {
      label: "How should we refer to you?",
      responseType: "text",
      scope: "once_ever",
      required: true,
      allowPreferNotToSay: true,
      // A due date that would have resurrected a deferral. A decline is
      // different: it is not a promise of a later answer.
      requiredBy: longAgo,
    });

    const declined = await answerProfileQuestion(alice, q.id, { status: "declined" });
    expect(declined.status).toBe("declined");
    expect(declined.value).toBeNull();

    expect(await listOutstandingRequiredQuestions(alice)).toHaveLength(0);
  });

  it("rejects a decline on a question that doesn't offer one", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you hold a driving licence?",
      responseType: "single_choice",
      options: ["yes", "no"],
      scope: "once_ever",
      required: true,
    });
    expect(q.allowPreferNotToSay).toBe(false);

    await expect(answerProfileQuestion(alice, q.id, { status: "declined" })).rejects.toThrow(ConflictError);
    // And nothing was written.
    expect(await listOnceEverAnswers(alice)).toHaveLength(0);
  });

  // Turning the option off afterwards mustn't leave a standing exemption.
  it("a stored decline stops satisfying the question once the option is withdrawn", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "single_choice",
      options: ["yes", "no"],
      scope: "once_ever",
      required: true,
      allowPreferNotToSay: true,
    });
    await answerProfileQuestion(alice, q.id, { status: "declined" });
    expect(await listOutstandingRequiredQuestions(alice)).toHaveLength(0);

    await updateProfileQuestion(alice, q.id, { allowPreferNotToSay: false });
    expect((await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id)).toContain(q.id);
  });

  // Someone who said "I don't know yet" and someone who said "I'd rather
  // not say" have both responded — neither should be reported as
  // unanswered, and neither should show as a value.
  it("listOnceEverAnswers includes deferred and declined rows so a member can change their mind", async () => {
    const { alice } = await createFixtures();
    const deferred = await createProfileQuestion(alice, {
      label: "Vehicle size",
      responseType: "text",
      scope: "once_ever",
    });
    const declined = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "text",
      scope: "once_ever",
      allowPreferNotToSay: true,
    });
    const answered = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
    });

    await answerProfileQuestion(alice, deferred.id, { status: "deferred" });
    await answerProfileQuestion(alice, declined.id, { status: "declined" });
    await answerProfileQuestion(alice, answered.id, { status: "answered", value: "Sam" });

    const rows = await listOnceEverAnswers(alice);
    expect(rows.map((r) => r.answer.status).sort()).toEqual(["answered", "declined", "deferred"]);
  });

  // The settings form resubmits the date input whenever it's on the
  // page, so turning deferral (or required) off alongside a stored date
  // is an ordinary save — it must clear the date, not reject.
  it("turning off required or deferral clears a stored due date rather than rejecting the save", async () => {
    const { alice } = await createFixtures();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "text",
      scope: "once_ever",
      required: true,
      requiredBy: tomorrow,
    });

    const noLongerRequired = await updateProfileQuestion(alice, q.id, { required: false });
    expect(noLongerRequired.requiredBy).toBeNull();

    const back = await updateProfileQuestion(alice, q.id, { required: true, requiredBy: tomorrow });
    expect(back.requiredBy).toBe(tomorrow);

    const noLongerDeferrable = await updateProfileQuestion(alice, q.id, { allowDeferral: false });
    expect(noLongerDeferrable.allowDeferral).toBe(false);
    expect(noLongerDeferrable.requiredBy).toBeNull();
  });

  it("counts a required per-event question the member hasn't answered for that event", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "single_choice",
      options: ["yes", "no"],
      scope: "per_cycle",
      required: true,
    });
    await enableCycles(testCommunity.id);
    const first = await createCycle(alice, { source: "blank", name: "First" });
    const second = await createCycle(alice, { source: "blank", name: "Second", confirmed: true });

    await answerProfileQuestion(alice, q.id, { status: "answered", value: "no", cycleId: first.id });

    // Answered for one event, so it drops off — but only for that one.
    expect((await listOutstandingRequiredQuestions(alice)).map((o) => o.question.id)).not.toContain(q.id);
    const aboutSecond = await listOutstandingQuestions(alice, { cycleId: second.id });
    expect(aboutSecond.some((o) => o.question.id === q.id)).toBe(true);
  });
});

describe("listCapacitySignal (Coordination view)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function setUpPhaseAndQuestion(communityId: string, alice: Awaited<ReturnType<typeof createFixtures>>["alice"]) {
    await enableCycles(communityId);
    const cyc = await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: null, endDate: null }],
    });
    const question = await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "Build",
      feedsCapacitySignal: true,
    });
    return { cyc, question };
  }

  it("rejects a non-coordination-holder", async () => {
    const { alice } = await createFixtures();
    await expect(listCapacitySignal(alice)).rejects.toThrow(ForbiddenError);
  });

  // A decline carries a null value, so without this it would fall
  // through to parseDeclaredHours and be reported as an answered member
  // with no declared hours rather than as someone who hasn't given one.
  it("lists a member who declined as a non-responder, not an answer with no hours", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, coordTask.id);
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await enableCycles(testCommunity.id);
    await createCycle(alice, {
      source: "blank",
      name: "Season",
      phases: [{ name: "Build", order: 0, startDate: null, endDate: null }],
    });
    const question = await createProfileQuestion(alice, {
      label: "Availability — Build",
      responseType: "text",
      scope: "phase",
      phaseNameHint: "Build",
      feedsCapacitySignal: true,
      allowPreferNotToSay: true,
    });

    await answerProfileQuestion(alice, question.id, { status: "declined" });

    const { entries } = await listCapacitySignal(alice);
    const alices = entries.find((e) => e.memberId === alice.id)!;
    // They did respond, just not with a number — which is a fourth
    // state the view has to be able to show, not a fifth kind of answer.
    expect(alices.hasAnswer).toBe(true);
    expect(alices.declined).toBe(true);
    expect(alices.deferred).toBe(false);
    expect(alices.declaredHours).toBeNull();
    expect(alices.flag).toBeNull();
  });

  it("lists members with no answer as non-responders", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, coordTask.id);
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    await setUpPhaseAndQuestion(testCommunity.id, alice);

    const { entries, phaseName, questionLabel } = await listCapacitySignal(alice);
    expect(phaseName).toBe("Build");
    expect(questionLabel).toBe("Availability — Build");
    const bobEntry = entries.find((e) => e.memberId === bob.id);
    expect(bobEntry?.hasAnswer).toBe(false);
  });

  it("shows the exact declared number when capacityVisibility is open, a flag otherwise", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, coordTask.id);
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    const { question } = await setUpPhaseAndQuestion(testCommunity.id, alice);

    await answerProfileQuestion(bob, question.id, {
      status: "answered",
      value: "10",
      capacityVisibility: "open",
    });

    const { entries } = await listCapacitySignal(alice);
    const bobEntry = entries.find((e) => e.memberId === bob.id);
    expect(bobEntry?.declaredHours).toBe(10);
    expect(bobEntry?.capacityVisibility).toBe("open");
  });

  it("computes over/about_right/has_room from declared hours minus current ongoing load", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, coordTask.id);
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    const { question } = await setUpPhaseAndQuestion(testCommunity.id, alice);

    const heavyTask = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 12 },
    });
    await claimTask(bob, heavyTask.id);

    await answerProfileQuestion(bob, question.id, { status: "answered", value: "10" });

    const { entries } = await listCapacitySignal(alice);
    const bobEntry = entries.find((e) => e.memberId === bob.id);
    expect(bobEntry?.loadHours).toBe(12);
    expect(bobEntry?.flag).toBe("over");
  });

  it("excludes a one_off task's duration bucket and a shadow claim from the load calculation", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await claimTask(alice, coordTask.id);
    await grantPermission(testCommunity.id, "branch_coordination", coordTask.id);
    const { question } = await setUpPhaseAndQuestion(testCommunity.id, alice);

    const oneOff = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      effort: "one_off",
      effortMagnitude: { duration: "half_day" },
    });
    await claimTask(bob, oneOff.id);

    const shadowed = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      effort: "ongoing",
      effortMagnitude: { hours_per_week: 20 },
    });
    await db.insert(taskAssignment).values({ taskId: shadowed.id, memberId: bob.id, isShadow: true });

    await answerProfileQuestion(bob, question.id, { status: "answered", value: "10" });

    const { entries } = await listCapacitySignal(alice);
    const bobEntry = entries.find((e) => e.memberId === bob.id);
    expect(bobEntry?.loadHours).toBe(0);
    expect(bobEntry?.flag).toBe("has_room");
  });
});

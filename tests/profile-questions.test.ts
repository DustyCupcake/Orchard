import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, profileAnswer, task, taskAssignment } from "@/db/schema";
import { createCycle } from "@/lib/cycles";
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
  listProfileQuestions,
  unarchiveProfileQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

async function enableCycles(communityId: string) {
  await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
}

async function setCoordinationTag(communityId: string, tag = "coordination") {
  await db.update(community).set({ coordinationTag: tag }).where(eq(community.id, communityId));
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
      responseType: "free_text",
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
        responseType: "free_text",
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

  it("updates label/required/feedsCapacitySignal but leaves scope/type alone", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "free_text",
      scope: "once_ever",
    });
    const updated = await updateProfileQuestion(alice, q.id, { label: "Pronouns (optional)", required: true });
    expect(updated.label).toBe("Pronouns (optional)");
    expect(updated.required).toBe(true);
    expect(updated.scope).toBe("once_ever");
  });

  it("archives and unarchives, and archived questions are excluded from the default list", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Retired question",
      responseType: "free_text",
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
      responseType: "free_text",
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
      responseType: "free_text",
      scope: "once_ever",
    });

    const answer = await answerProfileQuestion(alice, q.id, { status: "answered", value: "Jane, 555-1234" });
    expect(answer.cycleId).toBeNull();
    expect(answer.value).toBe("Jane, 555-1234");

    const onceEver = await listOnceEverAnswers(alice);
    expect(onceEver).toHaveLength(1);
    expect(onceEver[0].answer.value).toBe("Jane, 555-1234");
  });

  it("re-answering the same question updates the existing row rather than creating a second one", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "free_text",
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
    const newer = await createCycle(alice, { source: "clone_previous", name: "New" });

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
      responseType: "free_text",
      scope: "once_ever",
    });
    const answered = await createProfileQuestion(alice, {
      label: "Pronouns",
      responseType: "free_text",
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
      responseType: "free_text",
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
      responseType: "free_text",
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
      responseType: "free_text",
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
      responseType: "free_text",
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

  it("lists members with no answer as non-responders", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    await setCoordinationTag(testCommunity.id);
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, coordTask.id);
    await setUpPhaseAndQuestion(testCommunity.id, alice);

    const { entries, phaseName, questionLabel } = await listCapacitySignal(alice);
    expect(phaseName).toBe("Build");
    expect(questionLabel).toBe("Availability — Build");
    const bobEntry = entries.find((e) => e.memberId === bob.id);
    expect(bobEntry?.hasAnswer).toBe(false);
  });

  it("shows the exact declared number when capacityVisibility is open, a flag otherwise", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    await setCoordinationTag(testCommunity.id);
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, coordTask.id);
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
    await setCoordinationTag(testCommunity.id);
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, coordTask.id);
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
    await setCoordinationTag(testCommunity.id);
    const coordTask = await insertTask(testCommunity.id, testBranch.id, alice.id, {
      tags: ["coordination"],
    });
    await claimTask(alice, coordTask.id);
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

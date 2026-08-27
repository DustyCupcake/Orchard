import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, task } from "@/db/schema";
import {
  createQuestion,
  getCurrentRound,
  getNextCutoffAt,
  listCurrentRoundQuestions,
  listTaskQuestions,
  resolveInputRounds,
  submitQuestionResponse,
} from "@/lib/input-rounds";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

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
      title: "Breakfast planning",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

async function setCutoff(communityId: string, cutoffAt: Date | null, intervalDays?: number) {
  await db
    .update(community)
    .set({
      nextInputRoundCutoffAt: cutoffAt,
      ...(intervalDays !== undefined && { inputRoundIntervalDays: intervalDays }),
    })
    .where(eq(community.id, communityId));
}

describe("createQuestion", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("queues a question with no round yet", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);

    const q = await createQuestion(alice, t.id, { text: "Pancakes or eggs?" });
    expect(q.roundId).toBeNull();
    expect(q.responseType).toBe("free_text");
  });

  it("rejects a choice-type question with no options", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);

    await expect(
      createQuestion(alice, t.id, { text: "Which?", responseType: "single_choice" }),
    ).rejects.toThrow(AppError);
  });

  it("accepts a single_choice question with options", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);

    const q = await createQuestion(alice, t.id, {
      text: "Pancakes, oatmeal, or eggs?",
      responseType: "single_choice",
      options: ["pancakes", "oatmeal", "eggs"],
    });
    expect(q.options).toEqual(["pancakes", "oatmeal", "eggs"]);
  });

  it("rejects posing a question against a task from another community", async () => {
    const { alice } = await createFixtures();
    const { alice: strangerAlice, branch: strangerBranch, community: strangerCommunity } =
      await createFixtures();
    const strangerTask = await insertTask(strangerCommunity.id, strangerBranch.id, strangerAlice.id);

    await expect(createQuestion(alice, strangerTask.id, { text: "Hijack?" })).rejects.toThrow(
      NotFoundError,
    );
  });
});

describe("listTaskQuestions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reports queued status before any round exists, and includes responses once open", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const q = await createQuestion(alice, t.id, { text: "Pancakes or eggs?" });

    const before = await listTaskQuestions(alice, t.id);
    expect(before[0].status).toBe("queued");
    expect(before[0].responses).toEqual([]);

    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();
    await submitQuestionResponse(alice, q.id, { value: "pancakes" });

    const after = await listTaskQuestions(alice, t.id);
    expect(after[0].status).toBe("open");
    expect(after[0].responses).toHaveLength(1);
  });

  it("reports closed status once a newer round has superseded this one", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await createQuestion(alice, t.id, { text: "First round question" });

    await setCutoff(testCommunity.id, new Date(Date.now() - 1000), 7);
    await resolveInputRounds();

    // Queue a second question and force another cutoff to supersede round 1.
    await createQuestion(alice, t.id, { text: "Second round question" });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();

    const questions = await listTaskQuestions(alice, t.id);
    const first = questions.find((q) => q.text === "First round question");
    const second = questions.find((q) => q.text === "Second round question");
    expect(first?.status).toBe("closed");
    expect(second?.status).toBe("open");
  });
});

describe("submitQuestionResponse", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("rejects answering a still-queued question", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const q = await createQuestion(alice, t.id, { text: "Pancakes or eggs?" });

    await expect(submitQuestionResponse(alice, q.id, { value: "pancakes" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("rejects answering a closed (superseded) question", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const q = await createQuestion(alice, t.id, { text: "First round question" });

    await setCutoff(testCommunity.id, new Date(Date.now() - 1000), 7);
    await resolveInputRounds();

    await createQuestion(alice, t.id, { text: "Second round question" });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();

    await expect(submitQuestionResponse(alice, q.id, { value: "anything" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("validates value against responseType/options, and upserts on resubmission", async () => {
    const { alice, bob, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const q = await createQuestion(alice, t.id, {
      text: "Pancakes, oatmeal, or eggs?",
      responseType: "single_choice",
      options: ["pancakes", "oatmeal", "eggs"],
    });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();

    await expect(submitQuestionResponse(bob, q.id, { value: "waffles" })).rejects.toThrow(
      ConflictError,
    );

    const first = await submitQuestionResponse(bob, q.id, { value: "pancakes" });
    expect(first.value).toBe("pancakes");

    const second = await submitQuestionResponse(bob, q.id, { value: "eggs" });
    expect(second.id).toBe(first.id);
    expect(second.value).toBe("eggs");
  });

  it("accepts a multi_choice answer as a subset of options", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const q = await createQuestion(alice, t.id, {
      text: "Which do you need?",
      responseType: "multi_choice",
      options: ["ladder", "drill", "paint"],
    });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();

    const response = await submitQuestionResponse(alice, q.id, { value: ["ladder", "paint"] });
    expect(response.value).toEqual(["ladder", "paint"]);
  });
});

describe("resolveInputRounds (scheduler)", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("anchors the cadence clock on its first run, without cutting a round", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await createQuestion(alice, t.id, { text: "Anything?" });

    const result = await resolveInputRounds();
    expect(result.anchored).toBeGreaterThanOrEqual(1);
    expect(result.roundsCreated).toBe(0);

    const [row] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(row.nextInputRoundCutoffAt).not.toBeNull();
    expect(await getCurrentRound(testCommunity.id)).toBeNull();
  });

  it("does not create a round at cutoff if nothing was queued", async () => {
    const { community: testCommunity } = await createFixtures();
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));

    const result = await resolveInputRounds();
    expect(result.roundsCreated).toBe(0);
    expect(await getCurrentRound(testCommunity.id)).toBeNull();

    // The clock still advances even though nothing fired.
    const [row] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(row.nextInputRoundCutoffAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("bundles every currently-queued question into one round at cutoff", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await createQuestion(alice, t.id, { text: "Q1" });
    await createQuestion(alice, t.id, { text: "Q2" });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));

    const result = await resolveInputRounds();
    expect(result.roundsCreated).toBe(1);
    expect(result.questionsBundled).toBe(2);

    const current = await getCurrentRound(testCommunity.id);
    const { questions } = await listCurrentRoundQuestions(alice);
    expect(current).not.toBeNull();
    expect(questions).toHaveLength(2);
  });

  it("catches up multiple missed intervals into a single round, without duplicating it", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await createQuestion(alice, t.id, { text: "Overdue question" });
    // 3 intervals behind, at a 1-day interval.
    await setCutoff(testCommunity.id, new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), 1);

    const result = await resolveInputRounds();
    expect(result.roundsCreated).toBe(1);
    expect(result.questionsBundled).toBe(1);

    const [row] = await db.select().from(community).where(eq(community.id, testCommunity.id));
    expect(row.nextInputRoundCutoffAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("is idempotent — running twice in a row does nothing the second time", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    await createQuestion(alice, t.id, { text: "Q1" });
    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));

    await resolveInputRounds();
    const second = await resolveInputRounds();
    expect(second.roundsCreated).toBe(0);
  });
});

describe("listCurrentRoundQuestions sort order", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("sorts by deadline proximity, then priority, with no-deadline questions last", async () => {
    const { alice, branch: testBranch, community: testCommunity } = await createFixtures();
    const t = await insertTask(testCommunity.id, testBranch.id, alice.id);
    const soon = new Date(Date.now() + 86400000).toISOString();
    const later = new Date(Date.now() + 5 * 86400000).toISOString();

    await createQuestion(alice, t.id, { text: "No deadline" });
    await createQuestion(alice, t.id, { text: "Later, priority", deadline: later, priority: true });
    await createQuestion(alice, t.id, { text: "Later, no priority", deadline: later });
    await createQuestion(alice, t.id, { text: "Soon", deadline: soon });

    await setCutoff(testCommunity.id, new Date(Date.now() - 1000));
    await resolveInputRounds();

    const { questions } = await listCurrentRoundQuestions(alice);
    expect(questions.map((q) => q.question.text)).toEqual([
      "Soon",
      "Later, priority",
      "Later, no priority",
      "No deadline",
    ]);
  });
});

describe("getNextCutoffAt", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("reads the Community's scheduled cutoff", async () => {
    const { alice, community: testCommunity } = await createFixtures();
    expect(await getNextCutoffAt(alice)).toBeNull();

    const future = new Date(Date.now() + 86400000);
    await setCutoff(testCommunity.id, future);
    expect((await getNextCutoffAt(alice))?.getTime()).toBe(future.getTime());
  });
});

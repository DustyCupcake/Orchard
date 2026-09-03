import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { member, requirement, task } from "@/db/schema";
import { createProfileQuestion } from "@/lib/profile-questions/questions";
import { listOutstandingQuestions } from "@/lib/profile-questions/answers";
import { completeOnboarding, listTaskFitSuggestions, ONBOARDING_CARDS } from "@/lib/onboarding";
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
      title: "Some task",
      effort: "one_off",
      effortMagnitude: { duration: "few_hours" },
      createdBy,
      ...overrides,
    })
    .returning();
  return row;
}

describe("Onboarding", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("Member.hasCompletedOnboarding defaults false and completeOnboarding sets it true", async () => {
    const { alice } = await createFixtures();
    expect(alice.hasCompletedOnboarding).toBe(false);

    await completeOnboarding(alice);
    const [reloaded] = await db.select().from(member).where(eq(member.id, alice.id));
    expect(reloaded.hasCompletedOnboarding).toBe(true);
  });

  it("ONBOARDING_CARDS is a non-empty, static set", () => {
    expect(ONBOARDING_CARDS.length).toBeGreaterThan(0);
    for (const card of ONBOARDING_CARDS) {
      expect(card.title.length).toBeGreaterThan(0);
      expect(card.body.length).toBeGreaterThan(0);
    }
  });

  describe("ProfileQuestion surfaces + listOutstandingQuestions surface filter", () => {
    it("only surfaces onboarding-tagged questions when filtered, and only while unanswered", async () => {
      const { alice } = await createFixtures();
      const onboardingQ = await createProfileQuestion(alice, {
        label: "What are you hoping to get out of this?",
        responseType: "free_text",
        scope: "once_ever",
        surfaces: ["onboarding"],
      });
      const otherQ = await createProfileQuestion(alice, {
        label: "Emergency contact",
        responseType: "free_text",
        scope: "once_ever",
      });

      const filtered = await listOutstandingQuestions(alice, { surface: "onboarding" });
      expect(filtered.map((o) => o.question.id)).toEqual([onboardingQ.id]);
      expect(filtered.map((o) => o.question.id)).not.toContain(otherQ.id);

      // Unfiltered still sees both.
      const unfiltered = await listOutstandingQuestions(alice);
      expect(unfiltered.map((o) => o.question.id).sort()).toEqual([onboardingQ.id, otherQ.id].sort());
    });

    it("createProfileQuestion/updateProfileQuestion round-trip the surfaces array", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Strengths",
        responseType: "free_text",
        scope: "once_ever",
      });
      expect(q.surfaces).toEqual([]);

      const { updateProfileQuestion } = await import("@/lib/profile-questions/questions");
      const updated = await updateProfileQuestion(alice, q.id, { surfaces: ["onboarding"] });
      expect(updated.surfaces).toEqual(["onboarding"]);
    });
  });

  describe("listTaskFitSuggestions", () => {
    it("includes an unclaimed task whose tags overlap the member's own", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      await db.update(member).set({ tags: ["carpentry"] }).where(eq(member.id, alice.id));
      const fitting = await insertTask(testCommunity.id, testBranch.id, alice.id, {
        title: "Build a stage",
        tags: ["carpentry"],
      });
      await insertTask(testCommunity.id, testBranch.id, alice.id, {
        title: "Unrelated task",
        tags: ["cooking"],
      });

      const [freshAlice] = await db.select().from(member).where(eq(member.id, alice.id));
      const suggestions = await listTaskFitSuggestions(freshAlice);
      expect(suggestions.map((s) => s.id)).toEqual([fitting.id]);
    });

    it("includes an unclaimed task whose individual_gate Requirement the member satisfies via a tag-based custom flag", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      await db.update(member).set({ tags: ["spanish"] }).where(eq(member.id, alice.id));
      const gated = await insertTask(testCommunity.id, testBranch.id, alice.id, { title: "Translate signage" });
      await db.insert(requirement).values({
        taskId: gated.id,
        type: "custom",
        mode: "individual_gate",
        value: { flag: "spanish" },
      });

      const [freshAlice] = await db.select().from(member).where(eq(member.id, alice.id));
      const suggestions = await listTaskFitSuggestions(freshAlice);
      expect(suggestions.map((s) => s.id)).toEqual([gated.id]);
    });

    it("excludes an unclaimed task whose individual_gate Requirement the member does NOT satisfy", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      const gated = await insertTask(testCommunity.id, testBranch.id, alice.id, { title: "Translate signage" });
      await db.insert(requirement).values({
        taskId: gated.id,
        type: "custom",
        mode: "individual_gate",
        value: { flag: "spanish" },
      });

      const suggestions = await listTaskFitSuggestions(alice);
      expect(suggestions.map((s) => s.id)).not.toContain(gated.id);
    });

    it("excludes tasks that aren't unclaimed", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      await db.update(member).set({ tags: ["carpentry"] }).where(eq(member.id, alice.id));
      await insertTask(testCommunity.id, testBranch.id, alice.id, {
        title: "Already claimed",
        tags: ["carpentry"],
        status: "claimed",
      });

      const [freshAlice] = await db.select().from(member).where(eq(member.id, alice.id));
      const suggestions = await listTaskFitSuggestions(freshAlice);
      expect(suggestions).toEqual([]);
    });

    it("respects excludeTaskId (the Done-confirmation 'related tasks' use)", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      await db.update(member).set({ tags: ["carpentry"] }).where(eq(member.id, alice.id));
      const justFinished = await insertTask(testCommunity.id, testBranch.id, alice.id, {
        title: "Already finished",
        tags: ["carpentry"],
      });
      const related = await insertTask(testCommunity.id, testBranch.id, alice.id, {
        title: "Related work",
        tags: ["carpentry"],
      });

      const [freshAlice] = await db.select().from(member).where(eq(member.id, alice.id));
      const suggestions = await listTaskFitSuggestions(freshAlice, { excludeTaskId: justFinished.id });
      expect(suggestions.map((s) => s.id)).toEqual([related.id]);
    });

    it("respects the limit option", async () => {
      const { alice, community: testCommunity, branch: testBranch } = await createFixtures();
      await db.update(member).set({ tags: ["carpentry"] }).where(eq(member.id, alice.id));
      for (let i = 0; i < 5; i++) {
        await insertTask(testCommunity.id, testBranch.id, alice.id, {
          title: `Task ${i}`,
          tags: ["carpentry"],
        });
      }

      const [freshAlice] = await db.select().from(member).where(eq(member.id, alice.id));
      const suggestions = await listTaskFitSuggestions(freshAlice, { limit: 2 });
      expect(suggestions.length).toBe(2);
    });
  });
});

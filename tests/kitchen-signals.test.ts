import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { profileQuestion, settingsChange } from "@/db/schema";
import {
  addKitchenStarterQuestion,
  archiveProfileQuestion,
  createProfileQuestion,
  createProfileQuestionInput,
  maybeSeedDefaultProfileQuestions,
  setKitchenSignalQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import {
  ALLERGEN_FLAGS,
  ALLERGEN_FLAG_LABELS,
  ALLERGY_OPTIONS,
  CONCRETE_ALLERGEN_FLAGS,
  DISLIKE_OPTIONS,
  INTOLERANCE_OPTIONS,
  flagForAllergyOption,
  flagForIntoleranceOption,
} from "@/lib/kitchen/allergens";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

// The tag that says which question feeds which Kitchen dietary signal —
// docs/plans/archive/kitchen-redesign-plan.md D2/D3. It grants no access and exists
// so the kitchen can read answers by their shape instead of guessing which
// question is "the allergy one". These tests are about what may carry it,
// that there is one per signal, and how an admin moves it.

const ALLERGY = {
  label: "Allergies",
  responseType: "multi_choice",
  options: ALLERGY_OPTIONS,
  allowOther: true,
  scope: "once_ever",
  sensitive: true,
  audience: { unlockedByGrantModuleKey: "kitchen" },
  kitchenSignal: "allergy",
} as const;

describe("the allergen vocabulary", () => {
  it("covers the EU's fourteen regulated allergens", () => {
    const eu = [
      "wheat_gluten",
      "shellfish",
      "eggs",
      "fish",
      "peanuts",
      "soy",
      "milk",
      "tree_nuts",
      "celery",
      "mustard",
      "sesame",
      "sulphites",
      "lupin",
      "molluscs",
    ] as const;
    for (const flag of eu) expect(ALLERGEN_FLAGS).toContain(flag);
    expect(CONCRETE_ALLERGEN_FLAGS).toHaveLength(14);
  });

  it("round-trips every allergy option back to its flag, so a tick and a flag are the same word", () => {
    for (const flag of CONCRETE_ALLERGEN_FLAGS) {
      expect(flagForAllergyOption(ALLERGEN_FLAG_LABELS[flag])).toBe(flag);
    }
    expect(ALLERGY_OPTIONS).toHaveLength(14);
  });

  it("compares labels for equality only, not for containment", () => {
    expect(flagForAllergyOption("  peanuts ")).toBe("peanuts");
    expect(flagForAllergyOption("peanut butter")).toBeNull();
    expect(flagForAllergyOption("no fish sauce")).toBeNull();
  });

  it("maps only the intolerances a dish can declare", () => {
    expect(flagForIntoleranceOption("Lactose")).toBe("milk");
    expect(flagForIntoleranceOption("Gluten")).toBe("wheat_gluten");
    expect(flagForIntoleranceOption("Fructose")).toBeNull();
    expect(INTOLERANCE_OPTIONS.length).toBeGreaterThan(2);
    expect(DISLIKE_OPTIONS).toContain("Cilantro / coriander");
  });
});

describe("what may carry a kitchen signal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("requires an allergy or intolerance question to be restricted", async () => {
    const { alice } = await createFixtures();
    // Rejected by the form schema...
    const parsed = createProfileQuestionInput.safeParse({ ...ALLERGY, sensitive: false, audience: undefined });
    expect(parsed.success).toBe(false);
    // ...and by the function itself, for a caller that never parses.
    await expect(
      createProfileQuestion(alice, { ...ALLERGY, sensitive: false, audience: undefined }),
    ).rejects.toThrow(AppError);
    await expect(
      createProfileQuestion(alice, { ...ALLERGY, kitchenSignal: "intolerance", sensitive: false, audience: undefined }),
    ).rejects.toThrow(/has to be restricted/);
  });

  it("lets a dislikes question be public, but only as a pick-any list", async () => {
    const { alice } = await createFixtures();
    const ok = await createProfileQuestion(alice, {
      label: "Foods you'd rather avoid",
      responseType: "multi_choice",
      options: DISLIKE_OPTIONS,
      scope: "once_ever",
      kitchenSignal: "dislike",
    });
    expect(ok.kitchenSignal).toBe("dislike");
    expect(ok.sensitive).toBe(false);

    await expect(
      createProfileQuestion(alice, {
        label: "Dislikes, in words",
        responseType: "text",
        scope: "once_ever",
        kitchenSignal: "dislike",
      }),
    ).rejects.toThrow(/pick any/);
  });

  it("refuses a per-event question, because a person's allergies don't change per event", async () => {
    const { alice } = await createFixtures();
    await expect(createProfileQuestion(alice, { ...ALLERGY, scope: "per_cycle" })).rejects.toThrow(/asked once/);
  });

  it("allows a written allergy answer, for communities that already have one", async () => {
    const { alice } = await createFixtures();
    const legacy = await createProfileQuestion(alice, {
      ...ALLERGY,
      responseType: "text",
      options: undefined,
      allowOther: false,
    });
    expect(legacy.kitchenSignal).toBe("allergy");
  });
});

describe("one live question per signal", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("refuses a second question for the same signal, in words", async () => {
    const { alice } = await createFixtures();
    await createProfileQuestion(alice, { ...ALLERGY });
    await expect(createProfileQuestion(alice, { ...ALLERGY, label: "Allergies again" })).rejects.toThrow(
      ConflictError,
    );
  });

  it("lets an archived question's replacement take the signal", async () => {
    const { alice } = await createFixtures();
    const first = await createProfileQuestion(alice, { ...ALLERGY });
    await archiveProfileQuestion(alice, first.id);
    const second = await createProfileQuestion(alice, { ...ALLERGY, label: "Allergies v2" });
    expect(second.kitchenSignal).toBe("allergy");
  });

  it("keeps communities apart", async () => {
    const { alice } = await createFixtures();
    const other = await createFixtures();
    await createProfileQuestion(alice, { ...ALLERGY });
    await expect(createProfileQuestion(other.alice, { ...ALLERGY })).resolves.toBeTruthy();
  });

  it("won't let an edit move a tagged question out from under its tag", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, { ...ALLERGY });
    await expect(updateProfileQuestion(alice, q.id, { responseType: "boolean" })).rejects.toThrow(AppError);
    // A label edit is fine and leaves the tag alone.
    const renamed = await updateProfileQuestion(alice, q.id, { label: "Food allergies" });
    expect(renamed.kitchenSignal).toBe("allergy");
  });
});

describe("pointing a signal at a question", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("moves a signal between questions in one step and logs both sides", async () => {
    const { alice } = await createFixtures();
    const old = await createProfileQuestion(alice, { ...ALLERGY, label: "Old allergies" });
    const next = await createProfileQuestion(alice, { ...ALLERGY, label: "New allergies", kitchenSignal: undefined });

    await setKitchenSignalQuestion(alice, "allergy", next.id);

    const rows = await db.select().from(profileQuestion).where(eq(profileQuestion.communityId, alice.communityId));
    expect(rows.find((r) => r.id === old.id)?.kitchenSignal).toBeNull();
    expect(rows.find((r) => r.id === next.id)?.kitchenSignal).toBe("allergy");

    // Two edits, one on each side: the old question released, the new one
    // set. (Creating the old one logged its own tag as a creation, which is
    // a different action and not part of this move.)
    const log = await db
      .select()
      .from(settingsChange)
      .where(and(eq(settingsChange.field, "kitchenSignal"), eq(settingsChange.action, "updated")));
    expect(log.map((l) => `${l.entityLabel}: ${JSON.stringify(l.newValue)}`).sort()).toEqual([
      'New allergies: "allergy"',
      "Old allergies: null",
    ]);
  });

  it("clears a signal with null", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, { ...ALLERGY });
    await setKitchenSignalQuestion(alice, "allergy", null);
    const [row] = await db.select().from(profileQuestion).where(eq(profileQuestion.id, q.id));
    expect(row.kitchenSignal).toBeNull();
  });

  it("leaves the old wiring in place when the new question can't carry the signal", async () => {
    const { alice } = await createFixtures();
    const old = await createProfileQuestion(alice, { ...ALLERGY });
    const publicQuestion = await createProfileQuestion(alice, {
      label: "Languages",
      responseType: "multi_choice",
      options: ["English"],
      scope: "once_ever",
    });

    await expect(setKitchenSignalQuestion(alice, "allergy", publicQuestion.id)).rejects.toThrow(/has to be restricted/);
    const [row] = await db.select().from(profileQuestion).where(eq(profileQuestion.id, old.id));
    expect(row.kitchenSignal).toBe("allergy");
  });

  it("refuses another community's question and an archived one", async () => {
    const { alice } = await createFixtures();
    const other = await createFixtures();
    const theirs = await createProfileQuestion(other.alice, { ...ALLERGY });
    await expect(setKitchenSignalQuestion(alice, "allergy", theirs.id)).rejects.toThrow(NotFoundError);

    const mine = await createProfileQuestion(alice, { ...ALLERGY, kitchenSignal: undefined });
    await archiveProfileQuestion(alice, mine.id);
    await expect(setKitchenSignalQuestion(alice, "allergy", mine.id)).rejects.toThrow(NotFoundError);
  });
});

describe("the starter questions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("seed all three wired, with the two health ones restricted to the kitchen and dislikes public", async () => {
    const { alice } = await createFixtures();
    await maybeSeedDefaultProfileQuestions(alice);
    const wired = await db
      .select()
      .from(profileQuestion)
      .where(and(eq(profileQuestion.communityId, alice.communityId), isNull(profileQuestion.archivedAt)));
    const bySignal = new Map(wired.filter((q) => q.kitchenSignal).map((q) => [q.kitchenSignal, q]));
    expect([...bySignal.keys()].sort()).toEqual(["allergy", "dislike", "intolerance"]);
    expect(bySignal.get("allergy")).toMatchObject({ responseType: "multi_choice", sensitive: true, allowOther: true });
    expect(bySignal.get("intolerance")).toMatchObject({ responseType: "multi_choice", sensitive: true });
    expect(bySignal.get("dislike")).toMatchObject({ responseType: "multi_choice", sensitive: false });
    expect(bySignal.get("allergy")!.options).toEqual(ALLERGY_OPTIONS);
  });

  it("can be added one at a time to a community that already has questions", async () => {
    const { alice } = await createFixtures();
    await createProfileQuestion(alice, {
      label: "Something else entirely",
      responseType: "text",
      scope: "once_ever",
    });
    const added = await addKitchenStarterQuestion(alice, "intolerance");
    expect(added.kitchenSignal).toBe("intolerance");
    expect(added.sensitive).toBe(true);
    await expect(addKitchenStarterQuestion(alice, "intolerance")).rejects.toThrow(ConflictError);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { community, member, profileQuestion as profileQuestionTable } from "@/db/schema";

const eqQuestion = (id: string) => eq(profileQuestionTable.id, id);
const eqComm = (id: string) => eq(community.id, id);
import { createContactMethod } from "@/lib/contact-methods";
import { profileAnswer, tier } from "@/db/schema";
import {
  activateEmergencyAccess,
  addEmergencyAccessExplanation,
  listEmergencyAccessActivity,
  listEmergencyAnswers,
} from "@/lib/emergency-access";
import { createSensitiveFieldAccessRule } from "@/lib/sensitive-data";
import {
  answerProfileQuestion,
  createProfileQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, resetDatabase } from "./helpers";

describe("emergency access", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it("returns every emergency-only method and logs the activation, without an explanation required up front", async () => {
    const { alice, bob } = await createFixtures();
    await createContactMethod(alice, { type: "phone", value: "555-9999", visibility: "emergency_only" });
    await createContactMethod(alice, { type: "email", value: "a@example.com", visibility: "everyone" });

    const { log, methods } = await activateEmergencyAccess(bob, alice.id);
    expect(methods).toHaveLength(1);
    expect(methods[0].value).toBe("555-9999");
    expect(log.activatedBy).toBe(bob.id);
    expect(log.targetMemberId).toBe(alice.id);
    expect(log.explanation).toBeNull();
  });

  it("still logs an activation even when the target has no emergency-only methods", async () => {
    const { alice, bob } = await createFixtures();
    const { log, methods } = await activateEmergencyAccess(bob, alice.id, "checking on her");
    expect(methods).toHaveLength(0);
    expect(log.explanation).toBe("checking on her");
  });

  it("rejects activating against a member outside the actor's community", async () => {
    const { bob } = await createFixtures();
    const [otherCommunity] = await db.insert(community).values({ name: "Other" }).returning();
    const [stranger] = await db.insert(member).values({ communityId: otherCommunity.id, name: "Stranger" }).returning();

    await expect(activateEmergencyAccess(bob, stranger.id)).rejects.toThrow(NotFoundError);
  });

  it("lets only the original activator add or revise an explanation after the fact", async () => {
    const { alice, bob } = await createFixtures();
    const { log } = await activateEmergencyAccess(bob, alice.id);

    const updated = await addEmergencyAccessExplanation(bob, log.id, "she wasn't answering her phone");
    expect(updated.explanation).toBe("she wasn't answering her phone");

    await expect(addEmergencyAccessExplanation(alice, log.id, "not my activation")).rejects.toThrow(ForbiddenError);
  });

  it("surfaces an activation to both the activator and the target, but nobody else", async () => {
    const { alice, bob, community: testCommunity, branch } = await createFixtures();
    const [carol] = await db.insert(member).values({ communityId: testCommunity.id, name: "Carol" }).returning();
    void branch;

    await activateEmergencyAccess(bob, alice.id, "checking in");

    const bobActivity = await listEmergencyAccessActivity(bob);
    expect(bobActivity).toHaveLength(1);
    expect(bobActivity[0].role).toBe("activator");
    expect(bobActivity[0].counterpartName).toBe("Alice");

    const aliceActivity = await listEmergencyAccessActivity(alice);
    expect(aliceActivity).toHaveLength(1);
    expect(aliceActivity[0].role).toBe("target");
    expect(aliceActivity[0].counterpartName).toBe("Bob");

    const carolActivity = await listEmergencyAccessActivity(carol);
    expect(carolActivity).toHaveLength(0);
  });

  // Emergency access on a profile question is a different animal from
  // emergency access on a contact method, and the two differences are the
  // whole reason it's worth having: the member consented by *answering*,
  // and the read has to say why it happened.
  describe("emergency access to a profile question", () => {
    /**
     * A member, one question built all the way to emergency-access, and
     * one answer to it. Each test varies the flag or the answer.
     */
    async function emergencyQuestion(overrides: Record<string, unknown> = {}) {
      const { alice, bob, community: c } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Medication on site",
        responseType: "single_choice",
        options: ["none", "inhaler", "epipen"],
        scope: "once_ever",
        allowPreferNotToSay: true,
        ...overrides,
      });
      const [t] = await db.insert(tier).values({ communityId: c.id, name: "Kitchen" }).returning();
      await createSensitiveFieldAccessRule(alice, { questionId: q.id, unlockedByTierId: t.id });
      const flagged = await updateProfileQuestion(alice, q.id, {
        sensitive: true,
        emergencyAccess: true,
      });
      return { alice, bob, c, q: flagged, tierId: t.id };
    }

    it("reveals the answer, and requires a reason for reading it", async () => {
      const { alice, bob, q } = await emergencyQuestion();
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });

      // No reason -> refused, and nothing is logged, so a refused attempt
      // leaves no trace claiming a read happened.
      await expect(activateEmergencyAccess(bob, alice.id)).rejects.toThrow(/Say why/);
      expect(await listEmergencyAccessActivity(bob)).toEqual([]);

      const { answers, log } = await activateEmergencyAccess(bob, alice.id, "she collapsed, no inhaler on site");
      expect(answers).toHaveLength(1);
      expect(answers[0].label).toBe("Medication on site");
      // A real string, not the option key and not a raw JSON value.
      expect(answers[0].value).toBe("epipen");
      expect(log.explanation).toBe("she collapsed, no inhaler on site");
    });

    it("leaves a contact-method activation's explanation optional", async () => {
      // The asymmetry is the design. "Look up this phone number" is
      // answered by the log alone — who, when, whose number — so an
      // optional explanation is honest there. A question read is not,
      // because the activator is the only one who knows if there was a
      // fire. The pre-existing tests above pin the nullable column and
      // this one pins that it stayed nullable.
      const { alice, bob } = await createFixtures();
      await createContactMethod(alice, { type: "phone", value: "555-9999", visibility: "emergency_only" });
      const { log, answers } = await activateEmergencyAccess(bob, alice.id);
      expect(log.explanation).toBeNull();
      expect(answers).toEqual([]);
    });

    it("never reveals a question that isn't actually restricted", async () => {
      // A non-sensitive question is readable by the whole community, so
      // "revealing" one would log a read of public data as though it had
      // been protected. The write side refuses the combination; this
      // asserts the read side holds on its own, since a stale flag or a
      // hand-edited row shouldn't turn the audit trail into fiction.
      const { alice, bob, q, c } = await emergencyQuestion();
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });
      expect(await listEmergencyAnswers(alice.id)).toHaveLength(1);

      await db
        .update((await import("@/db/schema")).profileQuestion)
        .set({ sensitive: false })
        .where(eqQuestion(q.id));
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
      expect(c.id).toBeTruthy();
    });

    it("treats a decline and a deferral as no answer at all", async () => {
      // Rendering "I declined to say" in a reveal would read a refusal as
      // the thing that was withheld, and a deferred answer is explicitly
      // not a value. Both are the absence of content, not content.
      const { alice, bob, q } = await emergencyQuestion();
      await answerProfileQuestion(alice, q.id, { status: "declined" });
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
      await answerProfileQuestion(alice, q.id, { status: "deferred" });
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
      // …and the question still doesn't block an activation for a
      // contact method, because there's no answer to explain.
      const { answers } = await activateEmergencyAccess(bob, alice.id);
      expect(answers).toEqual([]);
    });

    it("formats a boolean and a date as a person would read them", async () => {
      // String(value) printed "false" and a raw ISO date. This is the one
      // surface where someone's answer is read by someone looking for it,
      // so the read side has to be the field's own formatting.
      const { alice, c } = await emergencyQuestion({ label: "Needs an epipen?" });
      const [t] = await db.insert(tier).values({ communityId: c.id, name: "First aid" }).returning();
      const boolQ = await createProfileQuestion(alice, {
        label: "Needs an epipen?",
        responseType: "boolean",
        scope: "once_ever",
      });
      await createSensitiveFieldAccessRule(alice, { questionId: boolQ.id, unlockedByTierId: t.id });
      await updateProfileQuestion(alice, boolQ.id, { sensitive: true, emergencyAccess: true });
      await answerProfileQuestion(alice, boolQ.id, { status: "answered", value: false });

      const dateQ = await createProfileQuestion(alice, {
        label: "Date of birth",
        responseType: "date",
        scope: "once_ever",
      });
      await createSensitiveFieldAccessRule(alice, { questionId: dateQ.id, unlockedByTierId: t.id });
      await updateProfileQuestion(alice, dateQ.id, { sensitive: true, emergencyAccess: true });
      await answerProfileQuestion(alice, dateQ.id, { status: "answered", value: "1990-04-01" });

      const found = await listEmergencyAnswers(alice.id);
      const byLabel = Object.fromEntries(found.map((a) => [a.label, a.value]));
      expect(byLabel["Needs an epipen?"]).toBe("No");
      expect(byLabel["Date of birth"]).not.toBe("1990-04-01");
      expect(byLabel["Date of birth"]).toMatch(/1990/);
    });

    it("only reveals standing answers, not a year's worth of per-event ones", async () => {
      // Activating once must not surface an event's answers as though they
      // were part of "this member has an emergency" — those are reached
      // through the event, one at a time, on purpose.
      const { alice, c } = await emergencyQuestion();
      const { createCycle } = await import("@/lib/cycles");
      await db.update((await import("@/db/schema")).community).set({ cyclesEnabled: true }).where(eqComm(c.id));
      const cycle = await createCycle(alice, { source: "blank", name: "Spring Weekend" });
      const [t] = await db.insert(tier).values({ communityId: c.id, name: "First aid" }).returning();

      // A genuinely per-event question, not a once_ever one with a
      // cycleId submitted at it — resolveCycleId ignores a cycle for a
      // standing question, so the first attempt at this stored a standing
      // answer and the assertion failed for the wrong reason.
      const perEvent = await createProfileQuestion(alice, {
        label: "Medication for this event",
        responseType: "single_choice",
        options: ["none", "inhaler"],
        scope: "per_cycle",
      });
      await createSensitiveFieldAccessRule(alice, { questionId: perEvent.id, unlockedByTierId: t.id });
      await updateProfileQuestion(alice, perEvent.id, { sensitive: true, emergencyAccess: true });
      await answerProfileQuestion(alice, perEvent.id, {
        status: "answered",
        value: "inhaler",
        cycleId: cycle.id,
      });
      // Declaring the event is also what makes the answer resolvable, so
      // this is the realistic shape rather than a technicality.
      const { declareParticipation } = await import("@/lib/participation");
      await declareParticipation(alice, cycle.id, { status: "coming" });
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);

      // A standing answer to a standing question is the one that is
      // reachable, so the filter isn't simply excluding everything.
      const standing = await createProfileQuestion(alice, {
        label: "Medication on site",
        responseType: "single_choice",
        options: ["none", "inhaler", "epipen"],
        scope: "once_ever",
      });
      await createSensitiveFieldAccessRule(alice, { questionId: standing.id, unlockedByTierId: t.id });
      await updateProfileQuestion(alice, standing.id, { sensitive: true, emergencyAccess: true });
      await answerProfileQuestion(alice, standing.id, { status: "answered", value: "epipen" });
      const found = await listEmergencyAnswers(alice.id);
      expect(found).toHaveLength(1);
      expect(found[0].label).toBe("Medication on site");
    });
  });
});

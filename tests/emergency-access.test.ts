import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
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
import {
  answerProfileQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import {
  agreeToEmergencyReveal,
  listPendingAudienceConsents,
} from "@/lib/sensitive-data";

// Reads the member has not been asked about, of either kind. Named for what
// the member is being asked rather than for the table behind it, because
// that is the question the test is about.
const listPendingReads = listPendingAudienceConsents;
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { createFixtures, createRestrictedQuestion, resetDatabase } from "./helpers";

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
  /**
   * The flag is mutable, which makes turning it *on* a widening: the people
   * whose answers it reaches answered a question their data could not be
   * pulled out of in a crisis. So each of them is asked, per answer, and the
   * reveal waits for them.
   *
   * This is the emergency half of the audience-widening story, and it is the
   * same story with a different shape — an audience is a set of groups and
   * consent is per group, emergency access is one route and consent is one
   * fact per answer.
   */
  describe("turning emergency access on asks", () => {
    /** A restricted question with a real answer and emergency access off. */
    async function emergencyOff() {
      const { alice, community, branch } = await createFixtures();
      const bob = await db.insert(member).values({ communityId: community.id, name: "Bob" }).returning();
      const [t] = await db.insert(tier).values({ communityId: community.id, name: "Welfare" }).returning();
      const q = await createRestrictedQuestion(
        alice,
        {
          label: "Medication on site",
          responseType: "single_choice",
          options: ["none", "inhaler", "epipen"],
          scope: "once_ever",
          // So the decline tests below can actually decline — the write
          // side refuses a decline a question never offered, which is the
          // right rule and an annoying one to trip over in a fixture.
          allowPreferNotToSay: true,
        },
        { audience: { unlockedByTierId: t.id } },
      );
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });
      return { alice, bob, c: community, branch, q, tierId: t.id };
    }

    it("is nothing to ask about while the flag is off", async () => {
      const { alice, q } = await emergencyOff();
      expect(await listPendingReads(alice)).toEqual([]);
      // And the answer is not emergency-readable, because the question
      // isn't marked at all.
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
      void q;
    });

    it("asks, and the reveal waits for the answer", async () => {
      const { alice, q } = await emergencyOff();
      const flagged = await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      expect(flagged.emergencyAccess).toBe(true);

      // The prompt exists, and it is about *her own* answer — she is the
      // one whose reach widened.
      const pending = await listPendingReads(alice);
      expect(pending.map((p) => p.questionLabel)).toEqual(["Medication on site"]);
      expect(pending[0].kind).toBe("emergency");

      // …and the reveal does not happen yet. The whole point: an Admin's
      // click has not turned into someone's crisis being readable.
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
    });

    it("happens once they say yes, and the prompt is spent", async () => {
      const { alice, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      const [pending] = await listPendingReads(alice);

      await agreeToEmergencyReveal(alice, pending.answerId);
      const found = await listEmergencyAnswers(alice.id);
      expect(found).toHaveLength(1);
      expect(found[0].value).toBe("epipen");
      expect(await listPendingReads(alice)).toEqual([]);
    });

    it("re-answering agrees, so the prompt never becomes a nag", async () => {
      // The same reasoning as the audience half: someone re-answering a
      // question has just been shown what it is and who it is shared with,
      // so answering again is them agreeing to that afresh. Making them
      // find a separate button for the same fact would be a second thing
      // to remember about a question they already know.
      const { alice, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      expect(await listPendingReads(alice)).toHaveLength(1);

      await answerProfileQuestion(alice, q.id, { status: "answered", value: "inhaler" });
      expect(await listPendingReads(alice)).toEqual([]);
      expect((await listEmergencyAnswers(alice.id))[0].value).toBe("inhaler");
    });

    it("asks nobody when the flag is turned off, or turned on again after being off", async () => {
      // Off is not a widening: it discloses nothing, so nobody's consent
      // moves and nothing needs re-asking until it's granted again. And
      // re-granting a reach deserves a fresh answer even though nothing
      // about the answers changed.
      const { alice, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      const [pending] = await listPendingReads(alice);
      await agreeToEmergencyReveal(alice, pending.answerId);
      expect(await listPendingReads(alice)).toEqual([]);

      await updateProfileQuestion(alice, q.id, { emergencyAccess: false });
      expect(await listPendingReads(alice)).toEqual([]);
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);

      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      expect(await listPendingReads(alice)).toHaveLength(1);
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
    });

    it("does not ask about an answer that already chose emergency-only", async () => {
      // Un-ticking the share box already means "emergency-only", so it *is*
      // the agreement. Asking again would be asking about a reach they
      // chose — and would leave a permanent unanswerable prompt, because
      // re-answering with the box still unticked is the same choice.
      const { alice, q } = await emergencyOff();
      await answerProfileQuestion(alice, q.id, {
        status: "answered",
        value: "epipen",
        shareWithAudience: false,
      });
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });

      expect(await listPendingReads(alice)).toEqual([]);
      const found = await listEmergencyAnswers(alice.id);
      expect(found).toHaveLength(1);
      expect(found[0].value).toBe("epipen");
    });

    it("asks about each answer separately, not about the question", async () => {
      // Per answer, because "agree to this being reachable in a crisis" is
      // a fact about a person and their answer, not about a question. One
      // person's yes must not carry another person's answer with it, which
      // is the same reason the audience half is per (answer, rule).
      const { alice, c, q } = await emergencyOff();
      const carol = await db.insert(member).values({ communityId: c.id, name: "Carol" }).returning();
      await answerProfileQuestion(carol[0], q.id, { status: "answered", value: "inhaler" });
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });

      expect(await listPendingReads(alice)).toHaveLength(1);
      expect(await listPendingReads(carol[0])).toHaveLength(1);
      // Neither can read the other's: activation reveals the *target's*
      // answers, so what matters is the target having agreed.
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
      expect(await listEmergencyAnswers(carol[0].id)).toEqual([]);
    });

    it("will not let someone agree on another person's behalf", async () => {
      const { alice, bob, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      const [answer] = await db.select().from(profileAnswer).where(eq(profileAnswer.questionId, q.id));
      await expect(agreeToEmergencyReveal(bob[0], answer.id)).rejects.toThrow(NotFoundError);
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
    });

    it("will not agree for something that isn't a real answer", async () => {
      const { alice, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      await answerProfileQuestion(alice, q.id, { status: "declined" });
      const [declined] = await db
        .select()
        .from(profileAnswer)
        .where(and(eq(profileAnswer.questionId, q.id), eq(profileAnswer.status, "declined")));
      await expect(agreeToEmergencyReveal(alice, declined.id)).rejects.toThrow(/nothing to reveal/);
    });

    it("leaves declines out of the reveal entirely, agreed or not", async () => {
      // Belt-and-braces on a case the reset already excludes: a refusal
      // holds no value, so there is nothing to reach, agreed or not.
      const { alice, q } = await emergencyOff();
      await updateProfileQuestion(alice, q.id, { emergencyAccess: true });
      await answerProfileQuestion(alice, q.id, { status: "declined" });
      expect(await listEmergencyAnswers(alice.id)).toEqual([]);
    });
  });

  describe("emergency access to a profile question", () => {
    /**
     * A member, one question built all the way to emergency-access, and
     * one answer to it. Each test varies the flag or the answer.
     */
    async function emergencyQuestion(overrides: Record<string, unknown> = {}) {
      const { alice, bob, community: c } = await createFixtures();
      // One call, and the row it returns is already restricted — there
      // used to be a "the flagged row, not the one create returned"
      // dance here because the flag was set by a second update and the
      // first return value was stale. Nothing can be stale now.
      const [t] = await db.insert(tier).values({ communityId: c.id, name: "Kitchen" }).returning();
      const q = await createRestrictedQuestion(
        alice,
        {
          label: "Medication on site",
          responseType: "single_choice",
          options: ["none", "inhaler", "epipen"],
          scope: "once_ever",
          allowPreferNotToSay: true,
          ...overrides,
        },
        { emergencyAccess: true, audience: { unlockedByTierId: t.id } },
      );
      return { alice, bob, c, q, tierId: t.id };
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
      const { alice, q, c } = await emergencyQuestion();
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
      const boolQ = await createRestrictedQuestion(
        alice,
        {
        label: "Needs an epipen?",
        responseType: "boolean",
        scope: "once_ever",
      },
        { emergencyAccess: true, audience: { unlockedByTierId: t.id } },
      );
      await answerProfileQuestion(alice, boolQ.id, { status: "answered", value: false });

      const dateQ = await createRestrictedQuestion(
        alice,
        {
        label: "Date of birth",
        responseType: "date",
        scope: "once_ever",
      },
        { emergencyAccess: true, audience: { unlockedByTierId: t.id } },
      );
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
      const perEvent = await createRestrictedQuestion(
        alice,
        {
        label: "Medication for this event",
        responseType: "single_choice",
        options: ["none", "inhaler"],
        scope: "per_cycle",
      },
        { emergencyAccess: true, audience: { unlockedByTierId: t.id } },
      );
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
      const standing = await createRestrictedQuestion(
        alice,
        {
        label: "Medication on site",
        responseType: "single_choice",
        options: ["none", "inhaler", "epipen"],
        scope: "once_ever",
      },
        { emergencyAccess: true, audience: { unlockedByTierId: t.id } },
      );
      await answerProfileQuestion(alice, standing.id, { status: "answered", value: "epipen" });
      const found = await listEmergencyAnswers(alice.id);
      expect(found).toHaveLength(1);
      expect(found[0].label).toBe("Medication on site");
    });
  });
});

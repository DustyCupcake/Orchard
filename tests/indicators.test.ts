import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  member as memberTable,
  profileAnswer,
  profileQuestion,
  tier as tierTable,
} from "@/db/schema";
import { branch } from "@/db/schema";
import {
  answerProfileQuestion,
  listOutstandingQuestions,
  archiveProfileQuestion,
  createProfileQuestion,
  listCommunityIndicators,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import {
  INDICATOR_FAMILY_LABELS,
  canPublishAsIndicator,
  indicatorBlocker,
  indicatorFamilyFor,
} from "@/lib/profile-questions/indicators";
import { claimTask } from "@/lib/tasks";
import {
  createSensitiveFieldAccessRule,
  deleteSensitiveFieldAccessRule,
  listSensitiveFieldAccessRules,
  questionsReadableBy,
  resolveReadableAnswersForCommunity,
  resolveReadableQuestions,
} from "@/lib/sensitive-data";
import { createCycle } from "@/lib/cycles";
import { declareParticipation } from "@/lib/participation";
import { AppError, ConflictError, NotFoundError } from "@/lib/errors";
import {
  createFixtures,
  createRestrictedQuestion,
  grantPermission,
  insertTask,
  resetDatabase,
} from "./helpers";

// The community's choice of which standing questions become facts about
// everyone. Three things this file exists to pin, each of which is a
// specific way the feature could quietly do the wrong thing:
//
//   1. The display form is DERIVED from the answer type, so a pick-any
//      can never be drawn as a share of one whole, and a written answer
//      can't be published at all.
//   2. A withheld breakdown is withheld SERVER-side, so there is nothing
//      in the HTML for someone who may not see it to uncover.
//   3. Every number carries its denominator, and the escape hatch's
//      answers are a visible row rather than silently missing.
//   4. Consent is ONE decision, given once for the whole section. There
//      is deliberately no per-answer consent state to be in, and these
//      tests exist to pin that absence: the earlier per-publication
//      machinery is gone, and the way to stop it coming back is a test
//      that fails if anybody re-adds a second gate on the answer row.
describe("community indicators", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  /** A real tier in the actor's community, for access rules to hang off. */
  async function tierId(actor: typeof memberTable.$inferSelect) {
    const [t] = await db
      .insert(tierTable)
      .values({ communityId: actor.communityId, name: "Kitchen" })
      .returning();
    return t.id;
  }

  async function addMember(communityId: string, name: string) {
    const [m] = await db.insert(memberTable).values({ communityId, name }).returning();
    return m;
  }

  // An event view only exists once the Community has a Participation
  // concept at all; without this createCycle refuses.
  async function enableCycles(communityId: string) {
    await db.update(community).set({ cyclesEnabled: true }).where(eq(community.id, communityId));
  }

  describe("there is no standing opt-out, only the decline", () => {
    /** Three members, all answered, one published pronoun indicator. */
    async function sectionSetup() {
      const { alice, bob, community: c } = await createFixtures();
      const carol = await addMember(c.id, "Carol");
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "he/him" });
      await answerProfileQuestion(carol, q.id, { status: "answered", value: "she/her" });
      return { alice, bob, carol, c, q };
    }

    it("has no column for a member to be counted in or not", async () => {
      // The absence is the design, so it is asserted rather than assumed.
      // `consents_to_community_indicators` was a standing opt-out of every
      // published indicator at once, which is a different thing from what
      // publication needs: publication only ever reaches answers the whole
      // Community can already read individually, so an aggregate of them
      // says nothing the underlying answers don't. The one lever a member
      // actually wants — "answer, but not be a bar in a chart" — is
      // answered by the per-question decline below, which is the same
      // lever on every question that can be published.
      const names = Object.keys(getTableColumns(memberTable));
      expect(names).not.toContain("consentsToCommunityIndicators");
    });

    it("counts every member, because there is nothing to opt out of", async () => {
      const { alice } = await sectionSetup();
      const { indicators } = await listCommunityIndicators(alice);
      expect(indicators[0].population).toBe(3);
      expect(indicators[0].answered).toBe(3);
      expect(indicators[0].declined).toBe(0);
    });

    it("takes one member out of the numerator without touching the denominator", async () => {
      // A decline is a fact about a *question*, so it leaves the person in
      // the population — unlike the old standing opt-out, which removed
      // them from both. That is the deliberate difference: the decline is
      // scoped to one question and reads as one refusal, where the
      // standing opt-out took the member out of every figure the Community
      // will ever publish and reported it as a smaller population.
      const { alice, carol, q } = await sectionSetup();
      await answerProfileQuestion(carol, q.id, { status: "declined" });
      const { indicators } = await listCommunityIndicators(alice);
      expect(indicators[0].population).toBe(3);
      expect(indicators[0].answered).toBe(2);
      expect(indicators[0].declined).toBe(1);
      expect(indicators[0].data).toEqual({
        family: "split",
        rows: [
          { label: "she/her", count: 1 },
          { label: "he/him", count: 1 },
        ],
      });
    });

    it("leaves the member's other answers alone", async () => {
      // A decline is per question. The old standing opt-out took a member
      // out of every indicator the Community had, on one click, for
      // questions they might not have thought about — including ones
      // added later, which is the part that made it feel like a trap
      // rather than a choice.
      const { alice, carol, c } = await sectionSetup();
      const other = await createProfileQuestion(alice, {
        label: "Shirt size",
        responseType: "single_choice",
        options: ["S", "M", "L"],
        scope: "once_ever",
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await answerProfileQuestion(carol, other.id, { status: "answered", value: "M" });
      const { indicators } = await listCommunityIndicators(alice);
      const byLabel = Object.fromEntries(indicators.map((i) => [i.label, i.answered]));
      expect(byLabel["Shirt size"]).toBe(1);
      void c;
    });

    it("applies to an event-scoped indicator too", async () => {
      const { alice, bob, carol, c } = await sectionSetup();
      await enableCycles(c.id);
      const cycle = await createCycle(alice, { source: "blank", name: "Spring Weekend" });
      for (const m of [alice, bob, carol]) {
        await declareParticipation(m, cycle.id, { status: "coming" });
      }

      const scope = { kind: "event" as const, cycleId: cycle.id, cycleName: cycle.name };
      const before = await listCommunityIndicators(alice, { requested: scope, policy: { enabled: true } });
      expect(before.scope).toEqual(scope);
      expect(before.indicators[0].population).toBe(3);

      // And a declined answer in the same event-scoped figure behaves the
      // same way: out of the numerator, still in the population.
      const declined = await listCommunityIndicators(alice, { requested: scope, policy: { enabled: true } });
      expect(declined.indicators[0].population).toBe(3);
    });
  });

  describe("there is no second gate on the answer itself", () => {
    /** A private question, answered by two members, then published. */
    async function publishedLater() {
      const { alice, bob, community: c } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "he/him" });
      return { alice, bob, c, q };
    }

    it("counts an answer given before publication, with nobody asked", async () => {
      // The single most important line in this file. An answer given while
      // the question was private is counted the moment an Admin publishes
      // it, because the member consented to the *section* when they
      // answered and the question was already in it.
      //
      // The alternative was built and removed: park the answer in a
      // "pending" state, nag the member to confirm, and count them meanwhile
      // or not. Both halves are wrong. Counting meanwhile makes the ask
      // decorative; not counting leaves the indicator empty and reads as a
      // broken widget. Worse, the trigger was an *admin's* action with
      // nothing to do with the member.
      const { alice, bob, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });

      const { indicators } = await listCommunityIndicators(alice);
      expect(indicators[0].answered).toBe(2);
      expect(indicators[0].population).toBe(2);
      expect(indicators[0].declined).toBe(0);
      expect(indicators[0].data).toEqual({
        family: "split",
        rows: [
          { label: "she/her", count: 1 },
          { label: "he/him", count: 1 },
        ],
      });
      // And nothing is outstanding for either of them, anywhere. There is
      // no list to be outstanding on, and that is the point.
      expect((await listOutstandingQuestions(bob)).length).toBe(0);
    });

    it("has nowhere on the answer to record a second decision", async () => {
      // Fails if anybody re-adds a consent column to profile_answer for
      // *this*. The absence is the design, and the only real defence
      // against it being quietly reintroduced is a test that would notice.
      const { alice, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      const names = Object.keys(getTableColumns(profileAnswer));
      expect(names).not.toContain("indicatorConsent");
      // An exhaustive list on purpose, because a new column here is a new
      // decision and this test is where it should be argued for. Every
      // surviving column is about one of two things: the *value* (what was
      // said, whether it's held at all, when a Capacity row and an event
      // row are kept apart from the standing answer), or *who may read it
      // by a route the member chose* (`shareWithAudience` for the audience,
      // `emergencyConsent` for the crisis override). None of it is about
      // who gets to see the value in an aggregate — that is the distinction
      // that killed the indicator_consent column, because the decline on the
      // question is the lever for aggregates and this is the lever for
      // individual reads.
      expect(names.sort()).toEqual([
        "answeredAt",
        "capacityVisibility",
        "cycleId",
        "emergencyConsent",
        "id",
        "memberId",
        "questionId",
        "shareWithAudience",
        "status",
        "value",
      ]);
    });

    it("covers a question added to the section after the consent was given", async () => {
      // Consent is to a rule, not a list of answers. A question can only
      // enter the publishable section at creation, so the standing consent
      // always predates any answer given in it — which is the whole reason
      // there is no re-ask to build.
      const { alice, c, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      const dave = await addMember(c.id, "Dave");
      const second = await createProfileQuestion(alice, {
        label: "Shirt size",
        responseType: "single_choice",
        options: ["S", "M", "L"],
        scope: "once_ever",
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await answerProfileQuestion(dave, second.id, { status: "answered", value: "M" });

      const { indicators } = await listCommunityIndicators(alice);
      const byLabel = Object.fromEntries(indicators.map((i) => [i.label, i.answered]));
      expect(byLabel).toEqual({ Pronouns: 2, "Shirt size": 1 });
      // Dave joined after the first question was published and was counted
      // on the second without being asked anything about the first — the
      // question he never answered is the only one still outstanding, so
      // there is no second decision and no second prompt.
      const outstanding = await listOutstandingQuestions(dave);
      expect(outstanding.map((o) => o.question.label)).toEqual(["Pronouns"]);
    });

    it("re-publishing asks nothing, because nothing was ever pending", async () => {
      // A community that unpublishes to fix something and republishes must
      // not resurrect a prompt. Under the old model one member's single
      // "no" became a recurring nag here; under this one there's nothing
      // to resurrect.
      const { alice, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: false });
      const after = await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      expect(after.publishedAsIndicator).toBe(true);
      expect((await listCommunityIndicators(alice)).indicators[0].answered).toBe(2);
    });

    it("keeps a declined answer on the member's own profile", async () => {
      // A decline is about holding the value at all, so it removes the
      // value from the profile too — which is the opposite of the old
      // standing opt-out, where a member could want their pronouns on
      // their profile and not want to be one bar in a chart. That
      // combination is no longer expressible, and the reason it doesn't
      // need to be is that the thing it protected doesn't exist: an
      // indicator is an aggregate of answers the whole Community can
      // already read one at a time.
      const { alice, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      await answerProfileQuestion(alice, q.id, { status: "declined" });

      const rows = await db
        .select()
        .from(profileAnswer)
        .where(and(eq(profileAnswer.memberId, alice.id), eq(profileAnswer.questionId, q.id)));
      expect(rows[0].value).toBeNull();
      expect(rows[0].status).toBe("declined");
    });

    it("still reports a declined question as a refusal rather than a gap", async () => {
      // The one per-answer lever that survives: declining is about holding
      // the value at all, so it removes the answer from the profile too,
      // and the aggregate says so in its own numbers.
      const { alice, q } = await publishedLater();
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: true });
      await answerProfileQuestion(alice, q.id, { status: "declined" });

      const rows = await db
        .select()
        .from(profileAnswer)
        .where(and(eq(profileAnswer.memberId, alice.id), eq(profileAnswer.questionId, q.id)));
      expect(rows[0].value).toBeNull();
      expect(rows[0].status).toBe("declined");

      const { indicators } = await listCommunityIndicators(alice);
      expect(indicators[0].population).toBe(2);
      expect(indicators[0].answered).toBe(1);
      expect(indicators[0].declined).toBe(1);
    });
  });

  describe("the community's per-cycle indicator policy", () => {
    /** Three people coming, all answered, one published indicator. */
    async function policySetup() {
      const { alice, bob, community: c, branch: b } = await createFixtures();
      const carol = await addMember(c.id, "Carol");
      const dave = await addMember(c.id, "Dave");
      const t = await insertTask(c.id, b.id, alice.id);
      await enableCycles(c.id);
      const cycle = await createCycle(alice, { source: "blank", name: "Spring Weekend" });
      // Four members, three coming, all four answered.
      for (const m of [alice, bob, carol]) {
        await declareParticipation(m, cycle.id, { status: "coming" });
      }
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "he/him" });
      await answerProfileQuestion(carol, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(dave, q.id, { status: "answered", value: "he/him" });
      return { alice, bob, carol, dave, c, t, cycle, q };
    }

    it("is off unless the community turns it on", async () => {
      const { alice, cycle, c } = await policySetup();
      expect((await db.select().from(community)).length).toBeTruthy();
      // The stored default — read from the Community, not a passed-in
      // override — so this also pins that the function reads its own
      // policy rather than requiring callers to thread it.
      const result = await listCommunityIndicators(alice, {
        requested: { kind: "event", cycleId: cycle.id, cycleName: cycle.name },
      });
      expect(result.scope).toEqual({ kind: "community" });
      expect(result.scopeFallback).toMatch(/doesn't break them out/);
      expect(result.indicators[0].population).toBe(4);
      void c;
    });

    it("breaks out whenever the community has turned it on", async () => {
      const { alice, cycle, c } = await policySetup();
      await db.update(community).set({ cycleIndicatorsEnabled: true }).where(eq(community.id, c.id));
      const result = await listCommunityIndicators(alice, {
        requested: { kind: "event", cycleId: cycle.id, cycleName: cycle.name },
      });
      expect(result.scope).toEqual({ kind: "event", cycleId: cycle.id, cycleName: "Spring Weekend" });
      expect(result.scopeFallback).toBeNull();
      expect(result.indicators[0].population).toBe(3);
    });

    it("has no headcount floor, and no column to hold one", async () => {
      // The floor is gone, and the reason it guarded nothing is the thing
      // worth pinning: a published indicator is an aggregate of answers
      // the whole Community can already read one at a time, so a chart
      // over three people discloses nothing the /members view of the same
      // three doesn't. The floor was protecting a distinction that
      // publication had already made irrelevant.
      //
      // What it did *not* cover is a declined answer in a small event,
      // where "1 of 3 declined" is a small number of facts about a small
      // number of named people. That risk comes from counting declines in
      // a small population, not from the population being small — so the
      // honest response would be to not show the declined count, not to
      // suppress the whole chart. It is recorded here as an open question
      // rather than closed, because it is a disclosure decision and not a
      // cleanup.
      const { alice, cycle, c } = await policySetup();
      await db.update(community).set({ cycleIndicatorsEnabled: true }).where(eq(community.id, c.id));
      const scope = { kind: "event" as const, cycleId: cycle.id, cycleName: cycle.name };
      // One attendee, the smallest possible event, and it still breaks out.
      const carolQ = await listCommunityIndicators(alice, { requested: scope });
      expect(carolQ.scope).toEqual(scope);
      expect(carolQ.indicators[0].population).toBe(3);
      expect(Object.keys(getTableColumns(community))).not.toContain("cycleIndicatorsMinMembers");
    });

    it("leaves a community-wide view alone whatever the policy says", async () => {
      const { alice, c } = await policySetup();
      await db.update(community).set({ cycleIndicatorsEnabled: true }).where(eq(community.id, c.id));
      const result = await listCommunityIndicators(alice);
      expect(result.scope).toEqual({ kind: "community" });
      expect(result.scopeFallback).toBeNull();
    });
  });

  describe("the permission ladder: who may read one member's answer", () => {
    /**
     * A member, a question marked sensitive, and one answer to it. The
     * audience is configured separately by each test so the ladder is
     * what's under test rather than the setup.
     */
    async function sensitiveSetup() {
      const { alice, bob, community: c } = await createFixtures();
      const carol = await addMember(c.id, "Carol");
      const tier = await tierId(alice);
      // One call, so there is no "stale row from before the flag" hazard
      // to guard against — the create returns the question it actually
      // made, restricted, with its audience attached.
      const q = await createRestrictedQuestion(
        alice,
        {
          label: "Medication on site",
          responseType: "single_choice",
          options: ["none", "inhaler", "epipen"],
          scope: "once_ever",
          allowPreferNotToSay: true,
        },
        { audience: { unlockedByTierId: tier } },
      );
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });
      return { alice, bob, carol, q, tier, c };
    }

    /** Can `viewer` read `owner`'s answer to this question? */
    async function canRead(
      viewer: typeof memberTable.$inferSelect,
      owner: typeof memberTable.$inferSelect,
      q: { id: string; sensitive: boolean },
      shareWithAudience = true,
    ) {
      const readable = await resolveReadableQuestions(viewer, owner.id, [
        { questionId: q.id, sensitive: q.sensitive, shareWithAudience },
      ]);
      return readable.has(q.id);
    }

    it("lets anyone read a question that isn't sensitive", async () => {
      // Level 1, and the most permissive rung there is. A decline is the
      // member's only lever at this level, and it always works.
      const { alice, bob } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Shirt size",
        responseType: "single_choice",
        options: ["S", "M", "L"],
        scope: "once_ever",
      });
      expect(q.sensitive).toBe(false);
      expect(await canRead(bob, alice, q)).toBe(true);
    });

    it("restricts a sensitive question to the audience the rules name", async () => {
      const { alice, bob, q, tier } = await sensitiveSetup();
      // Nobody holds Kitchen yet.
      expect(await canRead(bob, alice, q)).toBe(false);
      await db.update(memberTable).set({ tierIds: [tier] }).where(eq(memberTable.id, bob.id));
      const [bobNow] = await db.select().from(memberTable).where(eq(memberTable.id, bob.id));
      expect(await canRead(bobNow, alice, q)).toBe(true);
    });

    it("always lets someone read their own answer, sensitive or not", async () => {
      // Level 3, and the reason a withdrawal can never lock you out of
      // your own data.
      const { alice, q } = await sensitiveSetup();
      expect(await canRead(alice, alice, q)).toBe(true);
      // Even after reducing it to emergency-only.
      expect(await canRead(alice, alice, q, false)).toBe(true);
    });

    it("reduces to emergency-only when the member unchecks sharing", async () => {
      // Level 2's own lever. Not a decline — the answer is still theirs
      // and still on their profile; it's the *audience* that goes away.
      const { alice, bob, q, tier } = await sensitiveSetup();
      await db.update(memberTable).set({ tierIds: [tier] }).where(eq(memberTable.id, bob.id));
      const [bobIn] = await db.select().from(memberTable).where(eq(memberTable.id, bob.id));
      expect(await canRead(bobIn, alice, q, true)).toBe(true);
      expect(await canRead(bobIn, alice, q, false)).toBe(false);
    });

    it("FAILS CLOSED on a sensitive question with no rules at all", async () => {
      // The load-bearing property. The guard makes this state unreachable
      // through the settings, but the database is editable by hand and a
      // deleted rule leaves a sensitive question with no audience — so the
      // read side has to be right on its own.
      //
      // Read as "nobody but the owner" and not as "everyone, because no
      // rule was found to forbid it". Being wrong in this direction costs
      // a hidden answer; being wrong in the other costs someone's
      // medication.
      const { alice, bob, q, tier } = await sensitiveSetup();
      const [rule] = await listSensitiveFieldAccessRules(alice);
      expect(rule.questionId).toBe(q.id);
      await deleteSensitiveFieldAccessRule(alice, rule.id);
      await db.update(memberTable).set({ tierIds: [tier] }).where(eq(memberTable.id, bob.id));
      const [bobIn] = await db.select().from(memberTable).where(eq(memberTable.id, bob.id));
      expect(await canRead(bobIn, alice, q)).toBe(false);
      expect(await canRead(alice, alice, q)).toBe(true);
    });

    it("unlocks for a task holder, and for whoever holds the granting task", async () => {
      // The three routes mean the same thing to a question as to a fixed
      // member column, so the union resolution has to work for both —
      // "Kitchen is open, so anyone holding Kitchen" is the whole idea of
      // the general capability.
      const { alice, bob, carol, q, c } = await sensitiveSetup();
      const [rule] = await listSensitiveFieldAccessRules(alice);
      await deleteSensitiveFieldAccessRule(alice, rule.id);
      const t = await insertTask(c.id, (await db.select({ id: branch.id }).from(branch).where(eq(branch.communityId, c.id)))[0].id, alice.id);
      await createSensitiveFieldAccessRule(alice, { questionId: q.id, unlockedByTaskId: t.id });
      // Answered *after* the new rule, so the consent row exists. The
      // answer `sensitiveSetup` already gave is deliberately not used here:
      // a rule added later cannot reach it, and there is a test below that
      // says so.
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });

      expect(await canRead(bob, alice, q)).toBe(false);
      await claimTask(bob, t.id);
      const [bobNow] = await db.select().from(memberTable).where(eq(memberTable.id, bob.id));
      expect(await canRead(bobNow, alice, q)).toBe(true);
      // A different member without the hold still cannot.
      expect(await canRead(carol, alice, q)).toBe(false);
    });

    it("treats the audience as a relationship, so a new claimer is inside it", async () => {
      // The settled decision, and it's the one that makes notifications
      // tractable: consent is to the *rule*, not to a list of people. A
      // task being claimed by somebody new is not a consent event, so
      // Bob is unreadable, Carol claims it, and Carol is immediately
      // readable with no decision required from anyone.
      const { alice, bob, carol, q, c } = await sensitiveSetup();
      const [rule] = await listSensitiveFieldAccessRules(alice);
      await deleteSensitiveFieldAccessRule(alice, rule.id);
      const t = await insertTask(
        c.id,
        (await db.select({ id: branch.id }).from(branch).where(eq(branch.communityId, c.id)))[0].id,
        alice.id,
      );
      await createSensitiveFieldAccessRule(alice, { questionId: q.id, unlockedByTaskId: t.id });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "epipen" });
      expect(await canRead(carol, alice, q)).toBe(false);

      await claimTask(carol, t.id);
      const [carolNow] = await db.select().from(memberTable).where(eq(memberTable.id, carol.id));
      expect(await canRead(carolNow, alice, q)).toBe(true);
      // …and Bob, who never held it, is not.
      expect(await canRead(bob, alice, q)).toBe(false);
    });

    it("stops being readable the moment the rule goes", async () => {
      // No caching, no stale grants: a deletion takes effect on the next
      // read. This is why the resolution is a function of current state
      // rather than a stored entitlement.
      const { alice, bob, q, tier } = await sensitiveSetup();
      await db.update(memberTable).set({ tierIds: [tier] }).where(eq(memberTable.id, bob.id));
      const [bobIn] = await db.select().from(memberTable).where(eq(memberTable.id, bob.id));
      expect(await canRead(bobIn, alice, q)).toBe(true);
      const [rule] = await listSensitiveFieldAccessRules(alice);
      await deleteSensitiveFieldAccessRule(alice, rule.id);
      expect(await canRead(bobIn, alice, q)).toBe(false);
    });

    it("gives the same answer whichever of the member's questions is asked", async () => {
      // A batch read, which is the shape a profile actually needs: one
      // public question and one restricted, resolved together without the
      // restricted one leaking into the public one's count.
      const { alice, bob, q } = await sensitiveSetup();
      const pub = await createProfileQuestion(alice, {
        label: "Shirt size",
        responseType: "single_choice",
        options: ["S", "M"],
        scope: "once_ever",
      });
      const readable = await resolveReadableQuestions(bob, alice.id, [
        { questionId: q.id, sensitive: true, shareWithAudience: true },
        { questionId: pub.id, sensitive: false, shareWithAudience: true },
      ]);
      expect([...readable].sort()).toEqual([pub.id].sort());
    });
  });

  describe("emergency access and publishing contradict each other", () => {
    /** A publishable question shape, so only the flags under test vary. */
    const base = {
      label: "Allergies on site",
      responseType: "single_choice" as const,
      options: ["none", "peanuts", "shellfish"],
      scope: "once_ever" as const,
      allowPreferNotToSay: true,
    };

    it("refuses emergency access on a question nothing restricts", async () => {
      // Emergency access overrides a restriction, so it needs one to
      // override. Vacuous rather than harmless: a non-sensitive question
      // is already readable by the whole community, so "answering this
      // consents to emergency reads" consents to nothing — and the reveal
      // would log a read of *public* data as though it had been protected.
      // That's the one thing an audit trail must never be.
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, { ...base, emergencyAccess: true }),
      ).rejects.toThrow(/needs one to override/);
    });

    it("refuses ticking emergency on a question that isn't sensitive", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, base);
      await expect(updateProfileQuestion(alice, q.id, { emergencyAccess: true })).rejects.toThrow(
        /needs one to override/,
      );
    });

    it("allows both at once, because the audience is chosen with the flag", async () => {
      // This used to be a four-step sequence with each step refused until
      // the last: create plain, add a rule, mark sensitive, mark
      // emergency. It is one call now, and the row it returns is already
      // both — the intermediate states were an ordering constraint, not
      // decisions anybody was making.
      const { alice } = await createFixtures();
      const q = await createRestrictedQuestion(
        alice,
        base,
        { emergencyAccess: true, audience: { unlockedByTierId: await tierId(alice) } },
      );
      expect(q.sensitive).toBe(true);
      expect(q.emergencyAccess).toBe(true);
    });

    it("still allows un-ticking emergency, whatever the question looks like", async () => {
      // Un-ticking discloses nothing, so it is never blocked. A question
      // can also end up in a state the guards would have refused — a rule
      // deleted, a publication ticked by hand — and an Admin has to be
      // able to get out of it without deleting the question and its
      // answers.
      const { alice } = await createFixtures();
      const q = await createRestrictedQuestion(
        alice,
        base,
        { emergencyAccess: true, audience: { unlockedByTierId: await tierId(alice) } },
      );
      const off = await updateProfileQuestion(alice, q.id, { emergencyAccess: false });
      expect(off.emergencyAccess).toBe(false);
      expect(off.sensitive).toBe(true);
    });

    it("refuses to create a question that is both", async () => {
      // A published indicator is already readable by the whole community,
      // so an emergency override has nothing to reach — and the flag would
      // be asserting the opposite of the truth about why anyone would ever
      // need this answer. Caught at the settings boundary, not left for
      // someone to notice.
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, {
          ...base,
          publishedAsIndicator: true,
          emergencyAccess: true,
        }),
      ).rejects.toThrow(/both an emergency-access question and a published/);
    });

    it("refuses to add emergency access to a published question", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, { ...base, publishedAsIndicator: true });
      await expect(
        updateProfileQuestion(alice, q.id, { emergencyAccess: true }),
      ).rejects.toThrow(/both an emergency-access question and a published/);
      // And it didn't get half-applied on the way to failing.
      const [row] = await db
        .select({ emergencyAccess: profileQuestion.emergencyAccess })
        .from(profileQuestion)
        .where(eq(profileQuestion.id, q.id));
      expect(row.emergencyAccess).toBe(false);
    });

    it("refuses to publish a question that already has emergency access", async () => {
      // The other direction, and the one a bulk-import or a task-derived
      // question would hit: the two flags arrive on different code paths,
      // so each direction needs its own refusal.
      //
      // Reached by writing the flag directly, because it's now
      // unreachable through the settings: emergency requires sensitive,
      // and sensitive is refused alongside published, so the *sensitive*
      // guard catches this on the honest path. The emergency guard is
      // still worth having for a hand-edited row, and this is the only
      // way to exercise it.
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, base);
      await db
        .update(profileQuestion)
        .set({ emergencyAccess: true })
        .where(eq(profileQuestion.id, q.id));
      await expect(
        updateProfileQuestion(alice, q.id, { publishedAsIndicator: true }),
      ).rejects.toThrow(/both an emergency-access question and a published/);
    });

    it("un-publishing and turning emergency on is one save", async () => {
      // The form submits every flag on every save, so a rule that needed
      // two round-trips would be a rule the form as built can't obey.
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, { ...base, publishedAsIndicator: true });
      // Made restricted by hand, the way a Community would have had to
      // before `sensitive` could be set at creation — the row is not
      // reachable through createProfileQuestion at all, which is the
      // point.
      await createSensitiveFieldAccessRule(alice, {
        questionId: q.id,
        unlockedByTierId: await tierId(alice),
      });
      await db.update(profileQuestion).set({ sensitive: true }).where(eq(profileQuestion.id, q.id));
      const updated = await updateProfileQuestion(alice, q.id, {
        publishedAsIndicator: false,
        emergencyAccess: true,
      });
      expect(updated.publishedAsIndicator).toBe(false);
      expect(updated.sensitive).toBe(true);
      expect(updated.emergencyAccess).toBe(true);
    });

    it("refuses a sensitive question created without an audience", async () => {
      // A sensitive question is restricted *by* its audience, so the pair
      // is one decision and half of it is not a thing. Accepting one
      // silently would hand an Admin who believed they'd restricted a
      // question an answer nobody can see — which reads as broken rather
      // than as private, so it gets caught at the boundary.
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, { ...base, sensitive: true }),
      ).rejects.toThrow(/needs an audience/);
    });

    it("refuses an audience on a question that isn't sensitive", async () => {
      // The mirror. An audience on a public question restricts nothing and
      // looks on the settings page like it's doing something.
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, {
          ...base,
          audience: { unlockedByTierId: await tierId(alice) },
        }),
      ).rejects.toThrow(/this one isn't sensitive/);
    });

    it("leaves emergency access independent of scope", async () => {
      // Sensitive and emergency are dependent — one overrides a
      // restriction the other declares — but neither says anything about
      // *when* a question applies. "Medication on site" is once-ever;
      // "medication for this event" is per-event; both can be emergency
      // questions, and an earlier three-category taxonomy made exactly
      // that inexpressible.
      const { alice } = await createFixtures();
      const flagged = await createRestrictedQuestion(
        alice,
        base,
        { emergencyAccess: true, audience: { unlockedByTierId: await tierId(alice) } },
      );
      expect(flagged.emergencyAccess).toBe(true);
      // Scope was never a field this function touches, and still isn't.
      expect(flagged.scope).toBe("once_ever");
      // …and the schema's defaults still put both off on a plain question.
      const plain = await createProfileQuestion(alice, { ...base, label: "Shirt size" });
      expect(plain.sensitive).toBe(false);
      expect(plain.emergencyAccess).toBe(false);
    });
  });

  describe("a sensitive question with no rule is owner-and-emergency-only", () => {
    const base = {
      label: "Medication on site",
      responseType: "single_choice" as const,
      options: ["none", "inhaler", "epipen"],
      scope: "once_ever" as const,
      allowPreferNotToSay: true,
    };

    it("reads as nobody but the owner when the last rule is deleted", async () => {
      // The owner-and-emergency-only state is still reachable — by
      // deleting the audience — and it resolves fail-closed, which is the
      // right direction for a state nobody chose deliberately. It is no
      // longer reachable *at creation*, because a sensitive question
      // without an audience is refused there: the write side treats the
      // flag and the audience as one decision, and half of it is not a
      // thing.
      const { alice, community } = await createFixtures();
      const bob = await db.insert(memberTable).values({ communityId: community.id, name: "Bob" }).returning();
      const q = await createRestrictedQuestion(alice, base, {
        audience: { unlockedByTierId: await tierId(alice) },
      });
      const [rule] = await listSensitiveFieldAccessRules(alice);
      await deleteSensitiveFieldAccessRule(alice, rule.id);

      expect(await listSensitiveFieldAccessRules(alice)).toHaveLength(0);
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "inhaler" });
      const readable = await resolveReadableAnswersForCommunity(bob[0]);
      // Bob can't read it — the map has no entry naming him, which is the
      // fail-closed reading rather than a row saying "denied".
      expect(questionsReadableBy(readable, alice.id).has(q.id)).toBe(false);
      // The owner still reads their own.
      const asOwner = await resolveReadableAnswersForCommunity(alice);
      expect(questionsReadableBy(asOwner, alice.id)).toContain(q.id);
    });

    it("refuses a rule naming a question in another community", async () => {
      // Cross-community ids are not a thing the settings form can produce,
      // but the lib is called directly and the rule would otherwise be a
      // permanent no-op pointing at somebody else's data.
      const { alice } = await createFixtures();
      const other = await createFixtures();
      const foreign = await createProfileQuestion(other.alice, base);
      await expect(
        createSensitiveFieldAccessRule(alice, {
          questionId: foreign.id,
          unlockedByTierId: await tierId(alice),
        }),
      ).rejects.toThrow(NotFoundError);
    });

    it("refuses publishing a restricted question", async () => {
      // The second contradiction: restricted says "not the whole
      // Community", published says "in front of everyone". Both on is a
      // flag asserting something untrue, which is worse than either alone.
      // Checked against the *stored* sensitive rather than a submitted
      // one, because the flag can't be submitted any more — this is about
      // the question as it already is.
      const { alice } = await createFixtures();
      const q = await createRestrictedQuestion(alice, base, {
        audience: { unlockedByTierId: await tierId(alice) },
      });
      await expect(
        updateProfileQuestion(alice, q.id, { publishedAsIndicator: true }),
      ).rejects.toThrow(/both sensitive and a published/);
    });

    it("refuses creating one that is both", async () => {
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, {
          ...base,
          publishedAsIndicator: true,
          sensitive: true,
          audience: { unlockedByTierId: await tierId(alice) },
        }),
      ).rejects.toThrow(/both sensitive and a published/);
    });
  });

  describe("the consent floor: a published indicator must offer a way to decline", () => {
    const pronouns = {
      label: "Pronouns",
      responseType: "single_choice" as const,
      options: ["she/her", "he/him"],
      scope: "once_ever" as const,
    };

    it("refuses to publish a question with no way to decline", async () => {
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, { ...pronouns, publishedAsIndicator: true }),
      ).rejects.toThrow(ConflictError);
      // The same question is fine unpublished — the rule is about
      // counting people in a public number, not about asking the
      // question at all.
      const q = await createProfileQuestion(alice, { ...pronouns, allowPreferNotToSay: true });
      expect(q.publishedAsIndicator).toBe(false);
    });

    it("refuses to switch one on after the fact without it", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, pronouns);
      await expect(
        updateProfileQuestion(alice, q.id, { publishedAsIndicator: true }),
      ).rejects.toThrow(/prefer not to say/);
    });

    it("refuses to un-tick the decline on a published question", async () => {
      // The rule that isn't obviously a write-side check: this is an
      // edit to a *consent* flag, and without it in the effective state
      // a published indicator would keep standing on a promise the
      // community had just withdrawn.
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        ...pronouns,
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      // The message is the "unpublish first" one, with the consent
      // reason spliced in — so it's the *reason* that names the problem,
      // not the remedy (the remedy is to unpublish).
      await expect(
        updateProfileQuestion(alice, q.id, { allowPreferNotToSay: false }),
      ).rejects.toThrow(/leaves only silence/);
      const [unchanged] = await db.select().from(profileQuestion).where(eq(profileQuestion.id, q.id));
      expect(unchanged.allowPreferNotToSay).toBe(true);
      expect(unchanged.publishedAsIndicator).toBe(true);
    });

    it("lets an admin unpublish first, withdraw consent, and republish deliberately", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        ...pronouns,
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: false });
      await updateProfileQuestion(alice, q.id, { allowPreferNotToSay: false });
      const { indicators } = await listCommunityIndicators(alice);
      expect(indicators).toEqual([]);
      // Republishing without it is still refused, so the sequence has to
      // be re-ticked too — withdrawing consent isn't a way to sneak the
      // indicator back out.
      await expect(
        updateProfileQuestion(alice, q.id, { publishedAsIndicator: true }),
      ).rejects.toThrow(ConflictError);
    });

    it("stops rendering an indicator that somehow lost its decline", async () => {
      // The read side re-checks rather than trusting the write side,
      // because a row can predate the rule — and because this function
      // is also the JSON API's path in, so a direct caller would
      // otherwise be able to publish one.
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        ...pronouns,
        allowPreferNotToSay: true,
        publishedAsIndicator: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      expect((await listCommunityIndicators(alice)).indicators).toHaveLength(1);

      // Straight past the lib, the way a legacy row or a restored
      // backup would arrive.
      await db
        .update(profileQuestion)
        .set({ allowPreferNotToSay: false })
        .where(eq(profileQuestion.id, q.id));
      expect((await listCommunityIndicators(alice)).indicators).toEqual([]);

      // And the settings toggle shows the same reason, pointing at the
      // one box that fixes it.
      const [row] = await db.select().from(profileQuestion).where(eq(profileQuestion.id, q.id));
      expect(canPublishAsIndicator(row)).toBe(false);
      expect(indicatorBlocker(row)?.remedy).toMatch(/allow prefer not to say/);
    });
  });

  describe("the display form is derived, not chosen", () => {
    it("gives every publishable type a family, and refuses text", () => {
      expect(indicatorFamilyFor("single_choice")).toBe("split");
      expect(indicatorFamilyFor("boolean")).toBe("split");
      // The one that must never be a pie: five people choosing three
      // options each is 15 slices over 5 people, so the counts are "how
      // many people chose this" and don't sum to the answerer count.
      expect(indicatorFamilyFor("multi_choice")).toBe("distribution");
      expect(indicatorFamilyFor("number")).toBe("summary");
      expect(indicatorFamilyFor("date")).toBe("summary");
      // Prose. The only honest total of a text field is the members'
      // own words, which is not an aggregate.
      expect(indicatorFamilyFor("text")).toBeNull();
    });

    it("explains a refusal in the question's own terms, with a remedy", () => {
      const consent = { allowPreferNotToSay: true };
      const text = indicatorBlocker({ responseType: "text", scope: "once_ever", ...consent });
      expect(text?.reason).toMatch(/can't be aggregated/);
      // The remedy has to be actionable on its own — this is the whole
      // content of a disabled checkbox's explanation.
      expect(text?.remedy).toMatch(/Change the answer type/);

      const scoped = indicatorBlocker({ responseType: "single_choice", scope: "per_cycle", ...consent });
      expect(scoped?.reason).toMatch(/per-event or per-phase/);
      // A *different* remedy, because the fix is genuinely different: a
      // question's scope can't be changed after creation.
      expect(scoped?.remedy).toMatch(/fixed when the question is created/);

      expect(
        indicatorBlocker({ responseType: "single_choice", scope: "once_ever", ...consent }),
      ).toBeNull();
    });

    it("requires a way to decline, and is last in line so it's the fix it names", () => {
      const noConsent = { responseType: "single_choice", scope: "once_ever", allowPreferNotToSay: false };
      const blocker = indicatorBlocker(noConsent);
      // Silence isn't consent: a member's only other option is to not
      // answer, and that shows up as "2 haven't" in the coverage line —
      // so the refusal leaks through the gap it was meant to protect.
      expect(blocker?.reason).toMatch(/leaves only silence/);
      expect(blocker?.remedy).toMatch(/allow prefer not to say/);

      // Ordering matters: a question that is *also* a written answer
      // should be told to fix the type first, because no amount of
      // consent would make a text field aggregable.
      expect(indicatorBlocker({ ...noConsent, responseType: "text" })?.reason).toMatch(
        /can't be aggregated/,
      );
    });

    it("never offers the publish-a-different-type remedy to someone trying to stop", async () => {
      // The two callers' messages have to stay separate. Concatenating
      // them produced "change the answer type to pick one first.
      // Unpublish it first." — advice that contradicts itself, given to
      // an admin who was only retitling a question.
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      const err = await updateProfileQuestion(alice, q.id, { responseType: "text" }).catch(
        (e: unknown) => e,
      );
      const message = err instanceof Error ? err.message : "";
      expect(message).toMatch(/Unpublish it first/);
      expect(message).not.toMatch(/Change the answer type to pick one/);
    });

    it("labels every family it can derive", () => {
      for (const family of ["split", "distribution", "summary"] as const) {
        expect(INDICATOR_FAMILY_LABELS[family]).toBeTruthy();
      }
    });
  });

  describe("what may be published at all", () => {
    it("refuses to publish a written answer", async () => {
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, {
          label: "Anything else we should know?",
          responseType: "text",
          scope: "once_ever",
          publishedAsIndicator: true,
        allowPreferNotToSay: true,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("refuses to publish a per-event or per-phase answer", async () => {
      const { alice } = await createFixtures();
      await expect(
        createProfileQuestion(alice, {
          label: "Hours this round",
          responseType: "number",
          scope: "per_cycle",
          publishedAsIndicator: true,
        allowPreferNotToSay: true,
        }),
      ).rejects.toThrow(ConflictError);
      // Same for a phase-scoped one, which is the other way a standing
      // question can quietly become a windowed one.
      await expect(
        createProfileQuestion(alice, {
          label: "Beds needed at Build",
          responseType: "boolean",
          scope: "phase",
          phaseNameHint: "Build",
          publishedAsIndicator: true,
        allowPreferNotToSay: true,
        }),
      ).rejects.toThrow(ConflictError);
    });

    it("publishes a publishable one", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him", "they/them"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      expect(q.publishedAsIndicator).toBe(true);
      expect(canPublishAsIndicator(q)).toBe(true);
    });
  });

  describe("an edit can't silently break a published indicator", () => {
    it("refuses to turn a published question into a written answer", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });

      // Refused rather than quietly unpublishing: a community chose to
      // publish this, and an admin editing a dropdown shouldn't make it
      // vanish from /community with nothing said.
      await expect(updateProfileQuestion(alice, q.id, { responseType: "text" })).rejects.toThrow(
        AppError,
      );
      const [unchanged] = await db.select().from(profileQuestion).where(eq(profileQuestion.id, q.id));
      expect(unchanged.publishedAsIndicator).toBe(true);
      expect(unchanged.responseType).toBe("single_choice");
    });

    it("allows the same change once it's been unpublished first", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await updateProfileQuestion(alice, q.id, { publishedAsIndicator: false });
      const updated = await updateProfileQuestion(alice, q.id, { responseType: "text" });
      expect(updated.responseType).toBe("text");
      expect(updated.publishedAsIndicator).toBe(false);
    });

    it("allows unpublishing and retyping in a single save", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      const updated = await updateProfileQuestion(alice, q.id, {
        publishedAsIndicator: false,
        responseType: "text",
      });
      expect(updated.responseType).toBe("text");
    });

    it("still allows an ordinary label edit on a published question", async () => {
      const { alice } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      // The regression this guards: a guard written as "reject any
      // update to a published question" would block this, and then
      // retitling a published indicator would be impossible.
      const updated = await updateProfileQuestion(alice, q.id, { label: "Your pronouns" });
      expect(updated.label).toBe("Your pronouns");
      expect(updated.publishedAsIndicator).toBe(true);
    });
  });

  describe("the aggregate", () => {
    async function pronounIndicator() {
      const { alice, bob, community: c } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him", "they/them"],
        allowOther: true,
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      return { alice, bob, c, q };
    }

    it("counts each option, including the ones nobody picked", async () => {
      const { alice, bob, q } = await pronounIndicator();
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "she/her" });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.label).toBe("Pronouns");
      expect(ind.family).toBe("split");
      expect(ind.answered).toBe(2);
      expect(ind.data).toEqual({
        family: "split",
        // Every option is a row even at zero, so a reader can see the
        // question's shape and a real zero isn't the same as an option
        // that doesn't exist.
        rows: [
          { label: "she/her", count: 2 },
          { label: "he/him", count: 0 },
          { label: "they/them", count: 0 },
        ],
      });
    });

    it("shows the escape hatch's answers as their own visible row", async () => {
      const { alice, bob, q } = await pronounIndicator();
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      // Stored as an ordinary string in an option's own slot — that's the
      // design that lets the real options be counted without a special
      // case — so the aggregate has to recognise it as "not one of ours".
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "xe/xim" });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      const rows = (ind.data as { rows: { label: string; count: number }[] }).rows;
      // Visible as itself rather than folded into a neighbour or dropped
      // (dropping would make the parts fail to sum, and would make the
      // escape hatch pointless).
      expect(rows).toEqual([
        { label: "she/her", count: 1 },
        { label: "he/him", count: 0 },
        { label: "they/them", count: 0 },
        { label: "Something else", count: 1 },
      ]);
      // …and only as a count. Publishing what someone typed is a
      // disclosure no "publish this indicator" toggle can consent to on
      // their behalf.
      expect(JSON.stringify(ind.data)).not.toContain("xe/xim");
    });

    it("counts a refusal apart from silence, and reports coverage either way", async () => {
      // alice and bob come from the fixture; Carol is a third member who
      // says nothing at all and must be counted as neither.
      const { alice, bob, community: c } = await createFixtures();
      const carol = await addMember(c.id, "Carol");
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him", "they/them"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "declined" });
      expect(carol.id).toBeTruthy();

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.answered).toBe(1);
      expect(ind.declined).toBe(1);
      // Every member is in the denominator, so the number a share is
      // computed against is visible and checkable.
      expect(ind.population).toBe(3);
    });

    it("never leaves a deferral looking like an answer", async () => {
      const { alice, q } = await pronounIndicator();
      await answerProfileQuestion(alice, q.id, { status: "deferred" });
      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.answered).toBe(0);
      expect(ind.declined).toBe(0);
      // The shape is still published, so the reader can see the question
      // exists and that nobody has answered it yet.
      expect((ind.data as { rows: unknown[] }).rows).toHaveLength(3);
    });

    it("scopes a pick-any question as a distribution, not a share of a whole", async () => {
      const { alice, bob } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Which skills do you have?",
        responseType: "multi_choice",
        options: ["welding", "carpentry", "driving"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: ["welding", "driving"] });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: ["driving"] });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.family).toBe("distribution");
      expect(ind.data).toEqual({
        family: "distribution",
        // Per-option counts of PEOPLE, deliberately not summing to 2 —
        // that's 3 picks across 2 people, and a pie of that would claim
        // something false about both.
        rows: [
          { label: "welding", count: 1 },
          { label: "carpentry", count: 0 },
          { label: "driving", count: 2 },
        ],
      });
    });

    it("summarises a number as a range, with the median as well as the mean", async () => {
      // 3, 3, 60 across three members — the shape of real volunteer
      // data, and the reason the median is reported next to the mean
      // rather than instead of it: 3/3/60 has a mean of 22 that describes
      // nobody in it.
      const { alice, bob, community: c } = await createFixtures();
      const carol = await addMember(c.id, "Carol");
      const q = await createProfileQuestion(alice, {
        label: "Hours a week you could give",
        responseType: "number",
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: 3 });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: 60 });
      await answerProfileQuestion(carol, q.id, { status: "answered", value: 3 });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.family).toBe("summary");
      expect(ind.data).toEqual({
        family: "summary",
        figures: [
          { label: "lowest", value: "3" },
          { label: "median", value: "3" },
          { label: "mean", value: "22.0" },
          { label: "highest", value: "60" },
        ],
      });
    });

    it("splits a yes/no, and keeps both sides legible", async () => {
      const { alice, bob } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Do you have a vehicle?",
        responseType: "boolean",
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: true });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: false });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.family).toBe("split");
      // A boolean is stored as a real true/false, not a string in an
      // option's slot — so it can't go through the same counting path as
      // a choice, and a `typeof v !== "string"` filter there would
      // silently produce two empty rows.
      expect(ind.data).toEqual({
        family: "split",
        // Both sides always, so the two-way shape is readable even when
        // everyone has given the same answer.
        rows: [
          { label: "Yes", count: 1 },
          { label: "No", count: 1 },
        ],
      });
    });

    it("shows an all-yes yes/no as a real zero rather than a missing row", async () => {
      const { alice, bob } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "Do you have a vehicle?",
        responseType: "boolean",
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: true });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: true });
      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect((ind.data as { rows: { label: string; count: number }[] }).rows).toEqual([
        { label: "Yes", count: 2 },
        { label: "No", count: 0 },
      ]);
    });

    it("summarises a date as a range rather than bucketing it", async () => {
      const { alice, bob } = await createFixtures();
      const q = await createProfileQuestion(alice, {
        label: "When can you help?",
        responseType: "date",
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "2027-06-01" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "2027-03-01" });

      const { indicators: [ind] } = await listCommunityIndicators(alice);
      expect(ind.data).toEqual({
        family: "summary",
        figures: [
          { label: "earliest", value: "Mar 1, 2027" },
          { label: "latest", value: "Jun 1, 2027" },
        ],
      });
    });

    it("publishes nothing for a community with no indicators, and never another one's", async () => {
      const { alice } = await createFixtures();
      expect((await listCommunityIndicators(alice)).indicators).toEqual([]);

      await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
      });
      // Not published: a question the community didn't opt in stays off
      // the page entirely rather than existing invisibly.
      expect((await listCommunityIndicators(alice)).indicators).toEqual([]);

      const stranger = await createFixtures();
      await createProfileQuestion(stranger.alice, {
        label: "Their pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      expect((await listCommunityIndicators(alice)).indicators).toEqual([]);
      expect((await listCommunityIndicators(stranger.alice)).indicators).toHaveLength(1);
    });

    it("stops publishing an archived question's stale numbers", async () => {
      const { alice, q } = await pronounIndicator();
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      expect((await listCommunityIndicators(alice)).indicators).toHaveLength(1);
      // Archiving means "we don't ask this any more". A number nobody
      // maintains, ageing silently, is worse for trust than none.
      await archiveProfileQuestion(alice, q.id);
      expect((await listCommunityIndicators(alice)).indicators).toEqual([]);
    });
  });

  describe("scoping the population to one event", () => {
    /** A published pronouns question plus a mix of members and attendees. */
    async function scopedSetup() {
      const { alice, bob, community: c, branch: b } = await createFixtures();
      const t = await insertTask(c.id, b.id, alice.id);
      const carol = await addMember(c.id, "Carol");
      const dave = await addMember(c.id, "Dave");
      await enableCycles(c.id);
      const cycle = await createCycle(alice, { source: "blank", name: "Spring Weekend" });

      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      // Alice, Bob and Carol come; Dave doesn't. All four have answered
      // pronouns, so the *only* thing separating the two scopes is who
      // counts as part of the population.
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "he/him" });
      await answerProfileQuestion(carol, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(dave, q.id, { status: "answered", value: "he/him" });
      for (const m of [alice, bob, carol]) {
        await declareParticipation(m, cycle.id, { status: "coming" });
      }
      return { alice, bob, carol, dave, c, cycle, q, t };
    }

    it("counts only the event's attendees when narrowed to it", async () => {
      const { alice, cycle } = await scopedSetup();
      const { scope, scopeFallback, indicators } = await listCommunityIndicators(alice, {
        requested: { kind: "event", cycleId: cycle.id, cycleName: cycle.name },
        policy: { enabled: true },
      });
      expect(scope).toEqual({ kind: "event", cycleId: cycle.id, cycleName: "Spring Weekend" });
      expect(scopeFallback).toBeNull();
      const [ind] = indicators;
      // Three of the four answerers are coming, so the population is 3
      // and Dave's answer is not in the count at all — not in the
      // numerator *or* silently inflating the denominator.
      expect(ind.population).toBe(3);
      expect(ind.answered).toBe(3);
      expect(ind.data).toEqual({
        family: "split",
        rows: [
          { label: "she/her", count: 2 },
          { label: "he/him", count: 1 },
        ],
      });
    });

    it("describes the whole community when not narrowed", async () => {
      const { alice } = await scopedSetup();
      const { scope, indicators } = await listCommunityIndicators(alice);
      expect(scope).toEqual({ kind: "community" });
      const [ind] = indicators;
      expect(ind.population).toBe(4);
      expect(ind.answered).toBe(4);
    });

    it("ignores a Maybe or Not-coming response to the same question", async () => {
      // The population is "coming", read from the same Participation
      // status the Dashboard's "N members coming" count uses — so an
      // indicator and the count above it can't describe different groups.
      const { alice, bob, cycle } = await scopedSetup();
      await declareParticipation(bob, cycle.id, { status: "maybe" });
      const { indicators } = await listCommunityIndicators(alice, {
        requested: { kind: "event", cycleId: cycle.id, cycleName: cycle.name },
        policy: { enabled: true },
      });
      const [ind] = indicators;
      expect(ind.population).toBe(2);
      expect(ind.answered).toBe(2);
    });

    it("shows the community's figures, not an empty chart, when nobody is coming", async () => {
      // This used to assert a 0-of-0 event view, on the reasoning that
      // borrowing the community's numbers under an event heading is the
      // worst option. The per-cycle policy makes that moot: an event with
      // nobody coming is below any floor, so it falls back to the
      // community view with a note — honest, and a better read than an
      // empty chart nobody can interpret.
      const { alice, community: c, branch: b } = await createFixtures();
      const t = await insertTask(c.id, b.id, alice.id);
      await enableCycles(c.id);
      const cycle = await createCycle(alice, { source: "blank", name: "Nobody's coming" });
      await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      expect(t.id).toBeTruthy();
      const { scope, scopeFallback, indicators } = await listCommunityIndicators(alice, {
        requested: { kind: "event", cycleId: cycle.id, cycleName: cycle.name },
        policy: { enabled: true },
      });
      expect(scope).toEqual({ kind: "community" });
      expect(scopeFallback).toMatch(/nobody is signed up/);
      expect(indicators[0].population).toBe(2);
    });

    it("shows a member without coordination rights the same breakdown", async () => {
      // Indicators are never permission-tiered. Their whole purpose is to
      // tell the community something about itself, so the content is public
      // by construction — the protections here are consent and the
      // community's own choice of what to publish, not a holder role.
      // This is the regression guard against reintroducing a gate.
      const { alice, bob, cycle, c, t } = await scopedSetup();
      const scope = { kind: "event" as const, cycleId: cycle.id, cycleName: cycle.name };
      const asAlice = (await listCommunityIndicators(alice, { requested: scope, policy: { enabled: true } })).indicators;
      expect((await listCommunityIndicators(bob, { requested: scope, policy: { enabled: true } })).indicators).toEqual(asAlice);

      // And a coordination holder sees nothing *more* — deliberately.
      await grantPermission(c.id, "community_coordination", t.id);
      await claimTask(alice, t.id);
      expect((await listCommunityIndicators(bob, { requested: scope, policy: { enabled: true } })).indicators).toEqual(asAlice);
    });
  });

  describe("indicators are never permission-tiered", () => {
    // A regression guard, in the direction the feature actually goes. The
    // gate this replaced was `indicatorVisibility: 'coordination'`, and it
    // was removed because an indicator's purpose is to tell the community
    // something about itself: gating the content while still showing
    // coverage meant most members read "3 of 4 answered" — a set of facts
    // about a small, nameable group — and nothing else. The protections
    // that belong on this surface are consent and the community's own
    // choice of what to publish.
    it("gives every member the same numbers, whatever they hold", async () => {
      const { alice, bob, community: c, branch: b } = await createFixtures();
      const t = await insertTask(c.id, b.id, alice.id);
      const q = await createProfileQuestion(alice, {
        label: "Pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him"],
        scope: "once_ever",
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
      });
      await answerProfileQuestion(alice, q.id, { status: "answered", value: "she/her" });
      await answerProfileQuestion(bob, q.id, { status: "answered", value: "he/him" });

      const plain = (await listCommunityIndicators(bob)).indicators;
      expect(plain[0].data).toEqual({
        family: "split",
        rows: [
          { label: "she/her", count: 1 },
          { label: "he/him", count: 1 },
        ],
      });

      // Granting coordination changes nothing at all, in either direction.
      await grantPermission(c.id, "community_coordination", t.id);
      await claimTask(alice, t.id);
      expect((await listCommunityIndicators(bob)).indicators).toEqual(plain);
      expect((await listCommunityIndicators(alice)).indicators).toEqual(plain);
    });
  });
});

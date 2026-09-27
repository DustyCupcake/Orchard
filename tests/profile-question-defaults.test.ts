import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as memberTable, profileQuestion, sensitiveFieldAccessRule, tier } from "@/db/schema";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  DEFAULT_QUESTION_KEYS,
  hasProfileQuestions,
  maybeSeedDefaultProfileQuestions,
  seedDefaultProfileQuestions,
  validateDefaultQuestionTable,
  type DefaultQuestionChoices,
} from "@/lib/profile-questions/defaults";
import { resolveReadableQuestions } from "@/lib/sensitive-data";
import { listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { createFixtures, insertTask, resetDatabase } from "./helpers";

// A new community's starting set. The seed is an *offer*, so what matters
// is that every seeded question is one the community can actually live
// with: the indicators are lawful (declinable), the restricted ones are
// genuinely restricted (an audience, and therefore a real limit), and
// nothing arrives in a state the settings would have refused.
describe("seeding a community's default questions", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seeded() {
    const { alice, community: c } = await createFixtures();
    const created = await seedDefaultProfileQuestions(alice);
    return { alice, c, created };
  }

  /** A second member in an *existing* community — a read test needs them
   *  to share it, since the rules are resolved by the viewer's own. */
  async function addMember(communityId: string, name: string) {
    const [m] = await db.insert(memberTable).values({ communityId, name }).returning();
    return m;
  }

  it("creates every question in the table, in the table's order", async () => {
    const { created } = await seeded();
    const expected = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions.map((q) => q.label));
    expect(created.map((c) => c.label)).toEqual(expected);
  });

  it("gives every question a shape that can hold the answer it's for", async () => {
    // The guards make most of this unfalsifiable, which is the point: a
    // choice question with no options is refused, so a seed that tried
    // one would have thrown. What's left to check is the flags that
    // aren't guarded — scope, deferral, and the absence of emergency.
    const { alice } = await seeded();
    const rows = await db
      .select()
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId))
      .orderBy(profileQuestion.label);
    for (const row of rows) {
      // Deferrable by default: "I don't know yet" is the honest state for
      // a new member on a question they weren't expecting.
      expect(row.allowDeferral).toBe(true);
      // No seeded question is emergency-access. It's the one attribute
      // where a wrong default is a disclosure rather than an
      // inconvenience — any member can activate it, and answering was
      // the only consent. A community's call, in settings.
      expect(row.emergencyAccess).toBe(false);
    }
  });

  it("scopes every seeded question once-ever, and never per-event", async () => {
    // The load-bearing property of the whole table. A `per_cycle`
    // question is skipped on every read surface while its member has no
    // declared cycle and no open cycle exists to fall back to — and the
    // seed runs at signup, before a community has run an event. So a
    // per-event question in the starter set is a question nobody can see,
    // answer, or be nagged about, which is indistinguishable from the app
    // being broken. Asserted on the table and on the rows, because a table
    // that says one thing and a seeder that does another is the exact pair
    // of facts that let the first version of this through.
    const { alice } = await seeded();
    const rows = await db
      .select({ label: profileQuestion.label, scope: profileQuestion.scope })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.scope).toBe("once_ever");
    }
    // The table itself, so the check doesn't depend on the seeder.
    expect(() => validateDefaultQuestionTable()).not.toThrow();
    // And the questions that were in the old per-event group really are
    // gone rather than quietly rescoped — rescoping "do you need a bed?"
    // to once-ever would leave a community answering it about one weekend
    // for ever.
    const labels = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions.map((q) => q.label));
    for (const gone of [
      "Do you need a bed?",
      "T-shirt size",
      "Can you drive a van / carry passengers?",
      "Do you need a lift to or from an event?",
      "Dietary needs",
      "Can you carry heavy things?",
      "When are you generally around?",
    ]) {
      expect(labels).not.toContain(gone);
    }
    expect(rows.map((r) => r.label)).not.toContain("Do you need a bed?");
  });

  it("passes its own consistency check, and the check catches a broken row", async () => {
    // validateDefaultQuestionTable is what stops the next one-line table
    // edit from reintroducing this class of bug, so it needs to be known
    // to fire — a validator nothing has ever seen fail is not a validator.
    expect(() => validateDefaultQuestionTable()).not.toThrow();

    const broken = (groups: typeof DEFAULT_PROFILE_QUESTION_GROUPS) => {
      const copy = groups.map((g) => ({ ...g, questions: g.questions.map((q) => ({ ...q })) }));
      return copy as typeof DEFAULT_PROFILE_QUESTION_GROUPS;
    };

    // A Restricted row with no audience: the exact edit that let "Home
    // city or town" and "Full legal name" seed world-readable while their
    // own group said the opposite.
    const noAudience = broken(DEFAULT_PROFILE_QUESTION_GROUPS);
    noAudience.find((g) => g.title === "Restricted")!.questions[0].accessRuleModuleKey = undefined;
    expect(() => validateDefaultQuestionTable(noAudience)).toThrow(/audience/i);

    // A per-event group: the bug that made 7 of 20 seeded questions
    // invisible on every surface a community without an event could see.
    const perEvent = broken(DEFAULT_PROFILE_QUESTION_GROUPS);
    (perEvent[0] as { perEvent?: boolean }).perEvent = true;
    expect(() => validateDefaultQuestionTable(perEvent)).toThrow(/per_cycle/);

    // A permission module that doesn't exist — a rule that unlocks nothing.
    const badModule = broken(DEFAULT_PROFILE_QUESTION_GROUPS);
    badModule[0].questions[0].accessRuleModuleKey = "not_a_module" as never;
    expect(() => validateDefaultQuestionTable(badModule)).toThrow(/doesn't exist/);

    // An indicator with no decline, which the consent floor refuses at
    // create time — i.e. a seed that would throw during someone's signup.
    const undeclinable = broken(DEFAULT_PROFILE_QUESTION_GROUPS);
    undeclinable[0].questions[0].publishedAsIndicator = true;
    undeclinable[0].questions[0].allowPreferNotToSay = false;
    expect(() => validateDefaultQuestionTable(undeclinable)).toThrow(/decline/);
  });

  it("gives every Restricted question a real audience, and no others one by accident", async () => {
    // The Restricted group's blurb promises each row arrives with its
    // audience attached. Two rows didn't — they seeded world-readable while
    // the group said the opposite, which is the same failure as a typo'd
    // permission key: invisible in review, live in production.
    const restricted = DEFAULT_PROFILE_QUESTION_GROUPS.find((g) => g.title === "Restricted")!;
    for (const seed of restricted.questions) {
      expect(seed.accessRuleModuleKey).toBeTruthy();
    }
    // …and the table-level guard is a real guard, not a comment.
    const { alice, created } = await seeded();
    const ruledIds = new Set(
      (await listSensitiveFieldAccessRules(alice))
        .map((r) => r.questionId)
        .filter((id): id is string => Boolean(id)),
    );
    const restrictedLabels = new Set(restricted.questions.map((q) => q.label));
    for (const row of created) {
      const isRestricted = restrictedLabels.has(row.label);
      expect(row.sensitive).toBe(isRestricted);
      if (isRestricted) expect(ruledIds.has(row.id)).toBe(true);
    }
  });

  it("doesn't ask for a precise date of birth", async () => {
    // The old set had "Age range" as an indicator *and* "Date of birth" as a
    // restricted question with no decline offered. That collects a precise
    // identifier nobody in the set needs — the age band is what eligibility
    // is expressed in, and `requirement` is where a real eligibility gate
    // belongs — and it did so with no way for a member to decline. Age range
    // covers what the set actually uses it for.
    const seeds = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions);
    expect(seeds.find((q) => q.label === "Age range")).toBeDefined();
    const dob = seeds.find((q) => /date of birth/i.test(q.label));
    expect(dob).toBeUndefined();
    // Belt and braces: nothing in the set collects a bare date.
    const dateSeeds = seeds.filter((q) => q.responseType === "date");
    expect(dateSeeds).toEqual([]);
  });

  it("publishes only the indicators that can lawfully be published", async () => {
    // Every published question needs a decline offered, or the consent
    // floor refuses it. If the seed ever adds an indicator without one,
    // seeding throws — and a community that couldn't log in because its
    // starter set was malformed would be a spectacular own goal.
    const { alice } = await seeded();
    const rows = await db
      .select({
        label: profileQuestion.label,
        published: profileQuestion.publishedAsIndicator,
        declinable: profileQuestion.allowPreferNotToSay,
      })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    const published = rows.filter((r) => r.published);
    expect(published.length).toBeGreaterThan(0);
    for (const row of published) {
      expect(row.declinable).toBe(true);
    }
    // And the restricted ones are never published, since sensitive and
    // published contradict each other.
    const allergies = rows.find((r) => r.label === "Allergies");
    expect(allergies?.published).toBe(false);
  });

  it("gives every restricted question a real audience, not an empty one", async () => {
    // The whole reason `sensitive` is refused without a rule. A restricted
    // question seeded with no rule would be restricted to *nobody*, which
    // is indistinguishable from broken.
    const { alice, created } = await seeded();
    const rules = await listSensitiveFieldAccessRules(alice);
    const ruledIds = new Set(rules.map((r) => r.questionId));
    const sensitive = created.filter((c) => c.sensitive);
    expect(sensitive.length).toBeGreaterThan(0);
    for (const q of sensitive) {
      expect(ruledIds.has(q.id)).toBe(true);
    }
  });

  it("restricts a seeded answer to the kitchen grant, in both directions", async () => {
    // The permission actually *working*, not just the flag being set — a
    // seeded allergy is the case that matters, since it's the one a
    // community would most notice leaking. Alice is the owner here, so
    // she can always read her own; the questions are what a third party
    // can reach.
    const { alice, c, created } = await seeded();
    const allergies = created.find((q) => q.label === "Allergies")!;
    const bob = await addMember(c.id, "Bob");

    // Nobody in this community holds the kitchen grant, so nothing reads.
    const asBob = await resolveReadableQuestions(bob, alice.id, [
      { questionId: allergies.id, sensitive: true, shareWithAudience: true },
    ]);
    expect(asBob.size).toBe(0);

    // Alice can always read her own, restricted or not.
    const asAlice = await resolveReadableQuestions(alice, alice.id, [
      { questionId: allergies.id, sensitive: true, shareWithAudience: true },
    ]);
    expect(asAlice.has(allergies.id)).toBe(true);
  });

  it("doesn't seed the four fixed sensitive member columns as questions", async () => {
    // Those already exist as `member` columns under the sensitive_data
    // module. Seeding them as questions too would leave a community with
    // two places to record an allergy and one place to read it — the kind
    // of split that loses an allergy.
    const { alice } = await seeded();
    const labels = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions.map((q) => q.label));
    expect(labels).not.toContain("Emergency contact");
    expect(labels).not.toContain("Orientation");
    // …and the table isn't the only place to check — a column that got
    // seeded by some other route would still be the bug this is about.
    const rows = await db
      .select({ label: profileQuestion.label })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(rows.map((r) => r.label)).not.toContain("Emergency contact");
    expect(rows.map((r) => r.label)).not.toContain("Orientation");
    // Health conditions and allergies ARE seeded — as questions, with an
    // audience — because the doc proposes them alongside the columns and a
    // community choosing questions over columns should get a working
    // version. The duplication the note warns about is avoided by *not*
    // also creating a column, which is out of scope for a seed.
    expect(labels).toContain("Allergies");
  });

  it("never seeds a choice question without options, and never invents a list", async () => {
    // Two halves of one rule. A choice question with no options is
    // refused, and rightly — it renders as an empty list plus a text box.
    // But the alternative, seeding a *guessed* list, is worse: the
    // community would have to remove the wrong answers rather than add
    // the right ones. So "languages you speak" seeds as text, and
    // changing it to a pick-any is the edit that requires the community's
    // own list.
    const seeds = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions);
    for (const q of seeds) {
      if (q.responseType === "single_choice" || q.responseType === "multi_choice") {
        expect((q.options?.length ?? 0) + (q.allowOther ? 1 : 0)).toBeGreaterThan(0);
      }
    }
    const languages = seeds.find((q) => q.label === "Languages you speak")!;
    expect(languages.options).toBeUndefined();
    expect(["text", "single_choice", "multi_choice"]).toContain(languages.responseType);
  });

  it("does nothing on a second run, rather than duplicating every question", async () => {
    // The one property that makes this safe to call from a login path.
    const { alice } = await seeded();
    const before = await db
      .select({ id: profileQuestion.id })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    const rulesBefore = await db.select().from(sensitiveFieldAccessRule);

    expect(await maybeSeedDefaultProfileQuestions(alice)).toBeNull();
    expect(await hasProfileQuestions(alice.communityId)).toBe(true);

    const after = await db
      .select({ id: profileQuestion.id })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(after).toHaveLength(before.length);
    expect(await db.select().from(sensitiveFieldAccessRule)).toHaveLength(rulesBefore.length);
  });

  it("seeds once for a community with no questions, and returns what it made", async () => {
    const { alice } = await createFixtures();
    expect(await hasProfileQuestions(alice.communityId)).toBe(false);
    const created = await maybeSeedDefaultProfileQuestions(alice);
    expect(created?.length).toBeGreaterThan(0);
    expect(await hasProfileQuestions(alice.communityId)).toBe(true);
  });

  it("refuses to re-seed a community that added a question of its own", async () => {
    // "Has any questions", not "matches the table" — a community that
    // added one by hand has decided what its questions are.
    const { alice } = await createFixtures();
    await db.insert(profileQuestion).values({
      communityId: alice.communityId,
      label: "Bike you can ride",
      responseType: "text",
      scope: "once_ever",
    });
    expect(await maybeSeedDefaultProfileQuestions(alice)).toBeNull();
    const rows = await db
      .select({ label: profileQuestion.label })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(rows).toHaveLength(1);
  });

  it("leaves every seeded question editable rather than baked in", async () => {
    // Category membership is fixed at creation by design, but nothing
    // about a seeded question is special afterwards — the point of
    // seeding is that the community takes ownership of the set.
    const { alice, created } = await seeded();
    const pronouns = created.find((c) => c.label === "Your pronouns")!;
    const [row] = await db
      .select()
      .from(profileQuestion)
      .where(and(eq(profileQuestion.id, pronouns.id), eq(profileQuestion.communityId, alice.communityId)));
    expect(row.label).toBe("Your pronouns");
    // Not archived, not locked, no marker column distinguishing it.
    expect(row.archivedAt).toBeNull();
  });
});

// The review step in Settings. This is the path the seeder was unreachable
// from before, and the reason the sensitive-question feature had no UI at
// all: `sensitive` is refused until a rule exists, and a rule needs the
// question to exist, so the two have to happen in one action. Everything
// here is about that one submission.
describe("reviewing the starter set before adding it", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seededWith(choices: DefaultQuestionChoices) {
    const { alice, community: c } = await createFixtures();
    const created = await seedDefaultProfileQuestions(alice, choices);
    return { alice, c, created };
  }

  const everyKey = DEFAULT_QUESTION_KEYS;

  it("adds only the rows the admin kept, and nothing else", async () => {
    // The reason the review step exists. One button used to add the whole
    // table, and the only remedy afterwards was archiving each row — for
    // questions no member could have answered yet, since a community with
    // no questions has no members.
    const { alice, created } = await seededWith({
      pronouns: { include: true, audience: null },
      allergies: { include: true, audience: { unlockedByGrantModuleKey: "kitchen" } },
      vehicle: { include: false, audience: null },
    });
    expect(created.map((c) => c.key).sort()).toEqual(["allergies", "pronouns"]);

    const rows = await db
      .select({ label: profileQuestion.label })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(rows.map((r) => r.label).sort()).toEqual(["Allergies", "Your pronouns"]);
  });

  it("adds the whole table when the admin keeps everything", async () => {
    const { created } = await seededWith(
      Object.fromEntries(everyKey.map((k) => [k, { include: true, audience: null }])),
    );
    expect(created).toHaveLength(everyKey.length);
  });

  it("adds nothing at all when the admin unticks everything", async () => {
    // A legitimate answer: the create form below is right there, and an
    // empty set is a real starting point rather than a failure to seed.
    // Distinct from sending no choices at all, which is the unattended
    // signup path and takes the table's own suggestions.
    const { alice, created } = await seededWith(
      Object.fromEntries(everyKey.map((k) => [k, { include: false, audience: null }])),
    );
    expect(created).toEqual([]);
    expect(await hasProfileQuestions(alice.communityId)).toBe(false);
    // …and the review step is still there afterwards, because "no
    // questions" is exactly the state it appears in.
  });

  it("treats a submitted set as the whole answer, not as edits to it", async () => {
    // The safety property, and the reason `choices` is documented as
    // authoritative. If an unmentioned key defaulted to "seed it anyway",
    // a review form that failed to render one row — or a caller that
    // forgot one — would silently add a question the admin had removed.
    // Which is the bug the review step was added to fix, reappearing in
    // its own fix.
    const { created } = await seededWith({ pronouns: { include: true, audience: null } });
    expect(created.map((c) => c.key)).toEqual(["pronouns"]);
  });

  it("still takes the whole table when no choices are submitted at all", async () => {
    // The unattended signup path. It has to produce the same set the
    // review step does, or a community's questions would depend on whether
    // its first member arrived by magic link or an admin clicked a button.
    const { alice } = await createFixtures();
    const created = await seedDefaultProfileQuestions(alice);
    expect(created).toHaveLength(everyKey.length);
    // Every Restricted row arrives restricted, and nothing else does.
    const restrictedKeys = new Set(
      DEFAULT_PROFILE_QUESTION_GROUPS.find((g) => g.title === "Restricted")!.questions.map((q) => q.key),
    );
    for (const row of created) {
      expect(row.sensitive).toBe(restrictedKeys.has(row.key));
    }
  });

  it("keeps a retitled label, and falls back when the title is cleared", async () => {
    const { created } = await seededWith({
      pronouns: { include: true, label: "What should we call you?", audience: null },
      age_range: { include: true, label: "   ", audience: null },
    });
    const byKey = new Map(created.map((c) => [c.key, c.label]));
    expect(byKey.get("pronouns")).toBe("What should we call you?");
    // A blank title creates a nameless question, which every list renders
    // as an unclickable row — so it falls back to the suggestion.
    expect(byKey.get("age_range")).toBe("Age range");
  });

  it("attaches the audience the admin picked, and only marks the question sensitive when it did", async () => {
    // The two halves of the one decision. A row with an audience and no
    // sensitive flag is a staged rule that restricts nothing; a row with
    // the flag and no audience is refused outright. So the flag and the
    // audience have to move together, and this is the only place they can.
    const { alice, created } = await seededWith({
      allergies: {
        include: true,
        audience: { unlockedByGrantModuleKey: "kitchen" },
      },
      // Suggested restricted, but the admin said this one is public.
      home_city: { include: true, audience: null },
      vehicle: { include: true, audience: { unlockedByGrantModuleKey: "admin" } },
    });

    const rules = await listSensitiveFieldAccessRules(alice);
    const byQuestion = new Map(
      rules.filter((r) => r.questionId).map((r) => [r.questionId!, r]),
    );
    const byKey = new Map(created.map((c) => [c.key, c]));

    const allergies = byKey.get("allergies")!;
    expect(allergies.sensitive).toBe(true);
    expect(byQuestion.get(allergies.id)?.unlockedByGrantModuleKey).toBe("kitchen");

    // The suggested audience is a suggestion, and dropping it is allowed —
    // the question then arrives readable by the whole community, which is
    // what the admin asked for.
    const homeCity = byKey.get("home_city")!;
    expect(homeCity.sensitive).toBe(false);
    expect(byQuestion.has(homeCity.id)).toBe(false);

    // Restricted with a non-suggested audience: a menu, not a table.
    const vehicle = byKey.get("vehicle")!;
    expect(vehicle.sensitive).toBe(true);
    expect(byQuestion.get(vehicle.id)?.unlockedByGrantModuleKey).toBe("admin");
  });

  it("accepts the tier and task routes, not just permission grants", async () => {
    // The review picker offers all three because the access-rule form has
    // all three, and a starter set that could only pick a permission would
    // be narrower than the setting it is configuring. Real fixtures,
    // because the write side refuses a rule naming a task or tier that
    // isn't in the community — which is the point, and worth holding onto.
    const { alice, community, branch } = await createFixtures();
    const aTier = await db.insert(tier).values({ communityId: community.id, name: "Kitchen" }).returning();
    const aTask = await insertTask(community.id, branch.id, alice.id, { title: "Cooks" });

    const created = await seedDefaultProfileQuestions(alice, {
      allergies: { include: true, audience: { unlockedByTierId: aTier[0].id } },
      vehicle: { include: true, audience: { unlockedByTaskId: aTask.id } },
    });

    const rules = await listSensitiveFieldAccessRules(alice);
    const byQuestion = new Map(rules.filter((r) => r.questionId).map((r) => [r.questionId!, r]));
    const allergies = created.find((c) => c.key === "allergies")!;
    expect(byQuestion.get(allergies.id)?.unlockedByTierId).toBe(aTier[0].id);
    const vehicle = created.find((c) => c.key === "vehicle")!;
    expect(byQuestion.get(vehicle.id)?.unlockedByTaskId).toBe(aTask.id);
  });

  it("refuses a restricted question whose audience names nothing, and adds nothing", async () => {
    // Restricted to an empty audience is the one state that means "nobody
    // but the owner" while the admin believed they had chosen an audience.
    // Refused at the review step, with the label in the message, because
    // the alternative is a question that silently disappears for everyone.
    //
    // "Adds nothing" is half the assertion. The seeder isn't transactional,
    // so a refusal raised mid-loop would leave the rows already created
    // committed — and since `hasProfileQuestions` is what closes the review
    // step, that would strand the community on an arbitrary prefix of the
    // set with no way to get the rest. Hence the up-front preflight.
    const { alice, community } = await createFixtures();
    await expect(
      seedDefaultProfileQuestions(alice, {
        allergies: { include: true, audience: { unlockedByGrantModuleKey: null } },
      }),
    ).rejects.toThrow(/Allergies/);
    expect(await hasProfileQuestions(community.id)).toBe(false);
  });

  it("refuses an audience naming two unlock routes at once, and adds nothing", async () => {
    const { alice, community } = await createFixtures();
    await expect(
      seedDefaultProfileQuestions(alice, {
        allergies: {
          include: true,
          audience: { unlockedByGrantModuleKey: "kitchen", unlockedByTierId: "00000000-0000-0000-0000-000000000001" },
        },
      }),
    ).rejects.toThrow(/Allergies/);
    expect(await hasProfileQuestions(community.id)).toBe(false);
  });

  it("refuses a key the table no longer has, rather than quietly dropping it", async () => {
    // A review form left open across a deploy. Silently ignoring the stale
    // row would leave an admin who ticked a box looking at a question that
    // never arrived, which is the failure this whole step is meant to
    // remove.
    const { alice, community } = await createFixtures();
    await expect(
      seedDefaultProfileQuestions(alice, {
        something_removed_in_a_later_commit: { include: true, audience: null },
      }),
    ).rejects.toThrow(/no question called/);
    expect(await hasProfileQuestions(community.id)).toBe(false);
  });

  it("reports every problem in one refusal, rather than one per attempt", async () => {
    // An admin who has got two rows wrong should be told both, not asked to
    // resubmit, fix the first, and discover the second.
    const { alice } = await createFixtures();
    const attempt = seedDefaultProfileQuestions(alice, {
      allergies: { include: true, audience: { unlockedByGrantModuleKey: null } },
      home_city: { include: true, audience: {} },
    });
    await expect(attempt).rejects.toThrow(/Allergies/);
    await expect(attempt).rejects.toThrow(/Home city or town/);
  });

  it("still refuses a second run, so the review step can't double the set", async () => {
    const { alice, community } = await createFixtures();
    await seedDefaultProfileQuestions(alice, {
      pronouns: { include: true, audience: null },
    });
    const second = await maybeSeedDefaultProfileQuestions(alice);
    expect(second).toBeNull();
    const rows = await db
      .select({ label: profileQuestion.label })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, community.id));
    expect(rows).toHaveLength(1);
  });
});

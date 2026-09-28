import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as memberTable, profileQuestion, sensitiveFieldAccessRule, tier } from "@/db/schema";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  DEFAULT_QUESTION_KEYS,
  hasProfileQuestions,
  maybeSeedDefaultProfileQuestions,
  parseStarterSetChoices,
  seedDefaultProfileQuestions,
  starterChoiceField,
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

  it("creates every question the table can honestly seed, in the table's order", async () => {
    const { created } = await seeded();
    const expected = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) =>
      g.questions.filter((q) => !q.needsChosenAudience).map((q) => q.label),
    );
    expect(created.map((c) => c.label)).toEqual(expected);
    // Everything the table can name an audience for, and nothing else.
    // The emergency contact is the one omission, and it is the point: the
    // unattended path has nobody to ask, and picking a group for it would
    // be the platform deciding who sees somebody's emergency contact.
    expect(created.map((c) => c.label)).not.toContain("Emergency contact");
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
    }
    // Unattended, nothing seeded is emergency-accessible — the one row
    // that would be is skipped, because it needs an audience and there is
    // nobody here to name one. The shape of that row is asserted in the
    // review-path test below.
    expect(rows.filter((r) => r.emergencyAccess)).toHaveLength(0);
  });

  it("still seeds the emergency contact when the review step names an audience", async () => {
    // The review path has a human, so the row the unattended path skips
    // arrives here — restricted, emergency-reachable, and restricted to
    // the group the Admin actually picked.
    const { alice, community } = await createFixtures();
    const created = await seedDefaultProfileQuestions(alice, {
      emergency_contact: {
        include: true,
        label: "Emergency contact",
        restricted: true,
        audience: { unlockedByGrantModuleKey: "kitchen" },
        emergencyAccess: true,
      },
    });
    const contact = created.find((c: { label: string }) => c.label === "Emergency contact");
    expect(contact).toBeTruthy();
    // Restricted, and emergency-reachable, because an emergency override
    // with no restriction to override would log a read of public data as
    // though it had been protected.
    expect(contact!.sensitive).toBe(true);
    expect(contact!.emergencyAccess).toBe(true);
    const rules = await listSensitiveFieldAccessRules(alice);
    expect(rules.some((r) => r.questionId === contact!.id)).toBe(true);
    // …and it is not on offer a second time.
    expect(created.filter((c) => c.label === "Emergency contact")).toHaveLength(1);
    void community;
  });

  it("gives every restricted question it seeds a real audience", async () => {
    // A restricted question is restricted *by* its audience, so there is no
    // longer a third "nobody but the owner" state to distinguish — the
    // write side refuses the pair, and a question in that state cannot be
    // created at all. Every seeded restricted row therefore has a rule.
    const { alice, community } = await createFixtures();
    await seedDefaultProfileQuestions(alice);
    const rules = await listSensitiveFieldAccessRules(alice);
    const ruledIds = new Set(rules.map((r) => r.questionId));
    const rows = await db
      .select({ label: profileQuestion.label, sensitive: profileQuestion.sensitive, id: profileQuestion.id })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, community.id));
    const byLabel = new Map(rows.map((r) => [r.label, r]));

    for (const label of [
      "Allergies",
      "Anything that would affect what you can take on",
      "Home city or town",
      "Full legal name",
    ]) {
      const row = byLabel.get(label)!;
      expect(row.sensitive).toBe(true);
      expect(ruledIds.has(row.id)).toBe(true);
    }
    for (const label of [
      "Your pronouns",
      "Languages you speak",
      "Age range",
      "Certifications you hold",
      "Do you have a vehicle?",
    ]) {
      expect(byLabel.get(label)!.sensitive).toBe(false);
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

  it("gives every Restricted question a named audience, or asks the Admin for one", async () => {
    // The Restricted group's blurb promises each row arrives restricted.
    // Two rows didn't — they seeded world-readable while the group said
    // the opposite, which is the same failure as a typo'd permission key:
    // invisible in review, live in production.
    //
    // A restricted question with no audience isn't a third option
    // any more: the write side refuses the pair, so a row in that state
    // couldn't be created at all. The emergency contact is therefore the
    // one row that carries no module key and instead asks — because none
    // of the permission modules means "responds to emergencies", and
    // picking one would be the platform making a privacy decision for the
    // Community. It takes the audience from the review form, and the
    // unattended signup path skips it.
    const restricted = DEFAULT_PROFILE_QUESTION_GROUPS.find((g) => g.title === "Restricted")!;
    for (const seed of restricted.questions) {
      expect(Boolean(seed.accessRuleModuleKey) || Boolean(seed.needsChosenAudience)).toBe(true);
      // Never both: a pre-selected audience is the thing the flag exists
      // to avoid.
      expect(Boolean(seed.accessRuleModuleKey) && Boolean(seed.needsChosenAudience)).toBe(false);
    }
    // Exactly one row needs a human, and it is the one whose audience the
    // platform has no business choosing.
    expect(
      restricted.questions.filter((s) => s.needsChosenAudience).map((s) => s.key),
    ).toEqual(["emergency_contact"]);

    // …and the table-level guard is a real guard, not a comment. Every
    // restricted row that was actually seeded has a rule, because the
    // unattended path seeds only the rows whose audience the table can
    // honestly name.
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
      if (!isRestricted) continue;
      expect(ruledIds.has(row.id)).toBe(true);
    }
    // The emergency contact is simply absent from an unattended seed,
    // rather than present with a guessed audience or absent-but-listed.
    expect(created.map((r) => r.label)).not.toContain("Emergency contact");
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

  it("gives every restricted question it seeds a real audience", async () => {
    // A restricted question is restricted *by* its audience, so one with
    // no rule cannot be created at all — the "deliberately ruleless"
    // assertion this used to make is now impossible to write, which is
    // the stronger of the two statements. The emergency contact instead
    // asks for its audience in the review form and is skipped outright on
    // the unattended path.
    const { alice, created } = await seeded();
    const rules = await listSensitiveFieldAccessRules(alice);
    const ruledIds = new Set(rules.map((r) => r.questionId));
    const sensitive = created.filter((c) => c.sensitive);
    expect(sensitive.length).toBeGreaterThan(0);
    // Not a count, a name: a second restricted question arriving without
    // a rule would read as the bug it would be rather than sliding past
    // an assertion on the total.
    expect(sensitive.filter((q) => !ruledIds.has(q.id)).map((q) => q.label)).toEqual([]);
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

  it("leaves no second place to record the same thing", async () => {
    // This test used to assert the four fixed `member` columns were NOT
    // seeded as questions, on the grounds that seeding both would leave a
    // community with two places to record an allergy and one place to read
    // it. Those columns no longer exist (migration 0080) — the questions
    // won — so the duplication is gone and the assertion inverts: what
    // matters now is that nothing is recorded twice, which is a statement
    // about there being only one mechanism rather than about which labels
    // appear.
    const { alice } = await seeded();
    const labels = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions.map((q) => q.label));
    // The two that used to be columns and are now questions — the
    // resolution the whole collapse was for.
    expect(labels).toContain("Allergies");
    expect(labels).toContain("Emergency contact");
    // `orientation` was never a question and never will be; there is no
    // mechanism behind the word any more.
    expect(labels).not.toContain("Orientation");
    // No label appears twice, which is the property that actually matters.
    expect(new Set(labels).size).toBe(labels.length);
    const rows = await db
      .select({ label: profileQuestion.label })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    expect(new Set(rows.map((r) => r.label)).size).toBe(rows.length);
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

// The FormData the review form actually submits.
//
// This exists because the form and its parser disagreed once, silently and
// completely: the form emitted `choice.<key>.<field>` while the parser
// called `formData.getAll("choice")`, which matches a name exactly and so
// matched nothing. The submission created zero questions and reported no
// error, because an empty choices object legitimately means "the admin
// kept nothing" — and a suite calling the seeder directly with a built
// object could not see it. A browser found it by clicking the button.
//
// So the field names come from `starterChoiceField`, the same function the
// form uses, and the shape is built here rather than handed to the parser
// as a ready-made object. That is the only arrangement in which this test
// fails when the form and the parser drift apart.
describe("reading the review step's submission", () => {
  /** What the form renders for one row, as FormData. */
  function choiceFields(fd: FormData, key: string, fields: Record<string, string>) {
    for (const [field, value] of Object.entries(fields)) {
      fd.append(starterChoiceField(key, field), value);
    }
    return fd;
  }

  it("finds every choice group, including ones with an empty value", () => {
    const fd = new FormData();
    // The real names, and a couple of the real values — including the
    // excluded row, whose every field is "" rather than absent.
    choiceFields(fd, "pronouns", { include: "on", label: "Your pronouns", restricted: "", route: "none" });
    // A restricted question with no route is refused, so the emergency
    // contact only reaches the seeder once the review form has named a
    // group for it — which is the point of asking.
    choiceFields(fd, "emergency_contact", {
      include: "on",
      label: "Emergency contact",
      restricted: "on",
      route: "grant",
      grantModuleKey: "kitchen",
      emergencyAccess: "on",
    });
    choiceFields(fd, "vehicle", { include: "", label: "Do you have a vehicle?", restricted: "", route: "none" });

    const choices = parseStarterSetChoices(fd);
    expect(Object.keys(choices).sort()).toEqual(["emergency_contact", "pronouns", "vehicle"]);
    expect(choices.pronouns).toEqual({
      include: true,
      restricted: false,
      audience: null,
      label: "Your pronouns",
      emergencyAccess: false,
    });
    // Restricted, with the group the review form asked for.
    expect(choices.emergency_contact.restricted).toBe(true);
    expect(choices.emergency_contact.audience).toEqual({ unlockedByGrantModuleKey: "kitchen" });
    expect(choices.emergency_contact.emergencyAccess).toBe(true);
    // An excluded row still carries its own decision; the seeder is what
    // skips it, so "excluded" is distinguishable from "not mentioned".
    expect(choices.vehicle.include).toBe(false);
  });

  it("reads all three unlock routes", () => {
    const fd = new FormData();
    choiceFields(fd, "a", { include: "on", restricted: "on", route: "grant", grantModuleKey: "kitchen" });
    choiceFields(fd, "b", { include: "on", restricted: "on", route: "tier", tierId: "tier-1" });
    choiceFields(fd, "c", { include: "on", restricted: "on", route: "task", taskId: "task-1" });
    const choices = parseStarterSetChoices(fd);
    expect(choices.a.audience).toEqual({ unlockedByGrantModuleKey: "kitchen" });
    expect(choices.b.audience).toEqual({ unlockedByTierId: "tier-1" });
    expect(choices.c.audience).toEqual({ unlockedByTaskId: "task-1" });
  });

  it("never pairs an audience with a question that isn't restricted", () => {
    // A route on an unrestricted question is not a narrower rule, it's a
    // meaningless one — the question is readable by everyone whatever the
    // rules say.
    const fd = new FormData();
    choiceFields(fd, "a", { include: "on", restricted: "", route: "grant", grantModuleKey: "kitchen" });
    expect(parseStarterSetChoices(fd).a.audience).toBeNull();
  });

  it("drops emergency access when the question isn't restricted", () => {
    // An emergency override with no restriction to override would log a
    // read of public data as though it had been protected.
    const fd = new FormData();
    choiceFields(fd, "a", { include: "on", restricted: "", route: "none", emergencyAccess: "on" });
    expect(parseStarterSetChoices(fd).a.emergencyAccess).toBe(false);
  });

  it("treats an unrecognised route as owner-only, not as public", () => {
    // The safe direction on a malformed submission: for a restricted
    // question, a null audience resolves to nobody but the owner. Reading
    // an unknown route as "no audience, therefore public" would invert that
    // and publish a question its admin meant to protect.
    const fd = new FormData();
    choiceFields(fd, "a", { include: "on", restricted: "on", route: "nonsense" });
    const choice = parseStarterSetChoices(fd).a;
    expect(choice.restricted).toBe(true);
    expect(choice.audience).toBeNull();
  });

  it("ignores fields that aren't ours, and keys with the wrong shape", () => {
    const fd = new FormData();
    fd.append("label", "not ours");
    fd.append("choice", "a bare prefix with no key or field");
    fd.append("choice.a.b.c", "too many parts");
    choiceFields(fd, "a", { include: "on" });
    const choices = parseStarterSetChoices(fd);
    expect(Object.keys(choices)).toEqual(["a"]);
    expect(choices.a.include).toBe(true);
  });

  it("produces a submission the seeder acts on, end to end", async () => {
    // The whole point: form-shaped input in, questions out. A parser test
    // alone would have passed while the real form did nothing, because the
    // gap was between the two — so this closes the loop through the same
    // door the browser uses.
    const { alice, community } = await createFixtures();
    const fd = new FormData();
    choiceFields(fd, "pronouns", {
      include: "on",
      label: "Your pronouns",
      restricted: "",
      route: "none",
    });
    choiceFields(fd, "allergies", {
      include: "on",
      label: "Allergies",
      restricted: "on",
      route: "grant",
      grantModuleKey: "kitchen",
    });
    // A restricted question with no route is refused, so the emergency
    // contact only reaches the seeder once the review form has named a
    // group for it — which is the point of asking.
    choiceFields(fd, "emergency_contact", {
      include: "on",
      label: "Emergency contact",
      restricted: "on",
      route: "grant",
      grantModuleKey: "kitchen",
      emergencyAccess: "on",
    });
    choiceFields(fd, "vehicle", { include: "", label: "Do you have a vehicle?", restricted: "" });

    const created = await seedDefaultProfileQuestions(alice, parseStarterSetChoices(fd));
    expect(created.map((c) => c.key).sort()).toEqual([
      "allergies",
      "emergency_contact",
      "pronouns",
    ]);

    const rows = await db
      .select({ label: profileQuestion.label, id: profileQuestion.id, em: profileQuestion.emergencyAccess })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, community.id));
    const byLabel = new Map(rows.map((r) => [r.label, r]));
    expect(byLabel.get("Emergency contact")!.em).toBe(true);
    // The excluded row is genuinely absent, rather than created and then
    // archived — the whole reason the review step exists.
    expect(byLabel.has("Do you have a vehicle?")).toBe(false);
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
      pronouns: { include: true, restricted: false, audience: null },
      allergies: { include: true, restricted: true, audience: { unlockedByGrantModuleKey: "kitchen" } },
      vehicle: { include: false, restricted: false, audience: null },
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
      Object.fromEntries(everyKey.map((k) => [k, { include: true, restricted: false, audience: null }])),
    );
    expect(created).toHaveLength(everyKey.length);
  });

  it("adds nothing at all when the admin unticks everything", async () => {
    // A legitimate answer: the create form below is right there, and an
    // empty set is a real starting point rather than a failure to seed.
    // Distinct from sending no choices at all, which is the unattended
    // signup path and takes the table's own suggestions.
    const { alice, created } = await seededWith(
      Object.fromEntries(everyKey.map((k) => [k, { include: false, restricted: false, audience: null }])),
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
    const { created } = await seededWith({ pronouns: { include: true, restricted: false, audience: null } });
    expect(created.map((c) => c.key)).toEqual(["pronouns"]);
  });

  it("still takes the whole table when no choices are submitted at all", async () => {
    // The unattended signup path. It has to produce the same set the
    // review step does — or a community's questions would depend on
    // whether its first member arrived by magic link or an admin clicked
    // a button. The single difference is omission, not guesswork: the
    // emergency contact is the one row whose audience the platform is not
    // allowed to choose, so it is left for the review step or for the
    // Admin to add by hand.
    const { alice } = await createFixtures();
    const created = await seedDefaultProfileQuestions(alice);
    const seedableKeys = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) =>
      g.questions.filter((q) => !q.needsChosenAudience).map((q) => q.key),
    );
    expect(created).toHaveLength(seedableKeys.length);
    expect(created.map((c) => c.key).sort()).toEqual(seedableKeys.slice().sort());
    // Every Restricted row that was seeded arrives restricted, and nothing
    // else does.
    const restrictedKeys = new Set(
      DEFAULT_PROFILE_QUESTION_GROUPS.find((g) => g.title === "Restricted")!.questions
        .filter((q) => !q.needsChosenAudience)
        .map((q) => q.key),
    );
    for (const row of created) {
      expect(row.sensitive).toBe(restrictedKeys.has(row.key));
    }
  });

  it("keeps a retitled label, and falls back when the title is cleared", async () => {
    const { created } = await seededWith({
      pronouns: { include: true, label: "What should we call you?", restricted: false, audience: null },
      age_range: { include: true, label: "   ", restricted: false, audience: null },
    });
    const byKey = new Map(created.map((c) => [c.key, c.label]));
    expect(byKey.get("pronouns")).toBe("What should we call you?");
    // A blank title creates a nameless question, which every list renders
    // as an unclickable row — so it falls back to the suggestion.
    expect(byKey.get("age_range")).toBe("Age range");
  });

  it("attaches the audience the admin picked, and only marks the question sensitive when it did", async () => {
    // The two halves of the one decision. Restricted-with-an-audience is
    // the ordinary case; restricted-without-one is the owner-and-emergency
    // state; and neither is the same as public, which is a third thing and
    // not a lesser version of the first. All three are reachable here.
    const { alice, created } = await seededWith({
      allergies: {
        include: true,
        restricted: true,
        audience: { unlockedByGrantModuleKey: "kitchen" },
      },
      // Suggested restricted, but the admin said this one is public.
      home_city: { include: true, restricted: false, audience: null },
      vehicle: { include: true, restricted: true, audience: { unlockedByGrantModuleKey: "admin" } },
      // Restricted, with the audience the Admin named — there is no
      // "restricted to nobody" option any more, because a sensitive
      // question is restricted *by* its audience.
      emergency_contact: {
        include: true,
        restricted: true,
        audience: { unlockedByGrantModuleKey: "admin" },
        emergencyAccess: true,
      },
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

    // Restricted with emergency access on: an override of a real
    // restriction, which is what makes it one.
    const emergencyContact = byKey.get("emergency_contact")!;
    expect(emergencyContact.sensitive).toBe(true);
    expect(emergencyContact.emergencyAccess).toBe(true);
    expect(byQuestion.get(emergencyContact.id)?.unlockedByGrantModuleKey).toBe("admin");
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
      allergies: { include: true, restricted: true, audience: { unlockedByTierId: aTier[0].id } },
      vehicle: { include: true, restricted: true, audience: { unlockedByTaskId: aTask.id } },
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
        allergies: { include: true, restricted: true, audience: { unlockedByGrantModuleKey: null } },
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
          restricted: true,
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
        something_removed_in_a_later_commit: { include: true, restricted: false, audience: null },
      }),
    ).rejects.toThrow(/no question called/);
    expect(await hasProfileQuestions(community.id)).toBe(false);
  });

  it("reports every problem in one refusal, rather than one per attempt", async () => {
    // An admin who has got two rows wrong should be told both, not asked to
    // resubmit, fix the first, and discover the second.
    const { alice } = await createFixtures();
    const attempt = seedDefaultProfileQuestions(alice, {
      allergies: { include: true, restricted: true, audience: { unlockedByGrantModuleKey: null } },
      home_city: { include: true, restricted: true, audience: {} },
    });
    await expect(attempt).rejects.toThrow(/Allergies/);
    await expect(attempt).rejects.toThrow(/Home city or town/);
  });

  it("still refuses a second run, so the review step can't double the set", async () => {
    const { alice, community } = await createFixtures();
    await seedDefaultProfileQuestions(alice, {
      pronouns: { include: true, restricted: false, audience: null },
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

import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as memberTable, profileQuestion, sensitiveFieldAccessRule } from "@/db/schema";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  hasProfileQuestions,
  maybeSeedDefaultProfileQuestions,
  seedDefaultProfileQuestions,
} from "@/lib/profile-questions/defaults";
import { resolveReadableQuestions } from "@/lib/sensitive-data";
import { listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { createFixtures, resetDatabase } from "./helpers";

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

  it("scopes the event group per-event and everything else once-ever", async () => {
    const { alice } = await seeded();
    const rows = await db
      .select({ label: profileQuestion.label, scope: profileQuestion.scope })
      .from(profileQuestion)
      .where(eq(profileQuestion.communityId, alice.communityId));
    const byLabel = new Map(rows.map((r) => [r.label, r.scope]));
    expect(byLabel.get("Do you need a bed?")).toBe("per_cycle");
    expect(byLabel.get("Dietary needs")).toBe("per_cycle");
    expect(byLabel.get("Your pronouns")).toBe("once_ever");
    expect(byLabel.get("Date of birth")).toBe("once_ever");
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

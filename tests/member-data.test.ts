import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { member as memberTable, profileQuestion, taskAssignment } from "@/db/schema";
import type { member as memberTableType } from "@/db/schema";
import { getMemberData } from "@/lib/member-data";
import {
  deleteSensitiveFieldAccessRule,
  listSensitiveFieldAccessRules,
  resolveReadableAnswersForCommunity,
} from "@/lib/sensitive-data";
import {
  answerProfileQuestion,
  createProfileQuestion,
  updateProfileQuestion,
} from "@/lib/profile-questions";
import { claimTask } from "@/lib/tasks";
import { createFixtures, grantPermission, insertTask, resetDatabase } from "./helpers";

type Member = typeof memberTableType.$inferSelect;

// The roster read, and the two things it gets wrong if it's built from the
// answer map instead of from the flags:
//
//  1. A Community where nobody has answered anything yet must still offer
//     its public questions. Derived from answers, an answer map is empty on
//     day one, so every public column vanishes from the picker and the
//     grid is empty with no way to find out why.
//  2. A sensitive question the viewer isn't in the audience for must be
//     listed as withheld, not silently absent — "you can't see this" and
//     "this doesn't exist" are different messages and only one is true.
describe("the member data grid", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  async function seedQuestions(alice: Member) {
    const publicQ = await createProfileQuestion(alice, {
      label: "Languages you speak",
      responseType: "text",
      scope: "once_ever",
    });
    const sensitiveQ = await createProfileQuestion(alice, {
      label: "Allergies",
      responseType: "text",
      scope: "once_ever",
      sensitive: true,
      audience: { unlockedByGrantModuleKey: "kitchen" },
    });
    // Restricted, then stripped of its audience, so the grid also has to
    // cope with the fail-closed state. Not reachable at creation any
    // more — a sensitive question without an audience is refused there —
    // but reachable by deleting the last rule, so it still has to render.
    const ownerOnlyQ = await createProfileQuestion(alice, {
      label: "Emergency contact",
      responseType: "text",
      scope: "once_ever",
      sensitive: true,
      audience: { unlockedByGrantModuleKey: "kitchen" },
    });
    // By question, not by position — both questions have a rule, so
    // `listSensitiveFieldAccessRules(alice)[0]` is whichever the database
    // felt like returning and the fixture would silently be testing the
    // wrong one.
    const rules = await listSensitiveFieldAccessRules(alice);
    const contactRule = rules.find((r) => r.questionId === ownerOnlyQ.id)!;
    await deleteSensitiveFieldAccessRule(alice, contactRule.id);
    return { publicQ, sensitiveQ, ownerOnlyQ };
  }

  it("offers every public question before anyone has answered one", async () => {
    const { alice } = await createFixtures();
    const { publicQ } = await seedQuestions(alice);

    // Nobody has answered anything: the answer map is empty, and it must not
    // decide what columns exist.
    expect(await resolveReadableAnswersForCommunity(alice)).toEqual(new Map());

    const data = await getMemberData(alice);
    expect(data.columns.map((c) => c.question.label)).toEqual(["Languages you speak"]);
    expect(data.members.map((m) => m.name)).toEqual(["Alice", "Bob"]);
    expect(data.columns[0].entries).toEqual([]);
    expect(data.columns[0].question.id).toBe(publicQ.id);
  });

  it("lists a sensitive question the viewer may read, and withholds one they may not", async () => {
    const { alice, community, branch } = await createFixtures();
    const { sensitiveQ, ownerOnlyQ } = await seedQuestions(alice);

    // Alice holds no kitchen grant, so the kitchen-restricted one is
    // withheld — and the owner-only one is withheld for everyone.
    const asAlice = await getMemberData(alice);
    expect(asAlice.unavailable.map((u) => u.label).sort()).toEqual([
      "Allergies",
      "Emergency contact",
    ]);
    expect(asAlice.columns.some((c) => c.question.id === sensitiveQ.id)).toBe(false);
    expect(asAlice.columns.some((c) => c.question.id === ownerOnlyQ.id)).toBe(false);

    // Give Alice the kitchen grant and the restricted column appears.
    const kitchen = await insertTask(community.id, branch.id, alice.id);
    await grantPermission(community.id, "kitchen", kitchen.id);
    await claimTask(alice, kitchen.id);
    const asKitchen = await getMemberData(alice);
    expect(asKitchen.columns.map((c) => c.question.label)).toContain("Allergies");
    // …but only that one. The owner-only question is still withheld, which
    // is the whole point of having the state.
    expect(asKitchen.unavailable.map((u) => u.label)).toEqual(["Emergency contact"]);
  });

  it("counts answers given in someone's own words, in a row that can actually fill", async () => {
    // The one assertion here that had to be written to fail first. The
    // breakdown used to offer a row labelled "Other" and then only increment
    // rows whose label equalled the stored value — but free text *is* the
    // member's own words and never equals the string "Other", so the chip
    // rendered "Other 0" no matter how many people wrote one. Nothing tested
    // it, because nothing looked at it.
    const { alice, community } = await createFixtures();
    const [bob] = await db
      .insert(memberTable)
      .values({ communityId: community.id, name: "Bob" })
      .returning();
    const q = await createProfileQuestion(alice, {
      label: "What do you need?",
      responseType: "multi_choice",
      scope: "once_ever",
      allowOther: true,
      options: ["bed", "power"],
    });
    // Two people, because a second answer from the same member on the same
    // once-ever question *replaces* the first rather than adding to it.
    await answerProfileQuestion(alice, q.id, { status: "answered", value: ["bed", "a tent pole"] });
    await answerProfileQuestion(bob, q.id, { status: "answered", value: ["bed"] });

    const column = (await getMemberData(alice)).columns.find((c) => c.question.id === q.id)!;
    expect(column.breakdown).toEqual([
      { option: "bed", count: 2 },
      { option: "power", count: 0 },
      { option: "Something else", count: 1 },
    ]);
    // The words themselves are still listed per member underneath — the
    // count is the aggregate, the entries are what an entitled reader came
    // for. Neither replaces the other.
    expect(column.entries.map((e) => e.display).sort()).toEqual(["bed", "bed, a tent pole"]);
  });

  it("offers the catch-all at zero, like every other unpicked option", async () => {
    // This page deliberately shows the *shape* of an answer, so a zero row
    // is information rather than noise. The published indicator omits its
    // own catch-all when empty; the two want different things from the same
    // tally, and this is the difference being pinned.
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "What do you need?",
      responseType: "multi_choice",
      scope: "once_ever",
      allowOther: true,
      options: ["bed"],
    });
    await answerProfileQuestion(alice, q.id, { status: "answered", value: ["bed"] });

    const column = (await getMemberData(alice)).columns.find((c) => c.question.id === q.id)!;
    expect(column.breakdown).toEqual([
      { option: "bed", count: 1 },
      { option: "Something else", count: 0 },
    ]);
  });

  it("counts an answer whose option was removed, rather than dropping it", async () => {
    // The same tally catches this for free, and the label is why: an answer
    // holding a deleted option's text matches no current option, and
    // "Something else" is neutral about the cause where "Other" would have
    // claimed it was free text. It was silently absent from both this report
    // and the indicator before the two were made to share a tally.
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "What do you need?",
      responseType: "multi_choice",
      scope: "once_ever",
      allowOther: true,
      options: ["bed", "generator"],
    });
    await answerProfileQuestion(alice, q.id, { status: "answered", value: ["generator"] });
    await updateProfileQuestion(alice, q.id, { label: "What do you need?", options: ["bed"] });

    const column = (await getMemberData(alice)).columns.find((c) => c.question.id === q.id)!;
    expect(column.breakdown).toEqual([
      { option: "bed", count: 0 },
      { option: "Something else", count: 1 },
    ]);
  });

  it("offers no catch-all at all on a question with no escape hatch", async () => {
    // Where free text is impossible, a value that matches no option is a
    // removed option — and a row implying otherwise would describe a hatch
    // that doesn't exist.
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "What do you need?",
      responseType: "multi_choice",
      scope: "once_ever",
      options: ["bed", "generator"],
    });
    await answerProfileQuestion(alice, q.id, { status: "answered", value: ["generator"] });
    await updateProfileQuestion(alice, q.id, { label: "What do you need?", options: ["bed"] });

    const column = (await getMemberData(alice)).columns.find((c) => c.question.id === q.id)!;
    expect(column.breakdown).toEqual([{ option: "bed", count: 0 }]);
  });

  it("shows another member's public answer, and withholds their restricted one", async () => {
    const { alice, community, branch } = await createFixtures();
    const [bob] = await db
      .insert(memberTable)
      .values({ communityId: community.id, name: "Bob" })
      .returning();
    const { publicQ, sensitiveQ } = await seedQuestions(alice);
    await answerProfileQuestion(alice, publicQ.id, { status: "answered", value: "Welsh" });
    await answerProfileQuestion(alice, sensitiveQ.id, { status: "answered", value: "peanuts" });

    // Alice can't read her own restricted answer via the grid? She can —
    // it's hers. The point is what *Bob* sees, so read as Bob.
    const kitchen = await insertTask(community.id, branch.id, bob.id);
    await grantPermission(community.id, "kitchen", kitchen.id);
    await claimTask(bob, kitchen.id);
    const asBob = await getMemberData(bob);
    const allergies = asBob.columns.find((c) => c.question.label === "Allergies")!;
    expect(allergies.entries.map((e) => e.display)).toEqual(["peanuts"]);

    // Now take the grant away and the column is gone rather than blanked,
    // so there is nothing on the page to reveal by accident. Un-claimed
    // rather than deleted, because a task assignment references it.
    await db
      .delete(taskAssignment)
      .where(and(eq(taskAssignment.taskId, kitchen.id), eq(taskAssignment.memberId, bob.id)));
    const asBobAfter = await getMemberData(bob);
    expect(asBobAfter.unavailable.map((u) => u.label)).toContain("Allergies");
  });

  it("honours an explicit column selection, and cannot be widened by one", async () => {
    const { alice, community, branch } = await createFixtures();
    const { publicQ } = await seedQuestions(alice);
    const other = await createProfileQuestion(alice, {
      label: "Certifications you hold",
      responseType: "text",
      scope: "once_ever",
    });

    const only = await getMemberData(alice, { questionIds: [publicQ.id] });
    expect(only.columns.map((c) => c.question.label)).toEqual(["Languages you speak"]);

    // A selection naming a question the viewer may read is honoured even if
    // they didn't tick it, because a stale bookmark should still work. A
    // selection naming a restricted one cannot add it: the per-row
    // readability check has the last word either way.
    const kitchen = await insertTask(community.id, branch.id, alice.id);
    await grantPermission(community.id, "kitchen", kitchen.id);
    await claimTask(alice, kitchen.id);
    const wid = await getMemberData(alice, { questionIds: [other.id, "00000000-0000-0000-0000-000000000000"] });
    expect(wid.columns.map((c) => c.question.id)).toContain(other.id);
    expect(wid.columns).toHaveLength(1);
  });

  it("filters values, and reports a decline apart from no answer", async () => {
    const { alice, community } = await createFixtures();
    const [bob] = await db
      .insert(memberTable)
      .values({ communityId: community.id, name: "Bob" })
      .returning();
    const { publicQ } = await seedQuestions(alice);
    await answerProfileQuestion(alice, publicQ.id, { status: "answered", value: "Welsh" });
    await answerProfileQuestion(bob, publicQ.id, { status: "answered", value: "Pashto" });

    const all = await getMemberData(alice);
    expect(all.columns[0].entries).toHaveLength(2);
    const filtered = await getMemberData(alice, { filter: "pashto" });
    expect(filtered.columns[0].entries.map((e) => e.display)).toEqual(["Pashto"]);
    const noMatch = await getMemberData(alice, { filter: "klingon" });
    expect(noMatch.columns[0].entries).toEqual([]);
  })

  it("leaves per-event questions out of the roster entirely", async () => {
    const { alice } = await createFixtures();
    await seedQuestions(alice);
    await createProfileQuestion(alice, {
      label: "Do you need a bed?",
      responseType: "boolean",
      scope: "per_cycle",
    });
    const data = await getMemberData(alice);
    expect(data.columns.some((c) => c.question.label === "Do you need a bed?")).toBe(false);
    expect(data.unavailable.some((u) => u.label === "Do you need a bed?")).toBe(false);
  });

  it("omits archived questions from both the grid and the withheld list", async () => {
    const { alice } = await createFixtures();
    const q = await createProfileQuestion(alice, {
      label: "Retired",
      responseType: "text",
      scope: "once_ever",
    });
    await db.update(profileQuestion).set({ archivedAt: new Date() }).where(eq(profileQuestion.id, q.id));
    const data = await getMemberData(alice);
    expect(data.columns.some((c) => c.question.label === "Retired")).toBe(false);
    expect(data.unavailable.some((u) => u.label === "Retired")).toBe(false);
  });
});

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { member, profileAnswer, profileQuestion } from "@/db/schema";
import type { member as memberTable, profileQuestion as profileQuestionTable } from "@/db/schema";
import { CATCH_ALL_LABEL, formatFieldValue, tallyChoiceValues, toFieldShape, type FieldShape } from "./field-shape";
import { listReadableSensitiveQuestionIds, resolveReadableAnswersForCommunity } from "./sensitive-data";
import { getGatingPurposesForQuestions, listMembersWithActiveConsent } from "./consent";

type Member = typeof memberTable.$inferSelect;
type Question = typeof profileQuestionTable.$inferSelect;

export type MemberDataColumn = {
  question: Question;
  shape: FieldShape;
  /** Members with a real, readable answer, in roster order. */
  entries: { memberId: string; memberName: string; display: string }[];
  /** Members who have an answer row that is a deferral or a decline —
   *  reported separately from "hasn't answered" because the two mean
   *  opposite things operationally. A kitchen coordinator reading a
   *  "0 disclosed" count needs to know whether that's because nobody
   *  was asked or because everyone declined. */
  deferredCount: number;
  declinedCount: number;
  /** Total members in the community, so the page can say "3 of 12". */
  population: number;
  /** Non-null only for a choice question: a per-option breakdown, which
   *  is the report a menu planner actually wants ("4 vegan, 2 gluten-free")
   *  rather than a count with the raw values in it. */
  breakdown: { option: string; count: number }[] | null;
};

export type MemberData = {
  members: { id: string; name: string }[];
  columns: MemberDataColumn[];
  /** Every non-archived question, so the column picker can offer the ones
   *  the viewer may not read — greyed and explained, rather than absent,
   *  because "I can't see that column" and "that question doesn't exist"
   *  are very different messages and only one of them is true. */
  unavailable: { id: string; label: string; reason: "restricted" }[];
};

/**
 * Every question the viewer may read `viewer`'s data through — which is to
 * say, for one member at a time, the whole set: non-sensitive questions are
 * readable by the community, and sensitive ones by their audience.
 *
 * The one place this is computed rather than reused, because it answers a
 * question the readability resolver doesn't: *which* questions exist and
 * which of them may be shown. The resolver says which answers of which
 * members are readable; this says which columns are on offer. Both are
 * needed, and deriving one from the other would lose the distinction
 * between "nobody has answered this" and "you may not see this".
 */
export async function getMemberData(
  viewer: Member,
  options: { questionIds?: string[]; filter?: string } = {},
): Promise<MemberData> {
  const members = await db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, viewer.communityId))
    .orderBy(member.name);
  const nameById = new Map(members.map((m) => [m.id, m.name]));

  const questions = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, viewer.communityId),
        isNull(profileQuestion.archivedAt),
        // Standing facts only. A per-event answer belongs to an event, and
        // this page is about the people rather than one weekend of them.
        // The event-scoped questions are at /questions.
        eq(profileQuestion.scope, "once_ever"),
      ),
    );

  const [readable, inAudience] = await Promise.all([
    resolveReadableAnswersForCommunity(viewer),
    listReadableSensitiveQuestionIds(viewer),
  ]);

  // Which columns are on offer, decided from the flags and the viewer's own
  // access rather than from the answers that happen to exist.
  //
  // Deriving it from the answer map instead — which is the obvious way,
  // since that map is already here — is wrong in a way that's invisible
  // until it's very visible: an answer map only contains questions
  // somebody has answered, so a Community where nobody has answered
  // anything yet offers no columns at all. Every public question would be
  // missing from the picker and the grid would be empty with no way to
  // discover why. "You may not see this column" and "nobody has answered
  // this" are different facts and only the first one is about access.
  const onOffer = (question: Question) => !question.sensitive || inAudience.has(question.id);

  const columns: MemberDataColumn[] = [];
  const unavailable: MemberData["unavailable"] = [];
  for (const question of questions) {
    if (!onOffer(question)) {
      unavailable.push({ id: question.id, label: question.label, reason: "restricted" });
      continue;
    }
    columns.push({
      question,
      shape: toFieldShape(question),
      entries: [],
      deferredCount: 0,
      declinedCount: 0,
      population: members.length,
      breakdown: null,
    });
  }

  const columnQuestionIds = columns.map((c) => c.question.id);
  const answers = columnQuestionIds.length
    ? await db
        .select({
          memberId: profileAnswer.memberId,
          questionId: profileAnswer.questionId,
          value: profileAnswer.value,
          status: profileAnswer.status,
        })
        .from(profileAnswer)
        .where(
          and(
            inArray(profileAnswer.questionId, columnQuestionIds),
            isNull(profileAnswer.cycleId),
          ),
        )
    : [];

  // Column selection: an explicit list is the grid's own state and is
  // honoured verbatim, including when it names a question the viewer may
  // read but didn't tick (a stale bookmark) — the readability check below
  // still runs, so that can only ever remove a column, never add one.
  const selectedIds = options.questionIds ? new Set(options.questionIds) : null;
  const needle = options.filter?.trim().toLowerCase() ?? "";

  const byQuestion = new Map<string, MemberDataColumn>();
  // The multi-choice answers behind each column, collected during the pass
  // below and tallied once at the end rather than incremented in place. The
  // tally is `field-shape.ts`'s, shared with the published indicator, because
  // this page and that one aggregate the same answers and had drifted apart:
  // the indicator counted anything unrecognised into a catch-all, while this
  // breakdown offered a row labelled "Other" and only ever incremented rows
  // whose label equalled the stored value — which free text, being the
  // member's own words, never does. That row could only ever read zero.
  const multiChoiceValues = new Map<string, unknown[]>();
  for (const column of columns) {
    if (selectedIds && !selectedIds.has(column.question.id)) continue;
    byQuestion.set(column.question.id, column);
    // Per-column option tallies are the report a menu planner actually came
    // for ("4 vegan, 2 gluten-free") rather than a single number with the
    // raw values sitting next to it. Only a pick-any answer is a set worth
    // counting this way.
    if (column.question.responseType === "multi_choice") {
      multiChoiceValues.set(column.question.id, []);
    }
  }

  for (const answer of answers) {
    const column = byQuestion.get(answer.questionId);
    if (!column) continue;
    // Readability is re-checked per row, not assumed from the column being
    // on offer. A viewer can be in the audience for a question and still
    // be refused a given member's answer, because that member unticked
    // their share box or hasn't consented to the gating purpose.
    const permitted =
      answer.memberId === viewer.id || (readable.get(answer.memberId)?.has(answer.questionId) ?? false);
    if (!permitted) continue;

    if (answer.status === "deferred") {
      column.deferredCount += 1;
      continue;
    }
    if (answer.status === "declined") {
      column.declinedCount += 1;
      continue;
    }

    multiChoiceValues.get(answer.questionId)?.push(answer.value);

    const display = formatFieldValue(answer.value, column.question.responseType);
    if (display === "") continue;
    column.entries.push({
      memberId: answer.memberId,
      memberName: nameById.get(answer.memberId) ?? "—",
      display,
    });
  }

  for (const column of byQuestion.values()) {
    const values = multiChoiceValues.get(column.question.id);
    if (!values) continue;
    const { counts, otherCount } = tallyChoiceValues(values, column.question.options);
    const rows = [...counts].map(([option, count]) => ({ option, count }));
    // Options the community offers but nobody picked are reported as zero,
    // so the shape of the answer is visible rather than inferred from an
    // absent row — and the catch-all is held to the same rule, which is why
    // it appears at zero rather than being hidden when empty. It is offered
    // only where free text is actually possible: on a question with no
    // escape hatch, a value that matches no option is a *removed* option, and
    // a row implying otherwise would describe a hatch that doesn't exist.
    if (column.question.allowOther) rows.push({ option: CATCH_ALL_LABEL, count: otherCount });
    column.breakdown = rows;
  }

  for (const column of byQuestion.values()) {
    // The value filter applies to what a reader is searching for, so it
    // runs after readability and before rendering: filtering by "peanut"
    // must not become a way to learn that somebody answered something.
    column.entries = needle
      ? column.entries.filter((e) => e.display.toLowerCase().includes(needle))
      : column.entries;
  }

  return {
    members,
    columns: [...byQuestion.values()],
    unavailable,
  };
}

/**
 * For each of these questions, the consent purpose gating it and how many
 * members currently hold it.
 *
 * On the page because a gated column looks empty for two very different
 * reasons — nobody has answered, or nobody has agreed to the purpose — and
 * "0 of 12" reads identically in both cases. Naming the second is the
 * difference between a coordinator concluding there's no need and
 * concluding there's a gate they forgot about.
 */
export async function getConsentGaps(communityId: string, questionIds: string[]) {
  const purposes = await getGatingPurposesForQuestions(communityId);
  const out: { questionId: string; purposeLabel: string; consentedCount: number }[] = [];
  for (const questionId of questionIds) {
    const purpose = purposes.get(questionId);
    if (!purpose) continue;
    const granted = await listMembersWithActiveConsent(purpose.id);
    out.push({ questionId, purposeLabel: purpose.label, consentedCount: granted.size });
  }
  return out;
}

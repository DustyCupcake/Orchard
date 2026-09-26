import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  community,
  member,
  participation,
  profileAnswer,
  profileQuestion,
} from "@/db/schema";
import type { member as memberTable, profileQuestion as profileQuestionTable } from "@/db/schema";
import { ConflictError, NotFoundError } from "../errors";
import { toFieldShape } from "../field-shape";
import { formatExactDate } from "../dates/display";

type Member = typeof memberTable.$inferSelect;
type ProfileQuestion = typeof profileQuestionTable.$inferSelect;

/**
 * Community indicators: the aggregate view of a standing question.
 *
 * The point of this module is that *nobody chooses the shape of the
 * display*. A community decides which questions are published; the way
 * each one is shown follows from the field shape it already has, because
 * the alternatives are worse in a specific way each:
 *
 *  - A hand-picked "pie chart" option means someone can put a multi-pick
 *    question in a pie, and a pie of "who picked what" quietly implies
 *    the slices are parts of one whole. They aren't: five people picking
 *    three options each is 15 slices over 5 people. So `multi_choice`
 *    derives *distribution* — per-option counts of how many people chose
 *    it, with no total implied — and can only ever be that.
 *  - A hand-picked "list" option means someone can publish a text field,
 *    and the only honest aggregate of a text field is the members' own
 *    words. So `text` has no family and cannot be published at all.
 *
 * Three families cover every publishable type:
 *
 *   split       — everyone contributes exactly one thing, so the parts
 *                 are shares of one whole and a proportion is meaningful.
 *                 `single_choice`, `boolean`.
 *   distribution— everyone may contribute several things, so each count
 *                 is "how many people chose this", and the counts don't
 *                 sum to the number of people. `multi_choice`.
 *   summary     — the answer is a magnitude or a point on a line, not a
 *                 category, so there's nothing to split and bucketing one
 *                 would invent a histogram the community never asked
 *                 for. `number`, `date`.
 */
export type IndicatorFamily = "split" | "distribution" | "summary";

export const INDICATOR_FAMILY_LABELS: Record<IndicatorFamily, string> = {
  split: "Proportion of members",
  distribution: "How many members chose each",
  summary: "Range across members",
};

/**
 * The one place a field shape becomes a display, and null for a shape
 * that can't be aggregated. Exported (rather than kept private) because
 * the settings editor has to say *why* a checkbox won't work before
 * someone saves, and a rule the UI can only learn by trial is a rule the
 * UI will get wrong.
 */
export function indicatorFamilyFor(responseType: string): IndicatorFamily | null {
  switch (responseType) {
    // Exactly one answer each, so the parts are shares of a whole.
    case "single_choice":
    case "boolean":
      return "split";
    // Several each, so the parts are not shares of anything.
    case "multi_choice":
      return "distribution";
    // A magnitude or a point in time.
    case "number":
    case "date":
      return "summary";
    // Prose. Not aggregable — see the module comment.
    default:
      return null;
  }
}

/**
 * Why a given question can't be published, or null if it can.
 *
 * Returned as a reason and a *remedy* rather than one string, because
 * the two callers need different remedies and stitching them together
 * produces advice that contradicts itself: an admin who edited a
 * published question's answer type was told "change the answer type to
 * pick one, pick any, a date or a number first", which is advice for
 * someone trying to *publish*, offered to someone trying to *stop*.
 */
export function indicatorBlocker(question: {
  responseType: string;
  scope: string;
  allowPreferNotToSay: boolean;
}): { reason: string; remedy: string } | null {
  if (!indicatorFamilyFor(question.responseType)) {
    return {
      reason:
        "a written answer can't be aggregated — the only honest total of a text field is the members' own words",
      remedy: "Change the answer type to pick one, pick any, a date or a number first.",
    };
  }
  if (question.scope !== "once_ever") {
    return {
      reason:
        "an answer to a per-event or per-phase question is what was true during that event, so one community-wide figure would report a past window as though it described everyone now",
      remedy:
        "A community indicator has to be a once-ever question. Scope is fixed when the question is created, so add a once-ever question for this instead.",
    };
  }
  // The consent floor, and the reason it is a *decline* rather than a
  // privacy setting.
  //
  // The obvious alternative — a per-question "who may read the answers"
  // rule, like `sensitive_field_access_rule` does for allergies and an
  // emergency contact — turns out to model the wrong thing. That table
  // exists because somebody has to read a *named individual's* value. An
  // indicator has no such reader: the aggregate is the only thing that
  // ever exists, and no code path anywhere shows one member's answer to
  // anyone. So the question "who may see this?" is already answered, and
  // the one that isn't is "may a member be *counted* without agreeing to
  // be?". That is a decline, and a decline is what `allowPreferNotToSay`
  // already is.
  //
  // Requiring it is not politeness. Without it, a member's only way out
  // of a number they're about to be counted in is to not answer — and
  // silence is visible: it shows up as "2 haven't" in the coverage line,
  // so the refusal leaks through the gap it was meant to protect, and the
  // answer they withheld by declining is exactly as published as one they
  // gave. `declined` is stored with a null value and counted separately,
  // so a refusal is a refusal.
  if (!question.allowPreferNotToSay) {
    return {
      // Phrased as a noun phrase, not a sentence, because both callers
      // splice it into their own sentence — "published as a community
      // indicator, and <reason>." reads badly when <reason> is itself a
      // clause with an "and" in it.
      reason:
        "without a way for members to decline, counting them in a number leaves only silence — which is itself visible in the coverage line",
      remedy:
        'Tick "allow prefer not to say" on this question first. It stays a permanent, unchased answer, and declines are reported as their own figure rather than as a gap.',
    };
  }
  return null;
}

// --- The aggregate, per family. Each returns the numbers plus the
// denominator they were computed against; the component never divides by
// anything it hasn't been given.

export type IndicatorRow = { label: string; count: number };

export type IndicatorData =
  | { family: "split" | "distribution"; rows: IndicatorRow[] }
  | {
      family: "summary";
      // Both kinds of summary are a small set of named figures rather
      // than a list, so this is a label→value pair list and not rows:
      // "min: 4" as a proportion bar would be nonsense.
      figures: { label: string; value: string }[];
    };

export type CommunityIndicator = {
  questionId: string;
  label: string;
  family: IndicatorFamily;
  /** The aggregate. Always present — see the note on the type below. */
  data: IndicatorData;
  /** People the aggregate describes. The denominator for every share. */
  answered: number;
  /** Deliberate "I'd rather not say" responses. Not silence, and not an answer. */
  declined: number;
  /** Everyone in the population who could have answered. */
  population: number;
  /** The question's own answer type, so the component can label a yes/no. */
  responseType: string;
};

/**
 * Whose answers an indicator is describing.
 *
 * This is not decoration, and it's why the scope is a first-class part of
 * the result rather than something the page works out for itself: an
 * indicator is a proportion, and "33%" is a claim about a population. A
 * reader who can't see which population is reading a number that means
 * nothing — and on the Dashboard the same indicator legitimately
 * describes the whole community on one view and just the people coming
 * to one event on the next.
 */
export type IndicatorScope =
  | { kind: "community" }
  | { kind: "event"; cycleId: string; cycleName: string };

export type CommunityIndicatorsResult = {
  scope: IndicatorScope;
  indicators: CommunityIndicator[];
  /**
   * Why the requested scope was narrowed, when it was. The Dashboard
   * renders this rather than silently substituting — a toggle reading
   * "This event" above a community-wide figure is exactly the failure
   * this whole scoping work exists to prevent.
   */
  scopeFallback: string | null;
};

/**
 * Decide the scope a viewer actually gets, given the community's policy.
 *
 * Falls back to community-wide — and says so — rather than producing an
 * empty view, because a small event's indicator is still true, it's just
 * not safe to attribute at that size. The reason string is part of the
 * result, not something the page has to reconstruct.
 */
export function resolveIndicatorScope(input: {
  requested: IndicatorScope;
  enabled: boolean;
  minMembers: number;
  population: number;
}): { scope: IndicatorScope; fallback: string | null } {
  if (input.requested.kind !== "event") {
    return { scope: input.requested, fallback: null };
  }
  if (!input.enabled) {
    return {
      scope: { kind: "community" },
      fallback: "Indicators here cover all members — this Community doesn't break them out for one event.",
    };
  }
  if (input.population < input.minMembers) {
    return {
      scope: { kind: "community" },
      fallback: `Indicators here cover all members — this event's ${input.population} attendees is too few to break out without identifying someone.`,
    };
  }
  return { scope: input.requested, fallback: null };
}

/**
 * Every published indicator for a community, with the breakdown withheld
 * for anyone who may not see it.
 *
 * `scope` picks the population. `community` is every member; `event` is
 * the members who have declared they're coming to one event, which is
 * the same definition the Dashboard's "N members coming this event"
 * count uses — deliberately read from the same place rather than
 * re-derived, so an indicator and the count printed above it can't
 * describe different groups.
 *
 * Only the *population* narrows. The answers are once-ever standing
 * facts, so an event-scoped indicator is "of the eight people coming,
 * five have told us their pronouns" — not "what people said about this
 * event", which is a different and much noisier question.
 *
 * Two queries rather than one per question: the questions and all of
 * their answers, then grouped in memory. A community with a dozen
 * published indicators would otherwise be a dozen round trips on pages
 * that have to be quick, since they also carry the participation cards
 * and the assembly list.
 */
/** The Community's own per-cycle indicator policy. */
async function readCycleIndicatorPolicy(communityId: string) {
  const [row] = await db
    .select({
      enabled: community.cycleIndicatorsEnabled,
      minMembers: community.cycleIndicatorsMinMembers,
    })
    .from(community)
    .where(eq(community.id, communityId));
  // A missing row is impossible (the actor belongs to it), but defaulting
  // to *off* is the right failure anyway: an unreadable policy must not
  // be the thing that exposes a small group.
  return { enabled: row?.enabled ?? false, minMembers: row?.minMembers ?? 10 };
}

/**
 * Members who declared they're coming to a cycle and haven't opted out of
 * indicators — the population an event-scoped indicator describes.
 */
async function eventPopulationIds(communityId: string, cycleId: string): Promise<string[]> {
  const rows = await db
    .selectDistinct({ memberId: participation.memberId })
    .from(participation)
    .innerJoin(member, eq(participation.memberId, member.id))
    .where(
      and(
        eq(participation.cycleId, cycleId),
        eq(participation.status, "coming"),
        // Scoping to another community's cycle is impossible via
        // participation, but the member filter is here for the exclusion
        // and doubles as the community check.
        eq(member.communityId, communityId),
        eq(member.consentsToCommunityIndicators, true),
      ),
    );
  return rows.map((r) => r.memberId);
}

/**
 * Every member who has consented to being counted in indicators. The
 * consent is standing and section-level, so this is one filter rather
 * than a per-answer one — see member.ts's comment on the column.
 */
async function communityPopulationIds(communityId: string): Promise<string[]> {
  const rows = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.communityId, communityId), eq(member.consentsToCommunityIndicators, true)));
  return rows.map((r) => r.id);
}

export async function listCommunityIndicators(
  actor: Member,
  options: {
    /** What the viewer is asking for, before the Community's policy. */
    requested?: IndicatorScope;
    /**
     * Override the community's per-cycle indicator policy. Normally left
     * unset, in which case the function reads the Community's own two
     * columns — it already knows which Community it's reading, and
     * making every caller thread the policy in is one more thing that can
     * disagree with the stored setting.
     */
    policy?: { enabled: boolean; minMembers: number };
  } = {},
): Promise<CommunityIndicatorsResult> {
  const published = await db
    .select()
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, actor.communityId),
        eq(profileQuestion.publishedAsIndicator, true),
        // Archived means "we don't ask this any more". Its historical
        // answers would otherwise keep publishing a number that nobody
        // maintains and that ages silently, which is worse for trust
        // than the indicator simply going away.
        isNull(profileQuestion.archivedAt),
      ),
    )
    .orderBy(profileQuestion.label);

  // Enforced again on the way out, not only on the way in. A row can
  // predate a rule (an indicator published before the consent floor
  // existed, or a question archived-then-restored from an older backup),
  // and this is the only reader — both call sites are pages, so this is
  // not a case of trusting a zod schema at the boundary.
  const questions = published.filter((q) => canPublishAsIndicator(q));

  const requested = options.requested ?? { kind: "community" as const };
  const policy =
    options.policy ?? (await readCycleIndicatorPolicy(actor.communityId));

  // Resolve the scope against the policy *before* anything else, which
  // needs the event population. It has to happen here rather than in the
  // page for one specific reason: the floor must test the population the
  // chart will actually display, which excludes members who opted out.
  // A page-side check would read the raw "coming" count off the snapshot
  // and the fallback note would then say "10 attendees" directly above a
  // chart reading "of 8" — the exact substitution this whole mechanism
  // exists to prevent, just with a mismatched denominator instead of a
  // wrong label.
  const populationFor = async (s: IndicatorScope) =>
    s.kind === "event" ? eventPopulationIds(actor.communityId, s.cycleId) : communityPopulationIds(actor.communityId);

  let scope = requested;
  let scopeFallback: string | null = null;
  if (requested.kind === "event") {
    const eventIds = await populationFor(requested);
    const resolved = resolveIndicatorScope({
      requested,
      enabled: policy.enabled,
      minMembers: policy.minMembers,
      population: eventIds.length,
    });
    scope = resolved.scope;
    scopeFallback = resolved.fallback;
  }

  if (questions.length === 0) return { scope, indicators: [], scopeFallback };

  // The population, as ids rather than a count, and the ONE definition
  // of who an indicator describes. Everything downstream — the
  // denominator, and which answers count — reads this set, so they
  // cannot disagree about who is in it.
  //
  // `consents_to_community_indicators` is applied here, which is what
  // makes a member's standing decision mean the same thing as the count
  // they see: someone who hasn't consented is not in the population at
  // all, rather than being in it and then removed from the answers, which
  // would leave them showing up as a permanent gap in the coverage line.
  const populationIds = await populationFor(scope);

  const inPopulation = new Set(populationIds);
  // Deliberately *not* filtered to the population in SQL. The questionId
  // IN (...) already bounds the result to a handful of questions' answers,
  // and a member-id IN list covering a whole community would be a large
  // array in the query plan for no gain. Filtering against
  // `inPopulation` below costs one Set lookup per row and — more to the
  // point — can't drift from the denominator the same function reports.
  const allAnswers = await db
    .select({
      questionId: profileAnswer.questionId,
      memberId: profileAnswer.memberId,
      status: profileAnswer.status,
      value: profileAnswer.value,
    })
    .from(profileAnswer)
    .where(
      inArray(
        profileAnswer.questionId,
        questions.map((q) => q.id),
      ),
    );

  const answers = allAnswers.filter((a) => inPopulation.has(a.memberId));

  const byQuestion = new Map<string, typeof answers>();
  for (const a of answers) {
    const list = byQuestion.get(a.questionId) ?? [];
    list.push(a);
    byQuestion.set(a.questionId, list);
  }

  return {
    scope,
    scopeFallback,
    indicators: questions.map((q) => {
      const rows = byQuestion.get(q.id) ?? [];
      // Two states, and they mean different things about a person: a
      // real answer, or a refusal to hold the value at all. There's no
      // third "answered but not yet counted" — section-level consent
      // retired it. A member either consented to being in indicators
      // (in which case they're in the population at all) or they didn't
      // (in which case they're not in the population), so a stored answer
      // is always a stored answer the community is entitled to count.
      const answered = rows.filter((a) => a.status === "answered");
      const declined = rows.filter((a) => a.status === "declined").length;
      const family = indicatorFamilyFor(q.responseType) ?? "split";

      return {
        questionId: q.id,
        label: q.label,
        family,
        data: aggregateIndicator(q, answered.map((a) => a.value)),
        answered: answered.length,
        declined,
        population: populationIds.length,
        responseType: q.responseType,
      };
    }),
  };
}

function aggregateIndicator(
  question: ProfileQuestion,
  values: unknown[],
): IndicatorData {
  const shape = toFieldShape({
    responseType: question.responseType,
    options: question.options,
    allowOther: question.allowOther,
  });

  if (question.responseType === "number") {
    const nums = values
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (nums.length === 0) return { family: "summary", figures: [] };
    const sum = nums.reduce((a, b) => a + b, 0);
    const mid = Math.floor(nums.length / 2);
    // The median is the figure that survives one member answering "60"
    // and everyone else "3", which is the normal shape of volunteer
    // capacity data. The mean is kept too — dropping it would lose real
    // information — but it is labelled, not presented as *the* number.
    const median =
      nums.length % 2 === 0 ? (nums[mid - 1] + nums[mid]) / 2 : nums[mid];
    return {
      family: "summary",
      figures: [
        { label: "lowest", value: String(nums[0]) },
        { label: "median", value: String(median) },
        { label: "mean", value: (sum / nums.length).toFixed(1) },
        { label: "highest", value: String(nums[nums.length - 1]) },
      ],
    };
  }

  if (question.responseType === "date") {
    const dates = values
      .map((v) => (typeof v === "string" ? v : ""))
      .filter((v) => /^\d{4}-\d{2}-\d{2}$/.test(v))
      .sort();
    if (dates.length === 0) return { family: "summary", figures: [] };
    return {
      family: "summary",
      figures: [
        { label: "earliest", value: formatExactDate(dates[0]) },
        { label: "latest", value: formatExactDate(dates[dates.length - 1]) },
      ],
    };
  }

  if (question.responseType === "boolean") {
    // Not routed through the option-counting path below, because a
    // boolean is stored as a real `true`/`false` rather than a string in
    // an option's slot, and that path counts strings. Both rows are
    // always present so the two-way shape is legible even when everyone
    // has said yes — the same reason a choice shows its un-picked
    // options at zero.
    const yes = values.filter((v) => v === true).length;
    return {
      family: "split",
      rows: [
        { label: "Yes", count: yes },
        { label: "No", count: values.length - yes },
      ],
    };
  }

  // Everything left is a choice: counted into a fixed set of rows so a
  // question nobody has answered still shows its own shape rather than
  // rendering as an empty box, and so an option nobody picked shows as a
  // real zero instead of vanishing.
  const counts = new Map<string, number>();
  for (const option of shape.options) counts.set(option, 0);

  // The escape hatch's answers are stored as an ordinary string in an
  // option's own slot (that's the point of the design — an aggregate
  // needs no special case to count the real options), which means an
  // unrecognised value here is a member's own words. They are counted
  // together under one visible label and never printed, because
  // publishing what someone typed is a disclosure no "publish this
  // indicator" toggle can consent to on their behalf — the count is the
  // aggregate; the sentence is theirs.
  let otherCount = 0;
  for (const value of values) {
    const picked = Array.isArray(value) ? value : [value];
    for (const v of picked) {
      if (typeof v !== "string") continue;
      if (counts.has(v)) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      } else {
        otherCount++;
      }
    }
  }

  const rows: IndicatorRow[] = [...counts].map(([label, count]) => ({ label, count }));
  if (otherCount > 0) {
    rows.push({ label: "Something else", count: otherCount });
  }
  // Reachable only for a choice type — number, date and boolean returned
  // above, text can't be published at all — so the family is one of the
  // two non-summary ones by construction rather than by assertion.
  return {
    family: question.responseType === "multi_choice" ? "distribution" : "split",
    rows,
  };
}

// --- Write-side guard
//
// The rules live here, next to the aggregation that depends on them,
// rather than in the settings action, so there is one place to look for
// "what makes a question publishable" and one test that can check it.

export function assertIndicatorAllowed(input: {
  responseType: string;
  scope: string;
  allowPreferNotToSay: boolean;
  publishedAsIndicator: boolean;
}): void {
  if (!input.publishedAsIndicator) return;
  const blocker = indicatorBlocker(input);
  if (blocker) {
    throw new ConflictError(`This can't be published as a community indicator: ${blocker.reason}. ${blocker.remedy}`);
  }
}

/**
 * The flags that make no sense alongside publication, refused.
 *
 * Each of these is not a rule that could be satisfied differently — each
 * is a claim that is false of a published question. Emergency access says
 * "you might need this and not have it"; a published indicator is already
 * in front of the whole community. `sensitive` says "restricted to an
 * audience"; a published indicator is by definition in front of everyone.
 * Leaving either on would store a flag asserting something untrue, and a
 * flag that lies is worse than a missing one, because the next person to
 * read it trusts it.
 *
 * One function for all of them, because the shape and the remedy are the
 * same — turn one off — and three near-identical guards is three chances
 * for the next attribute to arrive without one.
 */
export function assertNotContradictoryWithPublication(input: {
  sensitive: boolean;
  emergencyAccess: boolean;
  publishedAsIndicator: boolean;
}): void {
  if (!input.publishedAsIndicator) return;
  if (input.emergencyAccess) {
    throw new ConflictError(
      "This question can't be both an emergency-access question and a published community indicator. An indicator is already readable by the whole community, so there's nothing for emergency access to reach — and a published question isn't the kind of thing you need in an emergency. Turn one off.",
    );
  }
  if (input.sensitive) {
    throw new ConflictError(
      "This question can't be both sensitive and a published community indicator. Sensitive means the answer is restricted to a chosen audience, and publishing means every member can see the breakdown — so the two claims cancel out and the sensitive flag would only be misleading. Unpublish it, or drop the sensitive tick.",
    );
  }
}

/**
 * Emergency access overrides a restriction, so it needs one to override.
 *
 * Vacuous rather than harmless, and the difference matters. A
 * non-sensitive question is readable by the whole community already, so
 * "answering this consents to emergency reads" consents to nothing —
 * and the reveal would put a read of *public* data in the log as though
 * it had been protected. That is the same failure as a flag asserting
 * something untrue, in the one place where the assertion is read by
 * someone deciding whether they can trust their own audit trail.
 *
 * So the sequence is three steps and each is a real decision: create the
 * question plain, build the access rule, mark it sensitive, then mark it
 * emergency-access. The last two are checkboxes on the same row, so the
 * dependency reads as an ordering rather than as ceremony.
 */
export function assertEmergencyHasSomethingToOverride(input: {
  emergencyAccess: boolean;
  sensitive: boolean;
}): void {
  if (input.emergencyAccess && !input.sensitive) {
    throw new ConflictError(
      "Emergency access overrides a restriction, so it needs one to override. Mark this question sensitive first \u2014 a question that isn't sensitive is already readable by the whole community, so there'd be nothing for an emergency reveal to reveal, and logging one would record a read of public data as though it had been protected.",
    );
  }
}

/** Whether a question is currently allowed to be published. */
export function canPublishAsIndicator(question: {
  responseType: string;
  scope: string;
  allowPreferNotToSay: boolean;
}): boolean {
  return indicatorBlocker(question) === null;
}

/**
 * A member's standing consent to be counted in every published indicator.
 *
 * Granted once, for the whole publishable-questions section, and never
 * per question. A question can only enter that section at creation, so
 * the consent always predates any answer it's given and there is never a
 * reason to ask again — which is precisely what the per-question
 * `indicatorConsent` machinery existed to work around, and why it was
 * built and then removed.
 *
 * The consent is to a *rule*, not a list of people. Adding a question to
 * the section later doesn't re-open it, because the member was told the
 * section may appear in indicators and answered accordingly. The one
 * thing that does re-open it is widening a sensitive question's audience,
 * and that's a per-answer question handled at the answer, not here.
 *
 * Self-service, and deliberately so: it changes how *your own* answers
 * are read, so nobody else should get to set it — an Admin ability to
 * exclude a member would be the same power as one to include them
 * without asking, wearing a privacy label. The mirror of
 * `updateContributionVisibility` (src/lib/contribution.ts), which is the
 * same shape for the same reason.
 *
 * A reporting change only: every question still answers, and answering
 * still costs nothing in outstanding-question terms. That's deliberate —
 * making the consent suppress answering too would be a way to silently
 * drop someone out of a required question by hiding the control, which
 * is the opposite of what it says on the tin.
 */
export async function updateIndicatorConsent(actor: Member, consents: boolean) {
  const [updated] = await db
    .update(member)
    .set({ consentsToCommunityIndicators: consents })
    .where(eq(member.id, actor.id))
    .returning();
  if (!updated) {
    throw new NotFoundError("Member not found");
  }
  return updated;
}

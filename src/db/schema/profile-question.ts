import { boolean, date, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { cycle } from "./cycle";

// The format checks a text field can apply to its own value — the
// persisted half of TEXT_VALIDATIONS in src/lib/field-shape.ts, which is
// where the regexes and the labels live. Kept in step with that list
// rather than duplicating it; validateFieldValue is the only reader.
export const textValidationEnum = pgEnum("text_validation", ["none", "email", "phone", "url"]);

// The six answer shapes, defined once in src/lib/field-shape.ts and
// shared with Form.fields — this enum is the persisted half of that
// module's RESPONSE_TYPES, and every renderer, validator and builder
// reads the union from there rather than re-declaring it.
//
// Was four values (free_text/single_choice/multi_choice/date).
// `free_text` became `text` and gained a `multiline` column, because
// "free text" described neither its length nor the fact that it needed
// to distinguish itself from `long_text`: the old field always rendered
// a textarea, which was wrong for "pronouns" and "T-shirt size".
// `boolean` and `number` are the shapes that were genuinely missing —
// "do you need a bed?" is a checkbox, and a bed count is a number an
// aggregate can sum, neither of which a free-text string or a choice
// list can express honestly.
export const profileQuestionResponseTypeEnum = pgEnum("profile_question_response_type", [
  "text",
  "single_choice",
  "multi_choice",
  // See docs/development-plan.md's Phase 44 — its only real consumer is
  // an opt-in birthday surfaced as its own layer on /calendar, visible
  // per whatever visibility the answering member already controls for
  // any once-ever answer (i.e. only to themselves — no answer-sharing
  // mechanism exists for any responseType today).
  "date",
  "boolean",
  "number",
]);
export const profileQuestionScopeEnum = pgEnum("profile_question_scope", [
  "once_ever",
  "per_cycle",
  "phase",
]);


// A standing fact about a member that shouldn't be pinned to whichever
// flow happened to ask first — see docs/spec.md's "Profile questions".
// Community-wide standing structure, the same footing as Branch/Tier,
// so CRUD is Admins-gated at the settings action layer (see
// src/app/settings/actions.ts) rather than inside this table's own lib
// module, matching how Branch/Tier CRUD is gated.
//
// `surfaces` (which flow(s) can trigger this question — spec's own
// example: `["application", "onboarding"]`) sat deliberately unbuilt
// since Phase 16, since guessing its shape before a real consumer
// existed risked getting it wrong the same way building Forms/Profile
// questions standalone would have. docs/development-plan.md's Phase 56
// (Member onboarding) is that first real consumer — see
// src/lib/onboarding.ts. Recruitment's own "application" intake never
// grew into a consumer of this (Phase 33 built application intake on
// Forms instead, a genuinely different mechanism — see
// recruitmentApplicationFormId), so "onboarding" is the only value
// anything in this codebase actually reads today; the field stays a
// plain free-text array rather than a closed enum since spec frames it
// as open-ended ("wherever").
export const profileQuestion = pgTable("profile_question", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  label: text("label").notNull(),
  responseType: profileQuestionResponseTypeEnum("response_type").notNull().default("text"),
  // Only meaningful for single_choice/multi_choice.
  options: text("options").array().notNull().default([]),
  // --- Field-shape flags. All three are read through
  // src/lib/field-shape.ts's toFieldShape, which zeroes the ones that
  // don't apply to this row's responseType — so "multiline on a
  // single_choice question" can't mean anything, by construction rather
  // than by every reader remembering to check. Kept as real columns
  // (not one jsonb blob) to match the rest of this table, and because
  // requiredBy above is read per-row on every request.

  // text only: one line (default) vs a textarea. The `free_text` rows
  // this replaces all rendered as a textarea, so the data migration sets
  // this true for every one of them — no existing question changes how
  // it renders.
  multiline: boolean("multiline").notNull().default(false),
  // text only: none | email | phone | url. A format check on the value,
  // not a separate type — "an email is still a text field, still
  // short, still deferrable" is the whole reason this is a column
  // rather than two more enum values. An enum rather than free text so
  // a typo can't store a validation nothing implements.
  validation: textValidationEnum("validation").notNull().default("none"),
  // choice only: append an "Other" option backed by a text input, so the
  // option list stays a closed vocabulary an aggregate can count while
  // the tail of the distribution is still captured.
  allowOther: boolean("allow_other").notNull().default(false),
  // number only.
  min: integer("min"),
  max: integer("max"),
  step: integer("step"),
  scope: profileQuestionScopeEnum("scope").notNull().default("once_ever"),
  // Set only when scope = 'phase'. Matched case-insensitively against
  // the *current* cycle's actual Phase names (see
  // src/lib/profile-questions/capacity.ts) — the same "matched against
  // real names" pattern TaskPack's branch_name_hint uses, just without
  // an import-review screen since there's nothing to remap here. A
  // cycle with no phase by this name just doesn't surface the question.
  phaseNameHint: text("phase_name_hint"),
  required: boolean("required").notNull().default(false),
  surfaces: text("surfaces").array().notNull().default([]),
  // Opts a `scope = 'phase'` question into the Coordination view's
  // capacity-aware fitted asks + availability non-response list (see
  // docs/spec.md's Coordination mechanics). Generic rather than a
  // hardcoded "this is THE Availability question" flag, so a community
  // could in principle define more than one capacity-relevant question
  // across different phase names.
  feedsCapacitySignal: boolean("feeds_capacity_signal").notNull().default(false),
  // Whether "I don't know yet" is offered at all for this question.
  // Some questions genuinely have no "not yet" — a date of birth, a legal
  // name, "are you over 18?" — where offering a defer button just
  // invites a click that stores a non-answer and pushes the question back
  // on the list. Off by default: a question is a thing you can answer now
  // unless the community says otherwise. Read by
  // listOutstandingRequiredQuestions only for required questions (a
  // deferral already satisfies an optional one, so the flag is moot
  // there) and by the answer forms to decide whether to render the
  // button at all.
  allowDeferral: boolean("allow_deferral").notNull().default(true),
  // Whether to offer "prefer not to say" as a third response alongside
  // answering and deferring. Off by default, unlike allowDeferral: a
  // deferral is nearly always sensible, but offering a way out of a
  // question by default quietly makes it optional, and for some
  // questions a community genuinely needs a real answer from everyone
  // (are you over 18, do you hold a licence for the vehicle you're
  // bringing). Per-question, so the community decides which facts are
  // ones a member may decline and which are conditions of participating.
  //
  // Declining is permanent — see profileAnswerStatusEnum's `declined` —
  // and never counts as satisfying a question that doesn't offer it.
  allowPreferNotToSay: boolean("allow_prefer_not_to_say").notNull().default(false),
  // "We need this answered by then" — the date after which a member's
  // "I don't know yet" stops being good enough and the question starts
  // counting against them again (listOutstandingRequiredQuestions).
  // Only meaningful when allowDeferral is on; a due date on a
  // non-deferrable question would be unreachable.
  //
  // Only meaningful alongside `required`, and only because deferring has
  // to mean something time-bound: "I don't know yet" is an honest answer
  // months out, but a community that needs a bed count to plan transport
  // needs a real number by a real date. A plain required/deferred pair
  // with no date is the bug this fixes — deferred silently satisfied the
  // question forever, so nothing ever came back. Null = deferral is
  // permanent, which is the right default for a once_ever standing fact
  // ("emergency contact") and the wrong one for planning data.
  requiredBy: date("required_by"),

  // --- Community indicators
  //
  // Opting a question into being *aggregated* on /community, so a
  // community can choose which of its standing questions are facts about
  // everyone rather than about one person. This is the whole point of
  // asking something like pronouns in a way that keeps the options
  // countable: an answer that stays private teaches the community
  // nothing, and an answer published without anyone choosing to is a
  // disclosure no member agreed to.
  //
  // Only `once_ever` questions qualify, enforced on write — see
  // src/lib/profile-questions/indicators.ts. A per-event or per-phase
  // answer is "what was true during that event", so one community-wide
  // figure would silently be reporting a stale window's number as though
  // it described everyone now.
  //
  // A `text` question can't be an indicator at all, also enforced on
  // write. Not "shows badly" — a list of members' own words is not an
  // aggregate of anything, and the alternatives (a word count, a length, a
  // sample) are summaries nobody asked for and can't be agreed to in
  // advance.
  publishedAsIndicator: boolean("published_as_indicator").notNull().default(false),
  // Requires an access rule to exist, and enables the member's
  // share-with-the-audience checkbox. The flag that matters isn't the
  // label — it's what the default does. A non-sensitive, unrestricted
  // question is readable by the whole community, so restricting one at
  // all requires marking it sensitive *and* configuring rules; marking
  // a health question non-sensitive therefore doesn't save an Admin any
  // work, it publishes the data to everyone, visibly. The shortcut and
  // the danger can't point the same way, which is what stops this being
  // a promise.
  sensitive: boolean("sensitive").notNull().default(false),
  // Answering this question consents to it being read by whoever
  // activates emergency mode. No separate member tick, and the only way
  // to refuse is not to answer — the same deal a filled-in contact
  // method offers. Meaningless on a question everyone can already read,
  // which is every non-sensitive unrestricted one.
  emergencyAccess: boolean("emergency_access").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
});

// Three states, not two, and the third is not a flavour of `deferred`:
//
//  - answered: a real value.
//  - deferred: "I don't know yet" — an honest gap with a promise to come
//    back. May resurface once the question's `requiredBy` passes.
//  - declined: "I'd rather not say" — a deliberate, permanent refusal, and
//    a legitimate exercise of the member's own judgement rather than an
//    incomplete form. Never resurfaces, not even past a due date; there's
//    no setting that talks someone out of it. Only ever written for a
//    question with `allowPreferNotToSay` set (see below), and stored with
//    a null value, so an aggregate reading answers can tell "declined"
//    apart from "hasn't answered" — a real difference when the answer is
//    a diversity signal rather than a number.
export const profileAnswerStatusEnum = pgEnum("profile_answer_status", ["answered", "deferred", "declined"]);
// See docs/spec.md's "Availability and its own visibility setting" —
// deliberately lives on the answer, not a general settings page.
// Harmless/unused on an answer to a question that isn't
// feeds_capacity_signal.
export const capacityVisibilityEnum = pgEnum("capacity_visibility", ["flag_only", "open"]);

// One member's current answer to one ProfileQuestion — updated in
// place (no revision history; spec doesn't ask for one here the way
// task wiki notes get one). `cycleId` is set for per_cycle and phase
// scopes, null for once_ever ("it's just *the* current answer" — see
// spec). A `deferred` status satisfies a required question without a
// guessed or fabricated value.
export const profileAnswer = pgTable("profile_answer", {
  id: uuid("id").primaryKey().defaultRandom(),
  memberId: uuid("member_id")
    .notNull()
    .references(() => member.id),
  questionId: uuid("question_id")
    .notNull()
    .references(() => profileQuestion.id),
  status: profileAnswerStatusEnum("status").notNull().default("answered"),
  value: jsonb("value"),
  capacityVisibility: capacityVisibilityEnum("capacity_visibility").notNull().default("flag_only"),
  // Whether this answer is in the configured audience's reach, on a
  // *sensitive* question. Un-ticking reduces the answer to emergency-only
  // — the member keeps it, and their own profile still shows it, they
  // just don't put it in front of whoever holds the access rule.
  //
  // Default TRUE, for the same reason member.consentsToCommunityIndicators
  // is: the exposure is already bounded by the access rules, so sharing
  // is the expected consequence of answering and un-ticking is the
  // reduction. The opposite default would make the safe choice the one
  // people have to remember to take.
  //
  // Meaningless on a non-sensitive question, where everyone may read it
  // anyway — the answer writer forces it back to true there, so the
  // column can never disagree with the question it belongs to.
  shareWithAudience: boolean("share_with_audience").notNull().default(true),
  cycleId: uuid("cycle_id").references(() => cycle.id),
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
});

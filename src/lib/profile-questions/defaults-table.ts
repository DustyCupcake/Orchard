// Type-only, so it is erased at compile time and this file stays free of a
// runtime edge to permissions.ts (and through it, to `@/db`). If you find
// yourself wanting PERMISSION_MODULE_KEYS here to check a row, that check
// belongs in defaults.ts's validateDefaultQuestionTable instead.
import type { PermissionModuleKey } from "../permissions";

/**
 * The starter question set, as data, with no database anywhere in it.
 *
 * Split out from defaults.ts for a build reason that is easy to undo by
 * accident: the review step in Settings is a client component, and
 * importing the seeder from there drags `@/db` — and with it `postgres`,
 * `tls`, `fs` — into the browser bundle, which fails the build outright.
 * So the table and its types live here, importable from either side, and
 * defaults.ts re-exports them: the server-only half is the code that
 * writes rows and validates module keys, and nothing about *having* the
 * table needs a database.
 */

export type DefaultQuestionSeed = {
  /** Stable identifier, because the review step lets a label be edited
   *  before the row is created, so the form can't address it by label. */
  key: string;
  label: string;
  responseType: "text" | "single_choice" | "multi_choice" | "boolean" | "number" | "date";
  options?: string[];
  allowOther?: boolean;
  multiline?: boolean;
  // An indicator, which needs once-ever scope and a way to decline — the
  // two rules `createProfileQuestion` enforces anyway, stated here so the
  // intent is visible rather than implied.
  publishedAsIndicator?: boolean;
  allowPreferNotToSay: boolean;
  // The audience, as a *suggestion*. This is what the review step
  // pre-selects and what the unattended signup path falls back to; an
  // admin can override it with any of the three routes, or drop the
  // sensitivity entirely. A rule has to be added *after* the question
  // exists, so this is a flag in the table and a step in the seed — see
  // `seedDefaultProfileQuestions` for why the order is load-bearing.
  accessRuleModuleKey?: PermissionModuleKey;
  // Free text: the doc's "Why" column, so the reason travels with the
  // question rather than living in a document nobody reading their own
  // settings will open.
  why: string;
};

export type DefaultQuestionGroup = {
  title: string;
  blurb: string;
  questions: DefaultQuestionSeed[];
};

/** One unlock route, in the shape `createSensitiveFieldAccessRule` takes. */
export type SeededQuestionAudience = {
  unlockedByTaskId?: string | null;
  unlockedByTierId?: string | null;
  unlockedByGrantModuleKey?: PermissionModuleKey | null;
};

/** What the review step decided about one proposed question.
 *
 *  `audience: null` is the meaningful case and not an oversight: it is
 *  "add this one, but leave it readable by the whole community", which is
 *  a real answer for a question whose suggested audience was wrong.
 */
export type DefaultQuestionChoice = {
  include: boolean;
  /** Blank or absent means the table's own label. A review form always
   *  submits one, so a cleared title falls back rather than creating a
   *  nameless question. */
  label?: string;
  audience: SeededQuestionAudience | null;
};

/** Keyed by `DefaultQuestionSeed.key`. */
export type DefaultQuestionChoices = Record<string, DefaultQuestionChoice>;

// The starter set from docs/default-profile-questions.md, as data.
//
// A table rather than a function body, for one reason: this is the whole
// set a new community starts with, so it has to be *readable* by the
// people who maintain it. A community that wants to drop one of these
// should be able to see that it's a row, edit the row, and have the next
// community start without it.
//
// NOT seeded, deliberately: the four fixed sensitive member columns
// (health conditions, allergies, emergency contact, orientation). Those
// are docs/spec.md's fixed set and already exist as `member` columns
// under the `sensitive_data` module. Questions 15–17 in the doc are
// *that* set, not new questions — seeding them as questions would leave
// a community with two places to record an allergy and one place to read
// it, which is the kind of split that loses an allergy.
//
// EVERY question here is once-ever, and that is load-bearing rather than
// incidental. A `per_cycle` question is silently skipped on every read
// surface when the member has no declared cycle and no open cycle exists
// to fall back to (listOutstandingQuestions, answers.ts) — so seeding one
// into a community that hasn't created an event yet produces a question
// nobody can see, answer, or be nagged about, which is indistinguishable
// from the app being broken. Since the seed runs at signup, before any
// event can exist, that would have been true of every per-event question
// in the set. The doc's "For an event" group (bed, T-shirt size, van,
// lift, dietary needs, carrying heavy things, availability) is therefore
// not seeded at all rather than seeded wrong: a community adds those
// itself, per event, once it has one — and the create form's scope picker
// is the right place for that decision, because scope is fixed at
// creation and unchangeable afterwards.
//
// The groups are the doc's *presentation* groups and they exist here for
// that reason only. Presentation is not a permission and is not stored on
// the question: if you're reading this to find out who may see an answer,
// the answer is `resolveReadableQuestions`. The one thing a group *does*
// promise is that its blurb is true of every row in it — which is why
// "Restricted" carries `accessRuleModuleKey` on all of its rows, and why
// a row without one would not belong in it.

export const DEFAULT_PROFILE_QUESTION_GROUPS: DefaultQuestionGroup[] = [
  {
    title: "Who you are",
    blurb: "Standing facts about a person. Answer once; they don't change per event.",
    questions: [
      {
        key: "pronouns",
        label: "Your pronouns",
        responseType: "single_choice",
        options: ["she/her", "he/him", "they/them", "he/they", "she/they"],
        allowOther: true,
        // The case the whole feature exists for: countable, so an
        // indicator, and declinable, so a lawful one.
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
        why: "The motivating case, and the reason the escape hatch exists.",
      },
      {
        key: "languages",
        label: "Languages you speak",
        // Text, not pick-any, and the reason is a hard constraint rather
        // than a preference: a choice question with no options is refused
        // outright, and rightly so — it would render as an empty list plus
        // a text box, which is a worse version of the same thing.
        //
        // So the seed is the shape that works with nothing invented, and
        // a community that wants this countable changes it to a pick-any
        // and types in their own languages — which is the edit they'd have
        // made anyway. The doc proposes pick-any + other, and this is that
        // minus the part no one but the community can supply.
        responseType: "text",
        multiline: true,
        allowPreferNotToSay: true,
        why: "Who someone is, and what an interpreter needs — both at once, which is why it isn't filed as either. Make it a pick-any and add your own languages if you want it countable.",
      },
      {
        key: "age_range",
        label: "Age range",
        responseType: "single_choice",
        options: ["under 18", "18–24", "25–34", "35–44", "45–64", "65+"],
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
        why: "A band, never a date of birth. Eligibility stays in `requirement` — a question would give it a decline button, and declining an eligibility gate is a contradiction. This is also why the set asks for no precise date of birth at all: the band is the whole of what any seeded question needs.",
      },
    ],
  },
  {
    title: "What you can do",
    // Deliberately describes *what the questions are for* and promises
    // nothing about who may read the answers. An earlier version of this
    // blurb promised "none of it is anybody's business to read" while
    // every row in the group seeded world-readable — a false promise in
    // the one place a maintainer reads to find out what the set assumes.
    // Anything genuinely private is in Restricted, where the audience
    // arrives attached.
    blurb: "What someone can be asked to do, and what a task needs to know before it's assigned.",
    questions: [
      {
        key: "certifications",
        label: "Certifications you hold",
        responseType: "multi_choice",
        options: ["first aid", "food hygiene", "safeguarding", "driving licence"],
        allowOther: true,
        allowPreferNotToSay: true,
        why: "Determines what someone can be asked to do, and is a real safety input. Left readable by the community: a first-aid certificate is an offer, not a circumstance.",
      },
      {
        key: "vehicle",
        label: "Do you have a vehicle?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "A fact, not a circumstance, so it isn't sensitive — nobody minds this being known.",
      },
    ],
  },
  {
    title: "Restricted",
    // The blurb is a contract, and this table is how it keeps it: every
    // row below carries `accessRuleModuleKey`, so every row arrives
    // sensitive *and* with a real audience already attached. A restricted
    // question seeded without one is either restricted to nobody, or — the
    // failure this group actually had — readable by everybody while its
    // own blurb said otherwise. `validateDefaultQuestionTable` in
    // defaults.ts throws if that ever slips again.
    blurb:
      "Answers the whole community must not read. Each arrives with its audience already attached, because a sensitive question with no rule is restricted to nobody.",
    questions: [
      {
        key: "allergies",
        label: "Allergies",
        responseType: "text",
        multiline: true,
        allowPreferNotToSay: true,
        accessRuleModuleKey: "kitchen",
        why: "Kitchen coordinators genuinely need it; nobody else does. Declinable, so a refusal stays available rather than becoming a blank the kitchen has to chase.",
      },
      {
        key: "access_needs",
        label: "Anything that would affect what you can take on",
        responseType: "text",
        multiline: true,
        allowPreferNotToSay: true,
        // Moved here from "What you can do", where its own `why` called
        // it "the escape hatch for disability, caring, faith" while the row
        // seeded world-readable. Branch coordination is the audience
        // because they're the ones fitting work to people. Declinable, so
        // a member with nothing to add isn't forced to write something.
        accessRuleModuleKey: "branch_coordination",
        why: "The escape hatch for disability, caring, faith — whatever a fixed list doesn't cover. The easiest question in the set to get wrong, because it reads like a capability question and isn't.",
      },
      {
        key: "home_city",
        label: "Home city or town",
        responseType: "text",
        allowPreferNotToSay: true,
        // "Drives travel and cost planning", which is programme-owner
        // work — and, unlike a full address, a town isn't a starting point
        // for locating someone. Change the audience in review if your
        // community plans travel somewhere else.
        accessRuleModuleKey: "event_scheduling_owner",
        why: "Drives travel and cost planning. A town rather than a full address, so it narrows a plan without being the start of finding someone.",
      },
      {
        key: "legal_name",
        label: "Full legal name",
        responseType: "text",
        // The narrowest thing in the set: no decline offered, and admins as
        // the only audience. A member with nothing to hide may still not
        // want their legal name readable by the whole community, which is
        // why this one is restricted rather than merely uncounted. Change
        // the audience, or drop the question, in review.
        allowPreferNotToSay: false,
        accessRuleModuleKey: "admin",
        why: "Distinct from display name, and needed where a legal record has to match. The one row here with no decline offered, so it's also the one a member has to answer before they can move on.",
      },
    ],
  },
];

/** Every seed's key, in table order, for validating a review submission. */
export const DEFAULT_QUESTION_KEYS = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) =>
  g.questions.map((q) => q.key),
);

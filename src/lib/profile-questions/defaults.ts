import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { createProfileQuestion, updateProfileQuestion } from "./questions";
import { createSensitiveFieldAccessRule } from "../sensitive-data";
import { PERMISSION_MODULE_KEYS, type PermissionModuleKey } from "../permissions";

type Member = typeof memberTable.$inferSelect;

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
// The groups are the doc's *presentation* groups and they exist here for
// that reason only. Presentation is not a permission and is not stored on
// the question: if you're reading this to find out who may see an answer,
// the answer is `resolveReadableQuestions`.

export type DefaultQuestionSeed = {
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
  // The audience. A rule has to be added *after* the question exists, so
  // this is a flag in the table and a step in the seed — see
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
  /** The doc's third group, and the only per-event one. See the scope note. */
  perEvent?: boolean;
  questions: DefaultQuestionSeed[];
};

export const DEFAULT_PROFILE_QUESTION_GROUPS: DefaultQuestionGroup[] = [
  {
    title: "Who you are",
    blurb: "Standing facts about a person. Answer once; they don't change per event.",
    questions: [
      {
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
        label: "How long you've been part of this",
        responseType: "single_choice",
        options: ["less than a year", "1–3 years", "more than 3 years"],
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
        why: "Tenure shapes whose input a community's decisions are landing on.",
      },
      {
        label: "Age range",
        responseType: "single_choice",
        options: ["under 18", "18–24", "25–34", "35–44", "45–64", "65+"],
        publishedAsIndicator: true,
        allowPreferNotToSay: true,
        why: "A band, never a date of birth. Eligibility stays in `requirement` — a question would give it a decline button, and declining an eligibility gate is a contradiction.",
      },
    ],
  },
  {
    title: "What you can do",
    blurb: "What someone can be asked to do, and what would get in the way. None of it is anybody's business to read.",
    questions: [
      {
        label: "Certifications you hold",
        responseType: "multi_choice",
        options: ["first aid", "food hygiene", "safeguarding", "driving licence"],
        allowOther: true,
        allowPreferNotToSay: true,
        why: "Determines what someone can be asked to do, and is a real safety input.",
      },
      {
        label: "Anything that would affect what you can take on",
        responseType: "text",
        multiline: true,
        allowPreferNotToSay: true,
        why: "The escape hatch for disability, caring, faith — whatever a fixed list doesn't cover.",
      },
      {
        label: "Do you have a vehicle?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "A fact, not a circumstance, so it isn't sensitive — nobody minds this being known.",
      },
    ],
  },
  {
    title: "For an event",
    blurb: "Asked again each time, because the answer genuinely changes.",
    // Per-event rather than per-phase: a phase is a stretch of one
    // event, so a phase-scoped answer would be asked again for every
    // phase of the same weekend — which is the question repeating itself.
    perEvent: true,
    questions: [
      {
        label: "Do you need a bed?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "The canonical event question, and the one the capacity signal already comes from.",
      },
      {
        label: "T-shirt size",
        responseType: "single_choice",
        options: ["XS", "S", "M", "L", "XL", "XXL"],
        allowOther: true,
        allowPreferNotToSay: false,
        why: "Not sensitive — but still not everybody's business, which is exactly why a flag is the wrong tool and an access rule is the right one.",
      },
      {
        label: "Can you drive a van / carry passengers?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "Asks capability, not possession, and is a different question from having a vehicle.",
      },
      {
        label: "Do you need a lift to or from an event?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "The reverse of the above, and a separate question.",
      },
      {
        label: "Dietary needs",
        responseType: "multi_choice",
        options: ["vegetarian", "vegan", "halal", "kosher", "gluten-free"],
        allowOther: true,
        allowPreferNotToSay: true,
        why: "A refusal here is itself information the kitchen needs, which is why it's a decline rather than a blank.",
      },
      {
        label: "Can you carry heavy things?",
        responseType: "boolean",
        allowPreferNotToSay: false,
        why: "Task matching, and nobody minds.",
      },
      {
        label: "When are you generally around?",
        responseType: "single_choice",
        options: ["weekdays", "evings", "weekends", "shift work"],
        allowOther: true,
        allowPreferNotToSay: false,
        why: "Scheduling input. Better asked once than at every event, so it's standing rather than per-event despite the group.",
      },
    ],
  },
  {
    title: "Restricted",
    blurb: "Answers the whole community must not read. Each arrives with its audience already attached, because a sensitive question with no rule is restricted to nobody.",
    questions: [
      {
        label: "Allergies",
        responseType: "text",
        multiline: true,
        allowPreferNotToSay: true,
        accessRuleModuleKey: "kitchen",
        why: "Kitchen coordinators genuinely need it; nobody else does.",
      },
      {
        label: "Home city or town",
        responseType: "text",
        allowPreferNotToSay: true,
        why: "Drives travel and cost planning. Restricted because where someone lives is the start of a lot of an address.",
      },
      {
        label: "Date of birth",
        responseType: "date",
        allowPreferNotToSay: false,
        accessRuleModuleKey: "kitchen",
        why: "Precise, so restricted — but a decline that leaves an eligibility gap is worse than the fact being held, so no decline is offered.",
      },
      {
        label: "Full legal name",
        responseType: "text",
        allowPreferNotToSay: false,
        why: "Distinct from display name, and needed where a legal record matters.",
      },
    ],
  },
];

/**
 * Seed a new community's standing questions.
 *
 * Deliberately seeds **no** emergency-access question. Emergency access
 * is the one attribute where a wrong default is a disclosure rather than
 * an inconvenience: any member can activate it, and the answer arrives
 * with no consent decision beyond having filled the question in. That's
 * defensible per question and not a thing to switch on across five
 * questions in someone's community on their behalf, so it's the
 * community's call in settings — where the copy explains what activating
 * it does.
 *
 * The order is load-bearing for the restricted ones: a question can't be
 * marked sensitive until a rule names it, and a rule can only name a
 * question that exists. So each is created, given its rule, then flagged —
 * the same three steps an admin takes by hand, in the same order. A
 * community that wants to change one of these is already looking at the
 * sequence that seeded it.
 */
export async function seedDefaultProfileQuestions(actor: Member) {
  // Validated up front so a typo in the table above fails here, loudly,
  // rather than producing a rule that quietly unlocks nothing for ever.
  for (const group of DEFAULT_PROFILE_QUESTION_GROUPS) {
    for (const seed of group.questions) {
      if (seed.accessRuleModuleKey && !PERMISSION_MODULE_KEYS.includes(seed.accessRuleModuleKey)) {
        throw new Error(
          `The default question "${seed.label}" names the permission module "${seed.accessRuleModuleKey}", which doesn't exist. A rule that unlocks nothing is worse than no rule.`,
        );
      }
    }
  }

  const created: {
    id: string;
    label: string;
    scope: "once_ever" | "per_cycle";
    sensitive: boolean;
  }[] = [];

  for (const group of DEFAULT_PROFILE_QUESTION_GROUPS) {
    for (const seed of group.questions) {
      const question = await createProfileQuestion(actor, {
        label: seed.label,
        responseType: seed.responseType,
        options: seed.options,
        multiline: seed.multiline ?? false,
        allowOther: seed.allowOther ?? false,
        scope: group.perEvent ? "per_cycle" : "once_ever",
        // Every seeded question allows deferral. "I don't know yet" is the
        // honest state for a new member on a question they weren't
        // expecting, and the reverse default — a seeded question chasing
        // every new member until they answer it — isn't one anyone wants.
        // An admin who wants a hard gate turns it off in settings.
        allowDeferral: true,
        allowPreferNotToSay: seed.allowPreferNotToSay,
        publishedAsIndicator: seed.publishedAsIndicator ?? false,
        // Marked sensitive below, once the rule exists. Passing it here
        // would be refused, and correctly: `sensitive` is the second step
        // of three, not a property of the seed.
        sensitive: false,
        emergencyAccess: false,
      });

      if (seed.accessRuleModuleKey) {
        await createSensitiveFieldAccessRule(actor, {
          questionId: question.id,
          unlockedByGrantModuleKey: seed.accessRuleModuleKey,
        });
        await updateProfileQuestion(actor, question.id, { sensitive: true });
      }

      created.push({
        id: question.id,
        label: question.label,
        scope: group.perEvent ? "per_cycle" : "once_ever",
        sensitive: Boolean(seed.accessRuleModuleKey),
      });
    }
  }

  return created;
}

/**
 * Seed the default set for a community that has none, and do nothing if
 * it already has some.
 *
 * The guard is "has any questions", not "does it match the table" — the
 * question is whether the community has decided what its questions are,
 * and a community that added one by hand before this ran has decided,
 * whether or not the row resembles anything in the table. That also
 * makes this safe to call from a login path, which is where it matters:
 * re-seeding because somebody logged in twice would be a bug of the
 * worst shape, since it would silently double every question.
 *
 * Best-effort by design — the caller doesn't await a failure into their
 * login. A community whose first member arrived while the database was
 * having a bad day gets an empty question set and a settings button,
 * which is a far better outcome than a failed login.
 */
export async function maybeSeedDefaultProfileQuestions(actor: Member) {
  if (await hasProfileQuestions(actor.communityId)) {
    return null;
  }
  return seedDefaultProfileQuestions(actor);
}

/** Whether this community already has questions, so a second call is a no-op.
 *
 * Counts *any* question rather than looking for a marker, which is the
 * right instinct here: the question is "has this community decided what
 * its questions are", and a community that added one by hand before the
 * seed ran has decided, whether or not the rows match the table.
 */
export async function hasProfileQuestions(communityId: string) {
  const [row] = await db
    .select({ id: profileQuestion.id })
    .from(profileQuestion)
    .where(eq(profileQuestion.communityId, communityId))
    .limit(1);
  return Boolean(row);
}

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profileQuestion } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { createProfileQuestion, updateProfileQuestion } from "./questions";
import { createSensitiveFieldAccessRule } from "../sensitive-data";
import { PERMISSION_MODULE_KEYS } from "../permissions";
import { AppError } from "../errors";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  type DefaultQuestionChoice,
  type DefaultQuestionChoices,
  type DefaultQuestionGroup,
  type DefaultQuestionSeed,
  type SeededQuestionAudience,
} from "./defaults-table";

// The starter set itself — the table, its types, and the reasoning behind
// its shape — lives in ./defaults-table, which has no database import and
// is therefore safe for the Settings review step to pull into the browser
// bundle. Re-exported here so everything that seeds a community keeps
// importing one module, and so `@/lib/profile-questions` still offers the
// table from its barrel.
export {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  DEFAULT_QUESTION_KEYS,
} from "./defaults-table";
export type {
  DefaultQuestionChoice,
  DefaultQuestionChoices,
  DefaultQuestionGroup,
  DefaultQuestionSeed,
  SeededQuestionAudience,
} from "./defaults-table";

type Member = typeof memberTable.$inferSelect;

/**
 * Checks the table against the rules the rest of this file relies on, so a
 * bad row fails here — loudly, once, at the point of the edit — rather than
 * as a question that arrived quietly wrong in a real community.
 *
 * All three of these were real: a `per_cycle` group that seeded questions
 * no member could ever see (see the scope note at the top of this file),
 * two Restricted rows with no audience contradicting their own group's
 * blurb, and a permission module named by a string literal that nothing
 * checks. Each one is a one-line table edit, and without this they were
 * all one-line *mistakes*.
 *
 * Takes the table as an argument so a test can hand it a deliberately
 * broken one — a validator nothing has ever seen fail is not a validator.
 */
export function validateDefaultQuestionTable(
  groups: DefaultQuestionGroup[] = DEFAULT_PROFILE_QUESTION_GROUPS,
) {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    // A group is the unit that can promise anything, and the one promise a
    // group can make is about who may read the answers.
    if ("perEvent" in group) {
      problems.push(
        `${group.title}: sets perEvent, so its questions would seed as per_cycle — and a per_cycle question is skipped on every read surface while the member has no declared cycle, which is every member of a community that hasn't run an event yet.`,
      );
    }
    for (const seed of group.questions) {
      const where = `${group.title} / ${seed.label}`;
      if (seen.has(seed.key)) problems.push(`${where}: duplicate key "${seed.key}".`);
      seen.add(seed.key);
      if (seed.accessRuleModuleKey && !PERMISSION_MODULE_KEYS.includes(seed.accessRuleModuleKey)) {
        problems.push(
          `${where}: names the permission module "${seed.accessRuleModuleKey}", which doesn't exist. A rule that unlocks nothing is worse than no rule.`,
        );
      }
      if (seed.publishedAsIndicator && !seed.allowPreferNotToSay) {
        problems.push(
          `${where}: published as an indicator with no decline offered, which the consent floor refuses.`,
        );
      }
    }
  }
  // "Restricted" is the one group whose blurb is a promise, so it is the
  // one group where a row without an audience is a contradiction rather
  // than merely a public question.
  const restricted = groups.find((g) => g.title === "Restricted");
  for (const seed of restricted?.questions ?? []) {
    if (!seed.accessRuleModuleKey) {
      problems.push(
        `Restricted / ${seed.label}: has no audience, so it would seed readable by the whole community — which is the opposite of what the group says. Give it an accessRuleModuleKey or move it out.`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(`The default question set is inconsistent:\n- ${problems.join("\n- ")}`);
  }
}

function chosenRoute(audience: SeededQuestionAudience) {
  return [audience.unlockedByTaskId, audience.unlockedByTierId, audience.unlockedByGrantModuleKey].filter(
    Boolean,
  ).length;
}

/** The audience decided for one seed, from either source. */
function audienceFor(seed: DefaultQuestionSeed, choice: DefaultQuestionChoice | undefined) {
  // `choice === undefined` means the row wasn't in the submitted set at
  // all, which only happens on the unattended path — there, the table's
  // own suggestion stands. A present choice with a null audience is a
  // decision: "add this one, readable by everyone".
  if (choice === undefined) {
    return seed.accessRuleModuleKey
      ? ({ unlockedByGrantModuleKey: seed.accessRuleModuleKey } satisfies SeededQuestionAudience)
      : null;
  }
  return choice.audience;
}

/**
 * Everything checkable about a submission, checked before a single row is
 * written.
 *
 * Order matters more than it looks. The seeder is not transactional —
 * `createProfileQuestion` and friends each use the module-level `db` — so
 * a refusal raised partway through would leave the questions seeded so far
 * committed. And that is not a cosmetic half-state: `hasProfileQuestions`
 * is the guard on re-seeding, so a partial write permanently closes the
 * review step and the community is left with an arbitrary prefix of the
 * starter set and no way to get the rest. Validating the whole submission
 * up front is what makes "nothing was added" true whenever the answer is
 * no.
 */
function preflight(
  groups: DefaultQuestionGroup[],
  choices: DefaultQuestionChoices | undefined,
): Map<string, DefaultQuestionChoice> {
  const seeds = new Map(groups.flatMap((g) => g.questions).map((q) => [q.key, q]));
  const problems: string[] = [];

  if (choices) {
    for (const key of Object.keys(choices)) {
      if (!seeds.has(key)) {
        problems.push(
          `the set has no question called "${key}" any more — reload the page and pick again`,
        );
      }
    }
    for (const seed of seeds.values()) {
      const choice = choices[seed.key];
      if (!choice || !choice.include) continue;
      const audience = audienceFor(seed, choice);
      if (audience && chosenRoute(audience) !== 1) {
        problems.push(
          `“${seed.label}” is restricted to everyone except the audience you picked, so it needs exactly one of a Tier, a permission grant, or a Task — pick one, or untick “restricted” to leave it readable by the whole Community`,
        );
      }
    }
  }

  if (problems.length > 0) {
    throw new AppError(
      `Nothing was added — the starter set can't be applied as submitted. ${problems
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(". ")}.`,
    );
  }
  return new Map(Object.entries(choices ?? {}));
}

/**
 * Seed a new community's standing questions.
 *
 * Deliberately seeds **no** emergency-access question. Emergency access
 * is the one attribute where a wrong default is a disclosure rather than
 * an inconvenience: any member can activate it, and the answer arrives
 * with no consent decision beyond having filled the question in. That's
 * defensible per question and not a thing to switch on across several
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
 *
 * `choices` is what the settings review step sends, and it is
 * **authoritative**: a key it doesn't mention is not seeded. That is the
 * only safe reading, because a partial set that defaulted the rest to "add
 * them anyway" would put back the exact bug the review step exists to fix
 * — one unticked row, silently added. Omitting the argument entirely is
 * the unattended signup path, which takes the table's suggestions whole;
 * both entry points therefore produce the same set, and a community never
 * finds itself with different questions depending on how it was created.
 */
export async function seedDefaultProfileQuestions(
  actor: Member,
  choices?: DefaultQuestionChoices,
) {
  // Validated up front so a bad row fails here, loudly, rather than
  // producing a rule that quietly unlocks nothing for ever.
  validateDefaultQuestionTable();
  // `undefined` is the unattended path and takes the table whole; an empty
  // object is a review of a set with nothing ticked, and adds nothing. So
  // the discriminator is presence, not size.
  const isReview = choices !== undefined;
  const decided = preflight(DEFAULT_PROFILE_QUESTION_GROUPS, choices);

  const created: {
    id: string;
    key: string;
    label: string;
    scope: "once_ever" | "per_cycle";
    sensitive: boolean;
  }[] = [];

  for (const group of DEFAULT_PROFILE_QUESTION_GROUPS) {
    for (const seed of group.questions) {
      const choice = decided.get(seed.key);
      // A row named in `choices` but unticked is excluded. A row *not*
      // named is excluded too, whenever `choices` was supplied at all —
      // see the note on the parameter.
      if (isReview && !choice?.include) continue;

      const audience = audienceFor(seed, choice);
      const question = await createProfileQuestion(actor, {
        // The review step lets an admin retitle a row on the way in, which
        // is the whole reason it exists — a starter set you have to archive
        // and re-add under your own wording is worse than no starter set.
        label: choice?.label?.trim() || seed.label,
        responseType: seed.responseType,
        options: seed.options,
        multiline: seed.multiline ?? false,
        allowOther: seed.allowOther ?? false,
        // Once-ever for every seeded question, and not a detail. A
        // `per_cycle` question is skipped on every read surface while the
        // member has no declared cycle — which is the state of a community
        // that hasn't run an event yet, i.e. all of them at seed time. See
        // the scope note at the top of this file.
        scope: "once_ever",
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

      if (audience) {
        await createSensitiveFieldAccessRule(actor, { questionId: question.id, ...audience });
        await updateProfileQuestion(actor, question.id, { sensitive: true });
      }

      created.push({
        id: question.id,
        key: seed.key,
        label: question.label,
        scope: "once_ever",
        sensitive: Boolean(audience),
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

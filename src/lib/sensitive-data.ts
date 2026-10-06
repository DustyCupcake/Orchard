import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, type DbOrTx } from "@/db";
import {
  member,
  profileAnswer,
  profileAnswerRuleConsent,
  profileQuestion,
  sensitiveFieldAccessRule,
  task,
  taskAssignment,
  tier,
} from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConflictError, NotFoundError } from "./errors";
import { getGatingPurposesForQuestions, listMembersWithActiveConsent } from "./consent";
import { recordSettingChanges } from "./settings/history";
import {
  listGrantingTaskIds,
  PERMISSION_MODULE_KEYS,
  PERMISSION_MODULE_LABELS,
  type PermissionModuleKey,
} from "./permissions";

type Member = typeof memberTable.$inferSelect;

// Who may read a member's answer to a sensitive question, in one place.
//
// This module used to be two systems: the four fixed `member` columns
// (health conditions, allergies, emergency contact, orientation) behind a
// module toggle and a `/sensitive-data` grid, and profile questions with a
// per-answer audience. They shared this rule table and nothing else, and
// only the columns had a cross-member reader — which meant `sensitive`
// performed no restriction anywhere. The columns are gone (migration 0080)
// and this is the whole mechanism.
//
// Three levels, failing closed:
//
//   1. not sensitive  → everyone may read. A decline is the member's only
//      lever, and the one that always works.
//   2. sensitive      → the configured audience: the union of the holders
//      of any rule naming the question, *intersected with* the answers
//      whose owner agreed to that specific rule. Un-ticking the answer's
//      share box reduces it to emergency-only, so it is filtered out
//      before the audience test rather than after.
//   3. own answer    → always readable, at any level.
//
// Being wrong in this direction costs a hidden answer and being wrong in
// the other costs someone's medication, so the asymmetry is deliberate
// and the empty-audience case resolves to "nobody but the owner".

// Rules: which task, tier, or permission grant unlocks a question for
// *other* members' answers. Exactly one of unlockedByTaskId/
// unlockedByTierId/unlockedByGrantModuleKey per rule — a question can
// carry more than one, and anyone satisfying any one of them can read it,
// subject to the consent intersection below. unlockedByGrantModuleKey is
// the third route (docs/food-drinks-module-plan.md's D3): whoever
// currently holds ANY task granting that module, community-wide and
// deliberately not narrowed by the granting task's placement.
export const createSensitiveFieldAccessRuleInput = z.object({
  questionId: z.string().uuid(),
  unlockedByTaskId: z.string().uuid().nullable().optional(),
  unlockedByTierId: z.string().uuid().nullable().optional(),
  unlockedByGrantModuleKey: z.enum(PERMISSION_MODULE_KEYS).nullable().optional(),
});
export type CreateSensitiveFieldAccessRuleInput = z.infer<typeof createSensitiveFieldAccessRuleInput>;

export async function createSensitiveFieldAccessRule(
  actor: Member,
  input: CreateSensitiveFieldAccessRuleInput,
  // Defaults to the shared connection. createProfileQuestion passes its own
  // transaction so that a question created sensitive is one atomic act: the
  // row, the rule that restricts it and the flag that says so either all
  // exist or none do.
  executor: DbOrTx = db,
) {
  const chosen = [input.unlockedByTaskId, input.unlockedByTierId, input.unlockedByGrantModuleKey].filter(
    Boolean,
  ).length;
  if (chosen !== 1) {
    throw new AppError("Pick exactly one of a task, a tier, or a grant module to unlock this for");
  }

  const [target] = await executor
    .select({ archivedAt: profileQuestion.archivedAt })
    .from(profileQuestion)
    .where(and(eq(profileQuestion.id, input.questionId), eq(profileQuestion.communityId, actor.communityId)));
  if (!target) {
    throw new NotFoundError("Profile question not found in your community");
  }
  if (target.archivedAt) {
    throw new ConflictError("That question is archived, so there is nothing left to unlock");
  }
  // Deliberately NOT requiring the question to be sensitive yet. `sensitive`
  // is now fixed at creation and a question cannot be made sensitive by
  // an update, so a rule against a public question is a *staged* rule: it
  // restricts nothing, because the question is public, and it starts
  // working the moment such a question exists. Which is only possible for
  // a question that was created public and is being given an audience for
  // a future widening — see below on why that needs consent.

  if (input.unlockedByTaskId) {
    const [taskRow] = await executor
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.unlockedByTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }
  if (input.unlockedByTierId) {
    const [tierRow] = await executor
      .select({ id: tier.id })
      .from(tier)
      .where(and(eq(tier.id, input.unlockedByTierId), eq(tier.communityId, actor.communityId)));
    if (!tierRow) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  // The question's label is fetched here for the log's entityLabel. It is a
  // second read of a row already fetched above (as archivedAt only) rather
  // than widening that select, because that select's result is also what
  // decides two throws and keeping it narrow keeps the throws legible.
  const [forLog] = await executor
    .select({ label: profileQuestion.label })
    .from(profileQuestion)
    .where(eq(profileQuestion.id, input.questionId));

  const created = await executor.transaction(async (tx) => {
    const [row] = await tx
      .insert(sensitiveFieldAccessRule)
      .values({
        communityId: actor.communityId,
        questionId: input.questionId,
        unlockedByTaskId: input.unlockedByTaskId ?? null,
        unlockedByTierId: input.unlockedByTierId ?? null,
        unlockedByGrantModuleKey: input.unlockedByGrantModuleKey ?? null,
      })
      .returning();

    // Who can now see this question's answers is a widening of access to
    // other people's data, so it is one of the most consequential rows this
    // log will ever hold — and the entity is the *question*, not the rule,
    // because a rule has no name of its own and a reader asking "who can
    // see the answer to 'Do you have a health condition?'" needs to land on
    // the question.
    await recordSettingChanges(tx, {
      actor,
      entity: "sensitive_field_rule",
      action: "created",
      entityId: row.id,
      entityLabel: forLog?.label ?? null,
      current: {},
      changes: {
        question: forLog?.label ?? "a question that no longer exists",
        // Exactly one of these three is non-null — createSensitiveFieldAccessRule
        // refuses anything else — so the other two are omitted rather than
        // logged as "unlocked by: nothing", which would read as if the rule
        // were broken.
        unlockedByTaskId: row.unlockedByTaskId,
        unlockedByTierId: row.unlockedByTierId,
        unlockedByGrantModuleKey: row.unlockedByGrantModuleKey,
      },
    });
    return row;
  });

  // Deliberately no back-fill of consent here, and that is the fix rather
  // than an omission. If this question already has answers, adding a rule
  // is a *widening* — and widening is the act that needs someone's
  // agreement, because those members answered against an audience this
  // rule is not part of. Granting them consent retroactively converts
  // "nobody was asked" into "everyone agreed" without a word to anybody.
  //
  // So a new rule starts from nothing: it cannot read the answers that
  // predate it, each of those members is shown a prompt to extend
  // sharing, and until they do the question reads exactly as it did
  // before the rule existed. Consent is granted by *answering* (see
  // `consentAnswerToCurrentAudience`), never by an admin's edit.
  return created;
}

/**
 * One audience, as a member reads it: a name, not an id.
 *
 * Shared by the two places a member is asked about an audience — the answer
 * form and the "extend who can see your answers" prompt — because those two
 * asking about the same group in two different words is how somebody ends
 * up agreeing to what they took to be a different audience. The names
 * arrive from the caller, which batches its lookups.
 */
export type Audience = { ruleId: string; label: string };

type AudienceRule = typeof sensitiveFieldAccessRule.$inferSelect;

/**
 * A rule's audience in the words a member would use for it.
 *
 * The three branches are the three routes `createSensitiveFieldAccessRule`
 * accepts. Every branch falls back rather than asserting, including the
 * last: a rule carrying no route at all is readable by nobody, and calling
 * it "another group in this Community" would be a lie that reads as a
 * rendering fault. The settings tab's `ruleRoute` is the admin-facing twin
 * of this and falls back the same way.
 */
export function describeAudience(
  rule: {
    // The grant module key, typed rather than `string`, because
    // PERMISSION_MODULE_LABELS is a closed map — indexing it with an
    // arbitrary string is the difference between a label and "undefined"
    // rendered into a consent prompt a member is being asked to agree to.
    // A key with no label falls back rather than printing one.
    unlockedByGrantModuleKey: PermissionModuleKey | null;
    unlockedByTierId: string | null;
    unlockedByTaskId: string | null;
  },
  names: { tierName?: string | null; taskName?: string | null } = {},
): string {
  if (rule.unlockedByGrantModuleKey) {
    const label = PERMISSION_MODULE_LABELS[rule.unlockedByGrantModuleKey];
    return `anyone holding a ${label ?? "permission"} grant`;
  }
  if (rule.unlockedByTierId) {
    return `anyone in the ${names.tierName ?? "Tier this Community has since removed"} Tier`;
  }
  if (rule.unlockedByTaskId) {
    return `anyone holding the “${names.taskName ?? "Task this Community has since removed"}” Task`;
  }
  return "a group with no audience";
}

/** A `describeAudience` caller with the Tier and Task names already
 *  resolved — two queries for the whole batch rather than one per rule. */
async function audiencer(rules: AudienceRule[]) {
  const tierIds = [...new Set(rules.map((r) => r.unlockedByTierId).filter((id): id is string => Boolean(id)))];
  const taskIds = [...new Set(rules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id)))];
  const tierNames = new Map(
    tierIds.length === 0
      ? []
      : (await db.select({ id: tier.id, name: tier.name }).from(tier).where(inArray(tier.id, tierIds))).map((r) => [r.id, r.name]),
  );
  const taskNames = new Map(
    taskIds.length === 0
      ? []
      : (await db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, taskIds))).map((r) => [r.id, r.title]),
  );
  return (rule: AudienceRule) =>
    describeAudience(rule, {
      tierName: rule.unlockedByTierId ? tierNames.get(rule.unlockedByTierId) : null,
      taskName: rule.unlockedByTaskId ? taskNames.get(rule.unlockedByTaskId) : null,
    });
}

/**
 * Every audience currently on each of these questions, by name.
 *
 * The answer form needs this to ask for the audiences *actually* on, one box
 * each, rather than for a single undifferentiated "the people this Community
 * has given access to it" — which was consent to a set the member never saw.
 * Batched because /questions renders every outstanding question's form on
 * one page.
 */
export async function listAudiencesForQuestions(
  communityId: string,
  questionIds: string[],
): Promise<Map<string, Audience[]>> {
  const out = new Map<string, Audience[]>();
  if (questionIds.length === 0) return out;
  const rules = await db
    .select()
    .from(sensitiveFieldAccessRule)
    .where(
      and(
        eq(sensitiveFieldAccessRule.communityId, communityId),
        inArray(sensitiveFieldAccessRule.questionId, questionIds),
      ),
    );
  if (rules.length === 0) return out;
  const label = await audiencer(rules);
  for (const rule of rules) {
    const list = out.get(rule.questionId) ?? [];
    list.push({ ruleId: rule.id, label: label(rule) });
    out.set(rule.questionId, list);
  }
  return out;
}

/**
 * Which audiences each of these answers is already agreed to.
 *
 * Read back so the boxes default to the member's *existing* choices rather
 * than to all-ticked: somebody who declined one audience last time must not
 * find it silently re-ticked the next time they save an unrelated field on
 * the same question.
 */
export async function listAudienceConsentsForAnswers(answerIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (answerIds.length === 0) return out;
  const rows = await db
    .select({ answerId: profileAnswerRuleConsent.answerId, ruleId: profileAnswerRuleConsent.ruleId })
    .from(profileAnswerRuleConsent)
    .where(inArray(profileAnswerRuleConsent.answerId, answerIds));
  for (const row of rows) {
    const set = out.get(row.answerId) ?? new Set<string>();
    set.add(row.ruleId);
    out.set(row.answerId, set);
  }
  return out;
}

/** This question's current audience rule ids.
 *
 *  Separate from `listAudiencesForQuestions` because the write side needs
 *  the bare ids with no name resolution: `answerProfileQuestion` uses them
 *  to decide whether the member's chosen audiences intersect anything at
 *  all, so `shareWithAudience` records what is true rather than what was
 *  submitted.
 */
export async function listAudienceRuleIds(questionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.questionId, questionId));
  return rows.map((r) => r.id);
}

/**
 * Record this answer's agreement to the audience that exists right now.
 *
 * Called once per answer on a sensitive question, from the answer write
 * rather than from the rule create. That direction is the fix: a rule added
 * afterwards has no consent row to read, so it cannot reach the answers that
 * predate it, which is the difference between a member being asked and a
 * member being assumed to have agreed.
 *
 * `ruleIds` is the member's per-audience choice when the form offered one box
 * per audience, and absent otherwise. Absent means every current rule — the
 * original behaviour, kept for callers with no per-audience UI, and right for
 * them because a single tick there really was consent to the whole set.
 * Present means exactly those, which also **revokes** the rows for the boxes
 * left unticked: re-saving with one cleared has to be able to take an
 * audience *away*, or the control could only ever add, and a member would
 * have no way to narrow sharing to a subset of what they had agreed to.
 *
 * Foreign or stale rule ids are intersected away rather than honoured, so a
 * forged POST granting a rule belonging to another question — or to one since
 * deleted — grants nothing. Failing closed here needs no extra check,
 * because a rule the answer's own question doesn't have cannot be satisfied
 * by the audience test anyway.
 */
export async function consentAnswerToCurrentAudience(
  answerId: string,
  questionId: string,
  ruleIds?: string[],
) {
  const rules = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.questionId, questionId));
  if (rules.length === 0) return 0;

  const currentIds = rules.map((r) => r.id);
  const chosen = new Set(ruleIds === undefined ? currentIds : currentIds.filter((id) => ruleIds.includes(id)));

  if (ruleIds !== undefined) {
    const revoked = currentIds.filter((id) => !chosen.has(id));
    if (revoked.length > 0) {
      await db
        .delete(profileAnswerRuleConsent)
        .where(
          and(
            eq(profileAnswerRuleConsent.answerId, answerId),
            inArray(profileAnswerRuleConsent.ruleId, revoked),
          ),
        );
    }
  }
  if (chosen.size === 0) return 0;

  await db
    .insert(profileAnswerRuleConsent)
    .values([...chosen].map((ruleId) => ({ answerId, ruleId })))
    .onConflictDoNothing();
  return chosen.size;
}

/**
 * One member agreeing to extend sharing of one answer to one rule.
 *
 * The member-facing half of the widening story, and the only way a rule
 * added after an answer ever reaches it. Scoped to the answer's own owner
 * so a forged POST cannot consent on someone else's behalf.
 */
export async function extendAnswerConsent(actor: Member, answerId: string, ruleId: string) {
  const [answer] = await db
    .select({
      id: profileAnswer.id,
      questionId: profileAnswer.questionId,
      shareWithAudience: profileAnswer.shareWithAudience,
      status: profileAnswer.status,
    })
    .from(profileAnswer)
    .where(and(eq(profileAnswer.id, answerId), eq(profileAnswer.memberId, actor.id)));
  if (!answer) throw new NotFoundError("Answer not found");
  if (answer.status !== "answered" || !answer.shareWithAudience) {
    throw new AppError(
      "That answer isn't shared with the audience in the first place, so there's nothing to extend",
    );
  }
  const [rule] = await db
    .select({ id: sensitiveFieldAccessRule.id, questionId: sensitiveFieldAccessRule.questionId })
    .from(sensitiveFieldAccessRule)
    .where(and(eq(sensitiveFieldAccessRule.id, ruleId), eq(sensitiveFieldAccessRule.communityId, actor.communityId)));
  if (!rule || rule.questionId !== answer.questionId) {
    throw new NotFoundError("That rule doesn't apply to this answer");
  }
  await db.insert(profileAnswerRuleConsent).values({ answerId, ruleId }).onConflictDoNothing();
}

/**
 * One member agreeing to have one answer revealed in a crisis.
 *
 * The emergency half of the same story as `extendAnswerConsent`, and
 * separate because the shape differs. An audience is a *set*, so that
 * prompt is per group and agreeing to one group doesn't mean agreeing to
 * the next. Emergency access is a single route, so there is nothing to be
 * granular about — "I agree to this being reachable if someone activates
 * emergency mode on my page" is one fact about a person, and this is the
 * whole of it. It lives on a column rather than in the rule table for the
 * same reason: expressing it there would have needed either a nullable
 * `rule_id` with a magic value for "the emergency route", or a sentinel
 * rule row that isn't a rule.
 *
 * Scoped to the answer's own owner for the same reason as the audience
 * half: a forged POST must not be able to agree on somebody's behalf.
 */
export async function agreeToEmergencyReveal(actor: Member, answerId: string) {
  const [answer] = await db
    .select({ id: profileAnswer.id, status: profileAnswer.status })
    .from(profileAnswer)
    .where(and(eq(profileAnswer.id, answerId), eq(profileAnswer.memberId, actor.id)));
  if (!answer) throw new NotFoundError("Answer not found");
  // A decline and a deferral hold no value, so there is nothing to agree to
  // reveal. Refused rather than silently accepted, because a button that
  // says "yes, allow that" and then does nothing is worse than one that
  // isn't there.
  if (answer.status !== "answered") {
    throw new AppError("That isn't a real answer, so there's nothing to reveal in an emergency");
  }
  await db.update(profileAnswer).set({ emergencyConsent: true }).where(eq(profileAnswer.id, answerId));
}

/**
 * Reads this member has not been asked about, and so has not agreed to.
 *
 * The prompt list on their own profile, both kinds in one place because
 * they are one story from the member's side: *somebody can read something
 * of yours that they couldn't before, and here is whether you agree.* Two
 * queries rather than one because the two joins have nothing in common —
 * an audience is a per-rule set membership, emergency access is a single
 * column — and a UNION over two unrelated shapes would be a harder thing
 * to read than two lists the caller merges.
 */
export async function listPendingAudienceConsents(actor: Member) {
  const pending = await db
    .selectDistinct({
      answerId: profileAnswer.id,
      questionId: profileAnswer.questionId,
      questionLabel: profileQuestion.label,
      ruleId: sensitiveFieldAccessRule.id,
      ruleTaskId: sensitiveFieldAccessRule.unlockedByTaskId,
      ruleTierId: sensitiveFieldAccessRule.unlockedByTierId,
      ruleModuleKey: sensitiveFieldAccessRule.unlockedByGrantModuleKey,
    })
    .from(profileAnswer)
    .innerJoin(profileQuestion, eq(profileAnswer.questionId, profileQuestion.id))
    .innerJoin(
      sensitiveFieldAccessRule,
      and(
        eq(sensitiveFieldAccessRule.questionId, profileAnswer.questionId),
        eq(sensitiveFieldAccessRule.communityId, actor.communityId),
      ),
    )
    .where(
      and(
        eq(profileAnswer.memberId, actor.id),
        eq(profileAnswer.status, "answered"),
        eq(profileAnswer.shareWithAudience, true),
        eq(profileQuestion.sensitive, true),
        isNull(profileQuestion.archivedAt),
        isNull(profileAnswer.cycleId),
        sql`not exists (select 1 from profile_answer_rule_consent c where c.answer_id = ${profileAnswer.id} and c.rule_id = ${sensitiveFieldAccessRule.id})`,
      ),
    );
  // A name rather than an id, because this string is the entire content of
  // the consent being asked for. "share with 7b3f…" is not a decision
  // anyone can make; "share with anyone holding a Kitchen grant" is. Two
  // lookups for an unbounded number of rules, a fallback for the
  // dangling-reference case rather than an exception — a member must not
  // hit an error page because an Admin deleted a Tier — and the *same*
  // words `describeAudience` gave the answer form, which is the whole
  // reason somebody can recognise the group on the second asking.
  const describe = await audiencer(
    pending.map((p) => ({
      unlockedByGrantModuleKey: p.ruleModuleKey,
      unlockedByTierId: p.ruleTierId,
      unlockedByTaskId: p.ruleTaskId,
    })) as AudienceRule[],
  );

  // The emergency half. No audience join, no cross product, no rule: just
  // "this answer of yours is marked for emergency reveal and hasn't agreed
  // to it". Filtered to questions that are still live and still flagged,
  // so a question that had its flag turned back off doesn't leave a prompt
  // behind asking about a reach that no longer exists.
  const emergency = await db
    .selectDistinct({
      answerId: profileAnswer.id,
      questionId: profileAnswer.questionId,
      questionLabel: profileQuestion.label,
    })
    .from(profileAnswer)
    .innerJoin(profileQuestion, eq(profileAnswer.questionId, profileQuestion.id))
    .where(
      and(
        eq(profileAnswer.memberId, actor.id),
        eq(profileAnswer.status, "answered"),
        eq(profileAnswer.emergencyConsent, false),
        eq(profileQuestion.emergencyAccess, true),
        eq(profileQuestion.sensitive, true),
        isNull(profileQuestion.archivedAt),
        isNull(profileAnswer.cycleId),
      ),
    );

  return [
    ...pending.map((p) => ({
      kind: "audience" as const,
      answerId: p.answerId,
      questionId: p.questionId,
      questionLabel: p.questionLabel,
      ruleId: p.ruleId,
      audienceLabel: describe({
        unlockedByGrantModuleKey: p.ruleModuleKey,
        unlockedByTierId: p.ruleTierId,
        unlockedByTaskId: p.ruleTaskId,
      } as AudienceRule),
    })),
    ...emergency.map((e) => ({
      kind: "emergency" as const,
      answerId: e.answerId,
      questionId: e.questionId,
      questionLabel: e.questionLabel,
      ruleId: null,
      audienceLabel: null,
    })),
  ];
}

/** How many access rules name this question. */
export async function countQuestionAccessRules(questionId: string) {
  const rows = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.questionId, questionId));
  return rows.length;
}

export async function listSensitiveFieldAccessRules(actor: Member) {
  return db
    .select()
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.communityId, actor.communityId));
}

export async function deleteSensitiveFieldAccessRule(actor: Member, ruleId: string) {
  // The question's label comes along in the same read, so the log can say
  // whose answers are affected. Without it the row would be "unlockedByTaskId
  // removed" with no subject, and a deletion like this is precisely the one a
  // member might want to trace back later.
  const [existing] = await db
    .select({
      id: sensitiveFieldAccessRule.id,
      questionId: sensitiveFieldAccessRule.questionId,
      unlockedByTaskId: sensitiveFieldAccessRule.unlockedByTaskId,
      unlockedByTierId: sensitiveFieldAccessRule.unlockedByTierId,
      unlockedByGrantModuleKey: sensitiveFieldAccessRule.unlockedByGrantModuleKey,
      label: profileQuestion.label,
    })
    .from(sensitiveFieldAccessRule)
    .leftJoin(profileQuestion, eq(profileQuestion.id, sensitiveFieldAccessRule.questionId))
    .where(
      and(eq(sensitiveFieldAccessRule.id, ruleId), eq(sensitiveFieldAccessRule.communityId, actor.communityId)),
    );
  if (!existing) {
    throw new NotFoundError("Rule not found");
  }

  await db.transaction(async (tx) => {
    await tx.delete(sensitiveFieldAccessRule).where(eq(sensitiveFieldAccessRule.id, ruleId));
    await recordSettingChanges(tx, {
      actor,
      entity: "sensitive_field_rule",
      action: "deleted",
      entityId: ruleId,
      entityLabel: existing.label,
      current: existing,
      changes: {
        question: existing.label ?? "a question that no longer exists",
        unlockedByTaskId: null,
        unlockedByTierId: null,
        unlockedByGrantModuleKey: null,
      },
    });
  });
}

/**
 * Which rules the actor currently satisfies. ONE resolution for all three
 * routes, because the routes mean the same thing and a second copy is how
 * "task rules count, tier rules don't" bugs arrive. A Tier rule checks
 * the actor's own tierIds; a Task rule checks whether they currently
 * (really — a shadow doesn't count) hold that task; a Grant-module rule
 * checks whether they hold ANY task granting that module.
 */
async function satisfiedRuleIds(actor: Member, rules: (typeof sensitiveFieldAccessRule.$inferSelect)[]) {
  if (rules.length === 0) return new Set<string>();

  const interestingTaskIds = new Set(
    rules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id)),
  );
  const grantModuleKeys = [
    ...new Set(rules.map((r) => r.unlockedByGrantModuleKey).filter((k): k is PermissionModuleKey => Boolean(k))),
  ];
  // moduleKey -> the tasks that grant it. Kept per module (not flattened
  // into one pool) because each rule has to be matched against *its own*
  // module's granting tasks — a hold of a `budget` task must not satisfy
  // a rule that names `kitchen`.
  const grantTaskIdsByModule = new Map<PermissionModuleKey, string[]>();
  for (const moduleKey of grantModuleKeys) {
    const grantingTaskIds = await listGrantingTaskIds(actor.communityId, moduleKey);
    grantTaskIdsByModule.set(moduleKey, grantingTaskIds);
    for (const id of grantingTaskIds) interestingTaskIds.add(id);
  }

  const heldTaskIds = new Set<string>();
  if (interestingTaskIds.size > 0) {
    const holdings = await db
      .select({ taskId: taskAssignment.taskId })
      .from(taskAssignment)
      .where(
        and(
          eq(taskAssignment.memberId, actor.id),
          eq(taskAssignment.isShadow, false),
          inArray(taskAssignment.taskId, [...interestingTaskIds]),
        ),
      );
    for (const holding of holdings) heldTaskIds.add(holding.taskId);
  }

  const satisfied = new Set<string>();
  for (const rule of rules) {
    if (rule.unlockedByTierId && actor.tierIds.includes(rule.unlockedByTierId)) {
      satisfied.add(rule.id);
    }
    if (rule.unlockedByTaskId && heldTaskIds.has(rule.unlockedByTaskId)) {
      satisfied.add(rule.id);
    }
    if (rule.unlockedByGrantModuleKey) {
      const grantingTaskIds = grantTaskIdsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
      if (grantingTaskIds.some((id) => heldTaskIds.has(id))) {
        satisfied.add(rule.id);
      }
    }
  }
  return satisfied;
}

/** The answers a satisfied rule has been agreed to read.
 *
 *  The second half of the audience test, and the part that was missing
 *  until 0081. A rule says who *may* read; a consent row says who agreed
 *  to be read by *this* rule. Without the intersection, adding a rule to a
 *  question that already had answers reached every one of them at once,
 *  which is the consent violation this closes.
 */
async function consentedAnswerIds(ruleId: string) {
  const rows = await db
    .select({ answerId: profileAnswerRuleConsent.answerId })
    .from(profileAnswerRuleConsent)
    .where(eq(profileAnswerRuleConsent.ruleId, ruleId));
  return new Set(rows.map((r) => r.answerId));
}

/** The sensitive question ids this actor may read other members' answers
 *  to, ignoring per-answer consent.
 *
 *  What the column picker and the kitchen ask: which columns are on the
 *  table at all. Answering that with the full consent-aware resolution
 *  would make a question vanish for a viewer who is in the audience but
 *  hasn't yet agreed for a particular member, which is the wrong
 *  direction — a column that exists but shows fewer people is honest; a
 *  column that silently disappears is indistinguishable from it never
 *  having existed.
 */
export async function listReadableSensitiveQuestionIds(viewer: Member) {
  const sensitive = await db
    .select({ id: profileQuestion.id })
    .from(profileQuestion)
    .where(
      and(
        eq(profileQuestion.communityId, viewer.communityId),
        eq(profileQuestion.sensitive, true),
        isNull(profileQuestion.archivedAt),
      ),
    );
  if (sensitive.length === 0) return new Set<string>();

  const rules = await db
    .select()
    .from(sensitiveFieldAccessRule)
    .where(
      and(
        eq(sensitiveFieldAccessRule.communityId, viewer.communityId),
        inArray(sensitiveFieldAccessRule.questionId, sensitive.map((q) => q.id)),
      ),
    );
  const satisfied = await satisfiedRuleIds(viewer, rules);
  const readable = new Set<string>();
  for (const rule of rules) {
    if (satisfied.has(rule.id)) readable.add(rule.questionId);
  }
  return readable;
}

/** Consent re-check for a set of gated questions, in one pass.
 *
 *  A question with a configured gating purpose is readable for another
 *  member only where that member currently has active, non-withdrawn
 *  consent against it — re-evaluated on every read, so a withdrawal
 *  takes effect immediately rather than needing a sweep.
 */
async function consentedMemberIds(communityId: string, questionIds: string[]) {
  const purposes = await getGatingPurposesForQuestions(communityId);
  const granted = new Map<string, Set<string>>();
  for (const questionId of questionIds) {
    const purpose = purposes.get(questionId);
    if (!purpose) continue;
    granted.set(questionId, await listMembersWithActiveConsent(purpose.id));
  }
  return granted;
}

/**
 * Which of one member's answers `viewer` may read.
 *
 * THE narrow definition of profile-question readability, and deliberately
 * the only one — a permission that has to be re-derived at each render
 * site is one that eventually isn't. Must agree with
 * `resolveReadableAnswersForCommunity`, which is the batch version; they
 * are kept honest by the same tests.
 */
export async function resolveReadableQuestions(
  viewer: Member,
  ownerId: string,
  rows: { questionId: string; sensitive: boolean; shareWithAudience: boolean }[],
): Promise<Set<string>> {
  const readable = new Set<string>();
  const sensitiveIds = new Set<string>();
  for (const row of rows) {
    if (row.sensitive) sensitiveIds.add(row.questionId);
    else readable.add(row.questionId);
  }
  // Level 3 short-circuits everything: you can always read your own, and
  // you are always consented to your own.
  if (viewer.id === ownerId || sensitiveIds.size === 0) {
    for (const id of sensitiveIds) readable.add(id);
    return readable;
  }

  // Level 2, minus the member's own reduction: un-ticking the share box
  // on a sensitive question is the answer choosing emergency-only, so it
  // is filtered out here and never reaches the audience test at all.
  const candidateIds = rows
    .filter((r) => r.sensitive && r.shareWithAudience)
    .map((r) => r.questionId);
  if (candidateIds.length === 0) return readable;

  const rules = await db
    .select()
    .from(sensitiveFieldAccessRule)
    .where(
      and(
        eq(sensitiveFieldAccessRule.communityId, viewer.communityId),
        inArray(sensitiveFieldAccessRule.questionId, candidateIds),
      ),
    );
  const satisfied = await satisfiedRuleIds(viewer, rules);
  const candidateSet = new Set(candidateIds);
  const ownerAnswers = await answersByMemberForQuestions(ownerId, candidateSet);
  const gated = await consentedMemberIds(viewer.communityId, candidateIds);

  for (const rule of rules) {
    if (!satisfied.has(rule.id) || !candidateSet.has(rule.questionId)) continue;
    const granted = gated.get(rule.questionId);
    if (granted && !granted.has(ownerId)) continue;
    const consented = await consentedAnswerIds(rule.id);
    const answerId = ownerAnswers.get(rule.questionId);
    // No answer, or no consent row for it, means the rule cannot read it.
    if (!answerId || !consented.has(answerId)) continue;
    readable.add(rule.questionId);
  }
  return readable;
}

/** (questionId -> answerId) for one member's shared, standing answers. */
async function answersByMemberForQuestions(memberId: string, questionIds: Set<string>) {
  const rows = await db
    .select({ id: profileAnswer.id, questionId: profileAnswer.questionId })
    .from(profileAnswer)
    .where(
      and(
        eq(profileAnswer.memberId, memberId),
        inArray(profileAnswer.questionId, [...questionIds]),
        eq(profileAnswer.status, "answered"),
        eq(profileAnswer.shareWithAudience, true),
      ),
    );
  return new Map(rows.map((r) => [r.questionId, r.id]));
}

/** memberId -> the question ids whose answers that member's data the
 *  viewer may read. Missing key and empty set both mean "nothing". */
export type ReadableAnswers = Map<string, Set<string>>;

/**
 * The same resolution as `resolveReadableQuestions`, for a whole roster
 * in one pass. Bounded regardless of roster size: the questions, the
 * rules, the viewer's holdings, the answers and the consent rows are each
 * fetched once, and the per-answer work is set lookups.
 */
export async function resolveReadableAnswersForCommunity(viewer: Member): Promise<ReadableAnswers> {
  const readable: ReadableAnswers = new Map();

  const questions = await db
    .select({ id: profileQuestion.id, sensitive: profileQuestion.sensitive })
    .from(profileQuestion)
    .where(and(eq(profileQuestion.communityId, viewer.communityId), isNull(profileQuestion.archivedAt)));
  if (questions.length === 0) return readable;

  const sensitiveIds = questions.filter((q) => q.sensitive).map((q) => q.id);
  const gated = await consentedMemberIds(viewer.communityId, sensitiveIds);
  const sensitiveById = new Set(sensitiveIds);

  // The audience, as ruleId -> the answers it has been agreed to read.
  const consentedByRule = new Map<string, Set<string>>();
  const satisfiedRules: (typeof sensitiveFieldAccessRule.$inferSelect)[] = [];
  if (sensitiveIds.length > 0) {
    const rules = await db
      .select()
      .from(sensitiveFieldAccessRule)
      .where(
        and(
          eq(sensitiveFieldAccessRule.communityId, viewer.communityId),
          inArray(sensitiveFieldAccessRule.questionId, sensitiveIds),
        ),
      );
    const satisfied = await satisfiedRuleIds(viewer, rules);
    for (const rule of rules) {
      if (!satisfied.has(rule.id)) continue;
      satisfiedRules.push(rule);
      consentedByRule.set(rule.id, await consentedAnswerIds(rule.id));
    }
  }

  const answers = await db
    .select({
      id: profileAnswer.id,
      memberId: profileAnswer.memberId,
      questionId: profileAnswer.questionId,
      shareWithAudience: profileAnswer.shareWithAudience,
    })
    .from(profileAnswer)
    .innerJoin(profileQuestion, eq(profileAnswer.questionId, profileQuestion.id))
    .where(
      and(
        eq(profileQuestion.communityId, viewer.communityId),
        isNull(profileQuestion.archivedAt),
        // Standing facts only. A per-event or per-phase answer belongs to
        // an event, and the member-data grid is about the people rather
        // than one weekend of them.
        isNull(profileAnswer.cycleId),
      ),
    );
  const ruleReaches = (rule: (typeof sensitiveFieldAccessRule.$inferSelect), answerId: string) =>
    consentedByRule.get(rule.id)?.has(answerId) ?? false;

  for (const answer of answers) {
    let permitted: boolean;
    if (answer.memberId === viewer.id) {
      permitted = true;
    } else if (!sensitiveById.has(answer.questionId)) {
      permitted = true;
    } else {
      permitted =
        answer.shareWithAudience &&
        satisfiedRules.some((rule) => rule.questionId === answer.questionId && ruleReaches(rule, answer.id));
      if (permitted) {
        const granted = gated.get(answer.questionId);
        if (granted) permitted = granted.has(answer.memberId);
      }
    }
    if (!permitted) continue;
    const set = readable.get(answer.memberId) ?? new Set<string>();
    set.add(answer.questionId);
    readable.set(answer.memberId, set);
  }
  return readable;
}

/** The question ids whose answers this member's data exposes. */
export function questionsReadableBy(readable: ReadableAnswers, memberId: string) {
  return readable.get(memberId) ?? new Set<string>();
}

/** Every member in the community, ordered for a roster view. */
export async function listCommunityMembers(communityId: string) {
  return db
    .select({ id: member.id, name: member.name })
    .from(member)
    .where(eq(member.communityId, communityId))
    .orderBy(member.name);
}

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
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
) {
  const chosen = [input.unlockedByTaskId, input.unlockedByTierId, input.unlockedByGrantModuleKey].filter(
    Boolean,
  ).length;
  if (chosen !== 1) {
    throw new AppError("Pick exactly one of a task, a tier, or a grant module to unlock this for");
  }

  const [target] = await db
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
    const [taskRow] = await db
      .select({ id: task.id })
      .from(task)
      .where(and(eq(task.id, input.unlockedByTaskId), eq(task.communityId, actor.communityId)));
    if (!taskRow) {
      throw new NotFoundError("Task not found in your community");
    }
  }
  if (input.unlockedByTierId) {
    const [tierRow] = await db
      .select({ id: tier.id })
      .from(tier)
      .where(and(eq(tier.id, input.unlockedByTierId), eq(tier.communityId, actor.communityId)));
    if (!tierRow) {
      throw new NotFoundError("Tier not found in your community");
    }
  }

  const [created] = await db
    .insert(sensitiveFieldAccessRule)
    .values({
      communityId: actor.communityId,
      questionId: input.questionId,
      unlockedByTaskId: input.unlockedByTaskId ?? null,
      unlockedByTierId: input.unlockedByTierId ?? null,
      unlockedByGrantModuleKey: input.unlockedByGrantModuleKey ?? null,
    })
    .returning();

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
 * Record this answer's agreement to the audience that exists right now.
 *
 * Called once per answer on a sensitive question whose share box was
 * ticked. The member was answering against a known audience — the one the
 * share box is attached to — so that is the audience they agreed to, and
 * this is what "the rules in effect when each answer was given" means in
 * practice.
 *
 * Deliberately per-rule rather than per-question. An answer given when the
 * audience was {kitchen} and an audience later widened to {kitchen,
 * welfare} is not something the single `shareWithAudience` boolean can
 * express: false would hide the answer from the kitchen too, a narrowing
 * nobody asked for and the kitchen did not consent to, and true would
 * expose it to the welfare team, a widening nobody agreed to.
 */
export async function consentAnswerToCurrentAudience(answerId: string, questionId: string) {
  const rules = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(eq(sensitiveFieldAccessRule.questionId, questionId));
  if (rules.length === 0) return 0;
  await db
    .insert(profileAnswerRuleConsent)
    .values(rules.map((r) => ({ answerId, ruleId: r.id })))
    .onConflictDoNothing();
  return rules.length;
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
  // anyone can make; "share with anyone holding a Kitchen grant" is. Three
  // lookups for an unbounded number of rules, and a fallback for the
  // dangling-reference case rather than an exception — a member must not
  // hit an error page because an Admin deleted a Tier. Skipped entirely
  // when there are no audience rows, which is the common case on a
  // Community nobody has widened.
  const tierIds = [...new Set(pending.map((p) => p.ruleTierId).filter((id): id is string => Boolean(id)))];
  const taskIds = [...new Set(pending.map((p) => p.ruleTaskId).filter((id): id is string => Boolean(id)))];
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
      audienceLabel: p.ruleModuleKey
        ? `anyone holding a ${PERMISSION_MODULE_LABELS[p.ruleModuleKey]} grant`
        : p.ruleTierId
          ? `anyone in the ${tierNames.get(p.ruleTierId) ?? "Tier this Community has since removed"} Tier`
          : p.ruleTaskId
            ? `anyone holding the “${taskNames.get(p.ruleTaskId) ?? "Task this Community has since removed"}” Task`
            : "another group in this Community",
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
  const [existing] = await db
    .select({ id: sensitiveFieldAccessRule.id })
    .from(sensitiveFieldAccessRule)
    .where(
      and(eq(sensitiveFieldAccessRule.id, ruleId), eq(sensitiveFieldAccessRule.communityId, actor.communityId)),
    );
  if (!existing) {
    throw new NotFoundError("Rule not found");
  }
  await db.delete(sensitiveFieldAccessRule).where(eq(sensitiveFieldAccessRule.id, ruleId));
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

import { index, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { profileAnswer } from "./profile-question";
import { sensitiveFieldAccessRule } from "./sensitive-field-access-rule";

/**
 * One member's agreement that one specific access rule may read one
 * specific answer of theirs.
 *
 * The access rules themselves say who *may* read a sensitive question.
 * This says who has agreed to be read — a different question, and the one
 * that gets asked when an Admin **widens** an audience on a question that
 * already has answers.
 *
 * Its own file because it is the one table in this corner of the schema
 * that references both `profile_answer` and `sensitive_field_access_rule`,
 * and the latter already references `profile_question` where the former
 * lives. Putting it here keeps that a fan-in rather than a cycle.
 *
 * Why a table and not the existing `profileAnswer.shareWithAudience`
 * flag: that flag is a single yes/no about the whole audience. An answer
 * given when the audience was {kitchen}, with the audience later widened
 * to {kitchen, welfare}, is a case the flag cannot express — flipping it
 * false hides the answer from the kitchen too, a narrowing nobody asked
 * for and the kitchen did not consent to, while leaving it true exposes
 * the answer to the welfare team, a widening nobody agreed to. Per-rule is
 * the only correct answer, and so per-rule is the row.
 *
 * So: answering a sensitive question with the share box on consents to
 * every rule in effect *at that moment*, because the member was answering
 * against a known audience. A rule added afterwards has no row here, so it
 * cannot read the answers that predate it, and each of those members is
 * shown a prompt to extend sharing. The read side requires the row, so
 * every path fails closed.
 *
 * Rows are per (answer, rule) rather than per (member, question): a rule
 * deleted and re-created is a *different* rule, and consent to a rule that
 * no longer exists should not silently carry over to whatever replaced it.
 */
export const profileAnswerRuleConsent = pgTable("profile_answer_rule_consent", {
  id: uuid("id").primaryKey().defaultRandom(),
  answerId: uuid("answer_id")
    .notNull()
    .references(() => profileAnswer.id, { onDelete: "cascade" }),
  // Cascade on rule_id too, and the reason it is a cascade rather than a
  // `no action` is the delete button on the settings page. Keeping the
  // rows would mean an Admin who removes an audience gets a foreign-key
  // error instead of a narrower question, which is the wrong trade: the
  // history of "someone once agreed to a rule that no longer exists" has
  // no reader, because the resolver matches on the rule id.
  //
  // What the cascade does NOT do is let consent survive the rule. A rule
  // deleted and re-created is a different row with a different id, so
  // the fresh one has no consent to inherit — which is the guarantee the
  // id-based design exists to provide, and it holds either way.
  ruleId: uuid("rule_id")
    .notNull()
    .references(() => sensitiveFieldAccessRule.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // One consent per (answer, rule): re-granting is a no-op rather than a
  // second row, so a member who ticks the box twice doesn't accumulate
  // duplicates.
  uniqueIndex("profile_answer_rule_consent_answer_id_rule_id_unique").on(t.answerId, t.ruleId),
  // The read path asks "which consents exist for this rule", so the rule
  // side is the one that needs to be findable.
  index("profile_answer_rule_consent_rule_id_idx").on(t.ruleId),
]);

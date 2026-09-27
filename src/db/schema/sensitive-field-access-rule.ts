import { pgTable, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { profileQuestion } from "./profile-question";
import { task } from "./task";
import { tier } from "./tier";
import { permissionGrantModuleEnum } from "./permission-grant";

// "A Community defines which task or tier unlocks which question" — one
// row is one unlock route (exactly one of unlockedByTaskId/
// unlockedByTierId/unlockedByGrantModuleKey set, enforced at the
// application layer). A question can have more than one rule — e.g. a
// task, a tier and a grant module can each independently unlock it.
//
// unlockedByGrantModuleKey is the third route (docs/food-drinks-module-
// plan.md's D3): the question unlocks for whoever currently holds ANY
// task granting that permission module in this community — placement
// deliberately not narrowing it, since a sensitive answer is one
// community record.
export const sensitiveFieldAccessRule = pgTable("sensitive_field_access_rule", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  // Not nullable as of 0080. This table was originally "a rule names
  // one of four fixed member columns", then became "a column *or* a
  // profile question" with fieldKey nullable, and is now
  // question-only: the four columns it could name are gone. That is not
  // a loss of expressiveness — an enum could only ever name those four,
  // and a question can carry any of them and more, with a per-answer
  // share switch, indicators, emergency reveal and consent gating that
  // the columns never had.
  questionId: uuid("question_id")
    .notNull()
    .references(() => profileQuestion.id),
  unlockedByTaskId: uuid("unlocked_by_task_id").references(() => task.id),
  unlockedByTierId: uuid("unlocked_by_tier_id").references(() => tier.id),
  unlockedByGrantModuleKey: permissionGrantModuleEnum("unlocked_by_grant_module_key"),
});
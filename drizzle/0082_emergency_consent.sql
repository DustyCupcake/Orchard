-- Emergency access now asks, the same way widening an audience asks.
--
-- `emergency_access` is a mutable flag and `updateProfileQuestion` writes it
-- directly, so turning it ON for a question that already had answers made
-- every one of them reachable in a crisis by an Admin's click, with the
-- people who had answered never asked. That is the same class of problem
-- `profile_answer_rule_consent` was added in 0081 to close for audiences:
-- an Admin widening a read surface over answers given under a narrower one.
--
-- The fix is per-answer rather than per (answer, rule), unlike 0081's table.
-- Emergency access is a single route, not a set of audiences, so there is
-- nothing for finer granularity to distinguish -- "I agree to this being
-- reachable if someone activates emergency mode on my page" is one fact
-- about a person. Reusing the rule table would have meant either a nullable
-- `rule_id` with a magic value for "the emergency route", or a sentinel rule
-- row that is not a rule. A column says what it is.
--
-- Why the column and not the same treatment as `share_with_audience`: this
-- one is written by an Admin's action rather than by the member, so it
-- cannot simply default to true and stay true. It is written at answer time
-- from the question's own flag, and *reset to false* when the flag is turned
-- on for pre-existing answers.
--
-- The backfill does that reset, which is the load-bearing part of this
-- migration rather than a mechanical detail. A Community that already had
-- emergency access switched on has answers nobody agreed to have that
-- reach: backfilling true would grant it silently and retroactively, which
-- is exactly what this column exists to prevent. False is the fail-closed
-- direction and it is honest about the state -- those members see a prompt
-- on their profile and the reach arrives when they say yes, or doesn't.
--
-- Two populations are deliberately left at true:
--
--   - answers that already un-ticked `share_with_audience`. Un-ticking
--     already means "emergency-only", so it *is* the agreement, and
--     emergency access changing from off to on alters nothing about their
--     exposure. Asking again would be asking about something they chose.
--
--   - declines and deferrals. Neither holds a value, so neither is
--     something to reach. `listEmergencyAnswers` filters on real answers and
--     this migration filters the same way rather than touching rows that
--     were never readable in the first place.
ALTER TABLE "profile_answer" ADD COLUMN "emergency_consent" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE "profile_answer" AS a
   SET "emergency_consent" = false
  FROM "profile_question" AS q
 WHERE q.id = a."question_id"
   AND q."emergency_access" = true
   AND q."sensitive" = true
   AND q."archived_at" IS NULL
   AND a."status" = 'answered'
   AND a."share_with_audience" = true
   AND a."cycle_id" IS NULL;

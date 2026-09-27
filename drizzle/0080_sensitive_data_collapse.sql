-- Collapse the two sensitive-data systems into one.
--
-- There were two. The four fixed `member` columns (health_conditions,
-- allergies, emergency_contact, orientation) had a module toggle, a
-- roster grid at /sensitive-data, and exactly one live reader between
-- them -- the kitchen's dietary panel, for allergies. Sensitive profile
-- questions had a per-answer audience, indicators, emergency reveal and a
-- consent gate, and *no* cross-member read surface anywhere: the one
-- production caller of resolveReadableQuestions passed the viewer as the
-- owner, so the audience ladder short-circuited on every real request and
-- `sensitive` performed no restriction at all. The two shared this rule
-- table and nothing else, which is how an allergy came to be recordable
-- in two places and readable from one.
--
-- The questions are the general mechanism and the columns were four
-- hardcoded text fields, so the questions win. Nothing is lost: an enum
-- could only ever name those four, whereas a question carries any of them
-- plus a share switch, an audience chosen from three routes, emergency
-- eligibility and consent gating.
--
-- No data migration. This ran on a deployment with no community holding
-- values in the four columns, which was checked before writing this
-- rather than assumed; had there been any, the values would have become
-- answers to seeded questions first. The rule is that the two-place
-- allergy record is worse than a small amount of manual re-entry, but
-- only once there is nothing to re-enter.

-- 1. The rules themselves. question_id is now the only target, and NOT
--    NULL so the "which of two things does this rule name" question the
--    application layer has been answering in code can no longer arise
--    from a row written by hand or by a future migration.
ALTER TABLE "sensitive_field_access_rule" DROP COLUMN "field_key";--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ALTER COLUMN "question_id" SET NOT NULL;--> statement-breakpoint

-- 2. The consent pointer, same story: one target, and the question one
--    was already present. consent_record rows are untouched -- a purpose
--    is a purpose whatever it gates, and the notice text a member agreed
--    to is the same text either way.
ALTER TABLE "consent_purpose" DROP COLUMN "gates_sensitive_field";--> statement-breakpoint

-- 3. The columns, and the enum that named them. The enum goes last
--    because the two ALTERs above referenced it via the column types.
ALTER TABLE "member" DROP COLUMN "health_conditions";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "allergies";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "emergency_contact";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "orientation";--> statement-breakpoint
DROP TYPE "sensitive_field_key";

-- The `sensitive_data` module key is left in communities.modules_enabled
-- for existing rows rather than stripped: it is a text[] of keys, an
-- unknown entry renders no checkbox and gates nothing now that
-- MODULE_DEFINITIONS no longer registers it, and rewriting the array
-- would be a second statement touching every community for no reader's
-- benefit. A community that wants it gone can turn it off, and the
-- Modules tab simply no longer offers it.

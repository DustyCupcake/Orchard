-- Retire per-question indicator consent, and with it the nagging it caused.
--
-- Every one of these was built, then removed: the indicator_consent enum,
-- the pendingConsent count, the "asked whether to be counted" coverage
-- line, the /questions consent-request section, and the Dashboard's
-- consent element. They solved a problem that section-level consent
-- makes impossible -- and were triggered by an *admin's* action, so a
-- member could be re-asked about a question they had already answered
-- because somebody in settings ticked a box.
--
-- The consent a member gives is now to the publishable-questions section,
-- once, and covers every answer they give there including to questions
-- added later. A question can only enter that section at creation, so the
-- consent always predates the answer and is never re-asked. The one event
-- that does re-open it is widening a *sensitive* question's audience, and
-- only for the member whose answer it is.
--
-- excluded_from_indicators goes the same way: it is now
-- consents_to_community_indicators on the other side of the default.
--
-- Dropped rather than left unused, so neither can be read as still
-- supported.
--
ALTER TABLE "member" DROP COLUMN "excluded_from_indicators";--> statement-breakpoint
ALTER TABLE "profile_answer" DROP COLUMN "indicator_consent";--> statement-breakpoint
DROP TYPE "public"."indicator_consent";
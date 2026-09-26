-- Whether a community's published indicators may be read for one cycle's
-- attendees, and the population floor below which they may not.
--
-- An event population is both small and identifiable — you know exactly
-- who is coming, so "1 of 8 · 13%" is one person where "1 of 40" is a
-- rounding error. Indicators are deliberately never permission-gated, so
-- consent is what protects an individual answer, and consent can't stop
-- someone being the only member in a category. This is the remaining
-- lever: a community-level decision about when a population is big
-- enough to break out at all.
--
-- Named cycle_* rather than event_* to match the rest of the schema,
-- where `cycle` is the internal term for an event throughout.
ALTER TABLE "community" ADD COLUMN "cycle_indicators_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "cycle_indicators_min_members" integer DEFAULT 10 NOT NULL;
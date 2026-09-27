-- The demographic question category dissolves; publication becomes a
-- capability of public questions; the audience-consent gap closes.
--
-- 1. Drop `member.consents_to_community_indicators` and
--    `community.cycle_indicators_min_members`.
--
--    The consent was never a publication consent. An indicator is an
--    aggregate of answers the whole Community can already read
--    individually, so publishing one discloses nothing the underlying data
--    doesn't already say -- which is what made the demographic category
--    unnecessary in the first place. With that category gone, the consent
--    only ever governed whether a member was *counted* in a chart of data
--    already visible to them, and the decline (`allowPreferNotToSay`,
--    which publication still requires) is the remaining lever.
--
--    The floor guarded breaking an indicator out for one event when the
--    attendee count was small. For a public question the breakdown is
--    derivable from the public per-person answers and the participation
--    list, so it guarded nothing. Its one remaining catch -- a *declined*
--    answer in a small population, where "1 of 3" identifies who didn't
--    say -- is a consequence of counting declines rather than of the
--    floor, so dropping the floor would have dropped a guard without
--    dropping the thing it guarded. Recorded here rather than silently
--    reasoned away, because it is a decision and not a cleanup.
--
--    `cycle_indicators_enabled` stays: it is the on/off for per-event
--    breakdowns, which is a different decision from the headcount floor.
--
-- 2. Add `profile_answer_rule_consent`.
--
--    An access rule says who MAY read a sensitive question; this says who
--    has agreed to be read. The gap was an audience being widened on a
--    question that already had answers: the rule immediately reached every
--    answer given before it existed, with no consent from anyone. The
--    existing `share_with_audience` flag cannot express the difference,
--    because it is one boolean for the whole audience -- false would hide
--    the answer from the *original* audience too, which is a narrowing
--    nobody asked for. So consent is per (answer, rule), the read side
--    requires a row, and a rule added later only reaches answers given
--    after it existed until each member extends sharing.
--
-- No data is lost: the dropped columns held no answers, and the new table
-- is empty. `sensitive` is not touched here -- it is already a column and
-- already enforced to require an access rule; what changes is that it
-- becomes immutable after creation, which is an application-layer rule
-- rather than a schema one.
ALTER TABLE "member" DROP COLUMN "consents_to_community_indicators";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "cycle_indicators_min_members";--> statement-breakpoint
CREATE TABLE "profile_answer_rule_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"answer_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_answer_rule_consent_answer_id_profile_answer_id_fk" FOREIGN KEY ("answer_id") REFERENCES "public"."profile_answer"("id") ON DELETE cascade,
	CONSTRAINT "profile_answer_rule_consent_rule_id_sensitive_field_access_rule_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."sensitive_field_access_rule"("id") ON DELETE cascade ON UPDATE no action
);--> statement-breakpoint
CREATE UNIQUE INDEX "profile_answer_rule_consent_answer_id_rule_id_unique" ON "profile_answer_rule_consent" USING btree ("answer_id","rule_id");--> statement-breakpoint
CREATE INDEX "profile_answer_rule_consent_rule_id_idx" ON "profile_answer_rule_consent" USING btree ("rule_id");

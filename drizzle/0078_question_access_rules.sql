-- Let an access rule and a consent purpose name a *question*, not just one
-- of the four fixed member columns.
--
-- sensitive_field_access_rule went from "a rule names one of four fixed
-- member columns" to "a rule names a fixed member column or a profile
-- question", because a community's own questions are where the sensitive
-- data actually lives and an enum cannot name one. field_key becomes
-- nullable rather than disappearing: the four member columns are
-- docs/spec.md's fixed set and stay exactly as they were, and questions
-- are additive beside them. Exactly one of the two is set per row,
-- enforced in src/lib/sensitive-data.ts the same way the three unlock
-- routes already were.
--
-- consent_purpose gains the same second target. Consent stays keyed by
-- legal purpose -- that is the shape of consent_record and it is not
-- changing -- so this only widens *what a purpose can gate*. No
-- consent_record row changes shape or meaning: a purpose is a purpose
-- whatever it gates, and the notice text a member agreed to is the same
-- text either way.
--
-- share_with_audience is the member's own per-answer lever on a
-- sensitive question: un-ticking reduces the answer to emergency-only
-- while keeping it on their profile. Defaults TRUE because the exposure
-- is already bounded by the access rules, so the safe choice is the one
-- people have to remember to take. Meaningless on a non-sensitive
-- question, and the answer writer forces it back to true there so the
-- column can never disagree with the question it belongs to.
--
ALTER TABLE "sensitive_field_access_rule" ALTER COLUMN "field_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_answer" ADD COLUMN "share_with_audience" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD COLUMN "question_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_purpose" ADD COLUMN "gates_question_id" uuid;--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD CONSTRAINT "sensitive_field_access_rule_question_id_profile_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."profile_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_purpose" ADD CONSTRAINT "consent_purpose_gates_question_id_profile_question_id_fk" FOREIGN KEY ("gates_question_id") REFERENCES "public"."profile_question"("id") ON DELETE no action ON UPDATE no action;
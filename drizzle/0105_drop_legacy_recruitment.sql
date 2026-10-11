ALTER TABLE "joining_lane" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "joining_lane" CASCADE;--> statement-breakpoint
ALTER TABLE "recruitment_decision" DROP CONSTRAINT "recruitment_decision_intro_call_token_unique";--> statement-breakpoint
ALTER TABLE "scheduling_entry" DROP CONSTRAINT "scheduling_entry_form_response_id_form_response_id_fk";
--> statement-breakpoint
ALTER TABLE "recruitment_decision" DROP CONSTRAINT "recruitment_decision_intro_call_poll_id_scheduling_poll_id_fk";
--> statement-breakpoint
ALTER TABLE "recruitment_pair" DROP CONSTRAINT "recruitment_pair_first_response_id_form_response_id_fk";
--> statement-breakpoint
ALTER TABLE "recruitment_pair" DROP CONSTRAINT "recruitment_pair_second_response_id_form_response_id_fk";
--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "recruitment_evaluator_count";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "recruitment_decision_rules";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "recruitment_subscription_lapse_threshold";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "recruitment_nomination_window_hours";--> statement-breakpoint
ALTER TABLE "member" DROP COLUMN "joined_via_invite_id";--> statement-breakpoint
ALTER TABLE "scheduling_entry" DROP COLUMN "form_response_id";--> statement-breakpoint
ALTER TABLE "admission" DROP COLUMN "subscription_lapse_processed_at";--> statement-breakpoint
ALTER TABLE "recruitment_decision" DROP COLUMN "intro_call_poll_id";--> statement-breakpoint
ALTER TABLE "recruitment_decision" DROP COLUMN "intro_call_token";--> statement-breakpoint
ALTER TABLE "recruitment_decision" DROP COLUMN "subscription_lapse_processed_at";--> statement-breakpoint
ALTER TABLE "recruitment_pair" DROP COLUMN "first_response_id";--> statement-breakpoint
ALTER TABLE "recruitment_pair" DROP COLUMN "second_response_id";--> statement-breakpoint
ALTER TABLE "recruitment_subscription" DROP COLUMN "consecutive_no_availability_count";--> statement-breakpoint
DROP TYPE "public"."joining_lane_kind";--> statement-breakpoint
DROP TYPE "public"."joining_verification_mode";
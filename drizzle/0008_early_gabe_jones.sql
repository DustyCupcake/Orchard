CREATE TYPE "public"."capacity_visibility" AS ENUM('flag_only', 'open');--> statement-breakpoint
CREATE TYPE "public"."profile_answer_status" AS ENUM('answered', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."profile_question_response_type" AS ENUM('free_text', 'single_choice', 'multi_choice');--> statement-breakpoint
CREATE TYPE "public"."profile_question_scope" AS ENUM('once_ever', 'per_cycle', 'phase');--> statement-breakpoint
CREATE TABLE "profile_answer" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"status" "profile_answer_status" DEFAULT 'answered' NOT NULL,
	"value" jsonb,
	"capacity_visibility" "capacity_visibility" DEFAULT 'flag_only' NOT NULL,
	"cycle_id" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"label" text NOT NULL,
	"response_type" "profile_question_response_type" DEFAULT 'free_text' NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"scope" "profile_question_scope" DEFAULT 'once_ever' NOT NULL,
	"phase_name_hint" text,
	"required" boolean DEFAULT false NOT NULL,
	"feeds_capacity_signal" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "profile_answer" ADD CONSTRAINT "profile_answer_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_answer" ADD CONSTRAINT "profile_answer_question_id_profile_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."profile_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_answer" ADD CONSTRAINT "profile_answer_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_question" ADD CONSTRAINT "profile_question_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."question_response_type" AS ENUM('free_text', 'single_choice', 'multi_choice');--> statement-breakpoint
CREATE TABLE "input_round" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cutoff_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"asked_by" uuid NOT NULL,
	"text" text NOT NULL,
	"response_type" "question_response_type" DEFAULT 'free_text' NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"deadline" timestamp with time zone,
	"priority" boolean DEFAULT false NOT NULL,
	"round_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "question_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "next_input_round_cutoff_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "input_round" ADD CONSTRAINT "input_round_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_asked_by_member_id_fk" FOREIGN KEY ("asked_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question" ADD CONSTRAINT "question_round_id_input_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."input_round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_response" ADD CONSTRAINT "question_response_question_id_question_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_response" ADD CONSTRAINT "question_response_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
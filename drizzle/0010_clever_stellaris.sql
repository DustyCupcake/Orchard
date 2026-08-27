CREATE TYPE "public"."assembly_question_response_type" AS ENUM('free_text', 'single_choice', 'multi_choice');--> statement-breakpoint
CREATE TABLE "assembly" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"agenda_ends_at" timestamp with time zone NOT NULL,
	"notice_ends_at" timestamp with time zone NOT NULL,
	"voting_ends_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_question" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"text" text NOT NULL,
	"response_type" "assembly_question_response_type" DEFAULT 'free_text' NOT NULL,
	"options" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assembly_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assembly_question_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"value" jsonb NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assembly" ADD CONSTRAINT "assembly_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly" ADD CONSTRAINT "assembly_proposed_by_member_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_question" ADD CONSTRAINT "assembly_question_assembly_id_assembly_id_fk" FOREIGN KEY ("assembly_id") REFERENCES "public"."assembly"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_question" ADD CONSTRAINT "assembly_question_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_response" ADD CONSTRAINT "assembly_response_assembly_question_id_assembly_question_id_fk" FOREIGN KEY ("assembly_question_id") REFERENCES "public"."assembly_question"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assembly_response" ADD CONSTRAINT "assembly_response_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
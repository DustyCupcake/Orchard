CREATE TYPE "public"."recruitment_decision_leaning" AS ENUM('proceed', 'decline');--> statement-breakpoint
CREATE TYPE "public"."recruitment_decision_outcome" AS ENUM('proceed', 'wider_discussion', 'decline');--> statement-breakpoint
CREATE TYPE "public"."recruitment_decision_resolution" AS ENUM('accepted', 'declined');--> statement-breakpoint
CREATE TABLE "objection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"raised_by" uuid NOT NULL,
	"note" text NOT NULL,
	"raised_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_decision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"rule_outcome" "recruitment_decision_outcome" NOT NULL,
	"default_resolution" "recruitment_decision_leaning",
	"resolution" "recruitment_decision_resolution",
	"wider_discussion_deadline" timestamp with time zone,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"intro_call_poll_id" uuid,
	"intro_call_token" text,
	"accompaniment_task_id" uuid,
	CONSTRAINT "recruitment_decision_form_response_id_unique" UNIQUE("form_response_id"),
	CONSTRAINT "recruitment_decision_intro_call_token_unique" UNIQUE("intro_call_token")
);
--> statement-breakpoint
ALTER TABLE "scheduling_entry" ALTER COLUMN "member_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_wider_discussion_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_rejection_template" text;--> statement-breakpoint
ALTER TABLE "scheduling_entry" ADD COLUMN "form_response_id" uuid;--> statement-breakpoint
ALTER TABLE "objection" ADD CONSTRAINT "objection_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection" ADD CONSTRAINT "objection_raised_by_member_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD CONSTRAINT "recruitment_decision_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD CONSTRAINT "recruitment_decision_intro_call_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("intro_call_poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_decision" ADD CONSTRAINT "recruitment_decision_accompaniment_task_id_task_id_fk" FOREIGN KEY ("accompaniment_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_entry" ADD CONSTRAINT "scheduling_entry_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;
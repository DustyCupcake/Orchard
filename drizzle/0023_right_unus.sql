CREATE TYPE "public"."recruitment_recommendation" AS ENUM('proceed', 'decline', 'unsure');--> statement-breakpoint
CREATE TABLE "evaluation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"evaluator_id" uuid NOT NULL,
	"recommendation" "recruitment_recommendation" NOT NULL,
	"notes" text,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_application_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"community_invite_id" uuid NOT NULL,
	CONSTRAINT "recruitment_application_invite_form_response_id_unique" UNIQUE("form_response_id")
);
--> statement-breakpoint
CREATE TABLE "recruitment_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"consecutive_no_availability_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "recruitment_subscription_member_id_unique" UNIQUE("member_id")
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_application_form_id" uuid;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_evaluator_count" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_decision_rules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_subscription_lapse_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation" ADD CONSTRAINT "evaluation_evaluator_id_member_id_fk" FOREIGN KEY ("evaluator_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_application_invite" ADD CONSTRAINT "recruitment_application_invite_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_application_invite" ADD CONSTRAINT "recruitment_application_invite_community_invite_id_community_invite_id_fk" FOREIGN KEY ("community_invite_id") REFERENCES "public"."community_invite"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_subscription" ADD CONSTRAINT "recruitment_subscription_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
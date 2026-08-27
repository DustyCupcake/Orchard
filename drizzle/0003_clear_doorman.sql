CREATE TYPE "public"."task_proposal_status" AS ENUM('pending', 'activated', 'declined');--> statement-breakpoint
CREATE TABLE "task_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"submitted_by" uuid NOT NULL,
	"wants_to_claim" boolean DEFAULT false NOT NULL,
	"suggested_member_id" uuid,
	"suggested_member_note" text,
	"status" "task_proposal_status" DEFAULT 'pending' NOT NULL,
	"decline_reason" text,
	"activated_task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_submitted_by_member_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_suggested_member_id_member_id_fk" FOREIGN KEY ("suggested_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_activated_task_id_task_id_fk" FOREIGN KEY ("activated_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;
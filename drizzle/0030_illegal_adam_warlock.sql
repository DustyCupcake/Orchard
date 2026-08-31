CREATE TYPE "public"."milestone_anchor_type" AS ENUM('phase_start', 'phase_end', 'cycle_start', 'cycle_end');--> statement-breakpoint
CREATE TYPE "public"."task_milestone_status" AS ENUM('confirmed', 'pending');--> statement-breakpoint
CREATE TABLE "task_milestone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"label" text NOT NULL,
	"date_type" date_type DEFAULT 'absolute' NOT NULL,
	"absolute_date" date,
	"relative_mode" date_relative_mode,
	"anchor_type" "milestone_anchor_type",
	"offset_days" integer,
	"percent" integer,
	"phase_id" uuid,
	"status" "task_milestone_status" DEFAULT 'confirmed' NOT NULL,
	"proposed_by" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_milestone" ADD CONSTRAINT "task_milestone_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD CONSTRAINT "task_milestone_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD CONSTRAINT "task_milestone_proposed_by_member_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD CONSTRAINT "task_milestone_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."shift_signup_status" AS ENUM('signed_up', 'completed', 'no_show');--> statement-breakpoint
CREATE TABLE "shift_occurrence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"series_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"capacity" integer
);
--> statement-breakpoint
CREATE TABLE "shift_series" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"branch_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"default_capacity" integer NOT NULL,
	"source_task_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "shift_signup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurrence_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "shift_signup_status" DEFAULT 'signed_up' NOT NULL,
	"signed_up_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shift_occurrence" ADD CONSTRAINT "shift_occurrence_series_id_shift_series_id_fk" FOREIGN KEY ("series_id") REFERENCES "public"."shift_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_source_task_id_task_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_signup" ADD CONSTRAINT "shift_signup_occurrence_id_shift_occurrence_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."shift_occurrence"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_signup" ADD CONSTRAINT "shift_signup_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
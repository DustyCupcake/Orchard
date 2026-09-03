CREATE TYPE "public"."engagement_event_kind" AS ENUM('task_nomination_expired', 'nudge_ignored', 'call_summary_unread_past_window');--> statement-breakpoint
CREATE TABLE "engagement_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" "engagement_event_kind" NOT NULL,
	"task_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "engagement_soft_flag_threshold" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "engagement_pattern_threshold" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "call_summary_read_window_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "call_summary" ADD COLUMN "engagement_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "engagement_event" ADD CONSTRAINT "engagement_event_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_event" ADD CONSTRAINT "engagement_event_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;
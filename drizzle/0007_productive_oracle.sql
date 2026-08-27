CREATE TYPE "public"."task_signal_kind" AS ENUM('stalled', 'might_need_help', 'something_feels_off', 'worth_a_look');--> statement-breakpoint
CREATE TABLE "task_signal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"kind" "task_signal_kind" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coordinator_ping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "coordination_tag" text DEFAULT 'coordination' NOT NULL;--> statement-breakpoint
ALTER TABLE "task_signal" ADD CONSTRAINT "task_signal_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_ping" ADD CONSTRAINT "coordinator_ping_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coordinator_ping" ADD CONSTRAINT "coordinator_ping_requested_by_member_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
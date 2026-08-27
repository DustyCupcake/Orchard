CREATE TYPE "public"."task_source_poll_role" AS ENUM('facilitate', 'summary');--> statement-breakpoint
CREATE TYPE "public"."poll_resolution_mode" AS ENUM('must_overlap', 'max_attendance');--> statement-breakpoint
CREATE TABLE "scheduling_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"available_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduling_poll" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"title" text NOT NULL,
	"organized_by" uuid NOT NULL,
	"resolution_mode" "poll_resolution_mode" NOT NULL,
	"required_participant_ids" uuid[] DEFAULT '{}' NOT NULL,
	"min_attendance" integer,
	"range_start" date NOT NULL,
	"range_end" date NOT NULL,
	"has_agenda" boolean DEFAULT false NOT NULL,
	"needs_summary" boolean DEFAULT false NOT NULL,
	"require_read" boolean DEFAULT false NOT NULL,
	"confirmed_slot_start" timestamp with time zone,
	"confirmed_slot_end" timestamp with time zone,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_agenda_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_summary" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"published_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "call_summary_read" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"summary_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"poll_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"attended" boolean NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_poll_id" uuid;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "source_poll_role" "task_source_poll_role";--> statement-breakpoint
ALTER TABLE "scheduling_entry" ADD CONSTRAINT "scheduling_entry_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_entry" ADD CONSTRAINT "scheduling_entry_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_poll" ADD CONSTRAINT "scheduling_poll_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_poll" ADD CONSTRAINT "scheduling_poll_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_poll" ADD CONSTRAINT "scheduling_poll_organized_by_member_id_fk" FOREIGN KEY ("organized_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_poll" ADD CONSTRAINT "scheduling_poll_confirmed_by_member_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_agenda_item" ADD CONSTRAINT "call_agenda_item_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_agenda_item" ADD CONSTRAINT "call_agenda_item_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_summary" ADD CONSTRAINT "call_summary_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_summary_read" ADD CONSTRAINT "call_summary_read_summary_id_call_summary_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."call_summary"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_summary_read" ADD CONSTRAINT "call_summary_read_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_attendance" ADD CONSTRAINT "poll_attendance_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_attendance" ADD CONSTRAINT "poll_attendance_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "poll_attendance" ADD CONSTRAINT "poll_attendance_recorded_by_member_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_source_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("source_poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;
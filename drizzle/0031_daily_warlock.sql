CREATE TYPE "public"."calendar_event_invite_status" AS ENUM('invited', 'confirmed', 'declined');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_share_target" AS ENUM('personal', 'branch', 'community');--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"cycle_id" uuid,
	"share_target" "calendar_event_share_target" DEFAULT 'personal' NOT NULL,
	"shared_branch_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"date_type" date_type DEFAULT 'absolute' NOT NULL,
	"date" date,
	"relative_mode" date_relative_mode,
	"anchor_type" "cycle_offset_anchor",
	"offset_days" integer,
	"percent" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_event_invite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "calendar_event_invite_status" DEFAULT 'invited' NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_shared_branch_id_branch_id_fk" FOREIGN KEY ("shared_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_invite" ADD CONSTRAINT "calendar_event_invite_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_invite" ADD CONSTRAINT "calendar_event_invite_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event_invite" ADD CONSTRAINT "calendar_event_invite_invited_by_member_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
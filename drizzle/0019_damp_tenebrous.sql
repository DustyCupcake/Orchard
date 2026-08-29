CREATE TYPE "public"."event_proposal_status" AS ENUM('proposed', 'conflict', 'confirmed', 'declined');--> statement-breakpoint
CREATE TABLE "event_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"submitted_by" uuid NOT NULL,
	"host" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"space_needs" text,
	"preferred_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "event_proposal_status" DEFAULT 'proposed' NOT NULL,
	"confirmed_slot" jsonb,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_proposal_conflict_ping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "event_scheduling_owner_task_id" uuid;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD CONSTRAINT "event_proposal_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD CONSTRAINT "event_proposal_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal" ADD CONSTRAINT "event_proposal_submitted_by_member_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal_conflict_ping" ADD CONSTRAINT "event_proposal_conflict_ping_proposal_id_event_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."event_proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal_conflict_ping" ADD CONSTRAINT "event_proposal_conflict_ping_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."outbound_message_scope" AS ENUM('branch', 'task_holders', 'arrival_window', 'community');--> statement-breakpoint
CREATE TABLE "outbound_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"sent_by" uuid NOT NULL,
	"scope" "outbound_message_scope" NOT NULL,
	"scope_ref" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "announcement_task_id" uuid;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "email_notifications_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbound_message" ADD CONSTRAINT "outbound_message_sent_by_member_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "view_as_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activated_by" uuid NOT NULL,
	"target_member_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "support_tag" text DEFAULT 'support' NOT NULL;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "viewing_as_member_id" uuid;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "viewing_as_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "view_as_log" ADD CONSTRAINT "view_as_log_activated_by_member_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_as_log" ADD CONSTRAINT "view_as_log_target_member_id_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_viewing_as_member_id_member_id_fk" FOREIGN KEY ("viewing_as_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
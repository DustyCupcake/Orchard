CREATE TYPE "public"."participation_status" AS ENUM('unknown', 'coming', 'maybe', 'not_coming');--> statement-breakpoint
CREATE TABLE "participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "participation_status" DEFAULT 'unknown' NOT NULL,
	"arrival_date" date,
	"departure_date" date,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
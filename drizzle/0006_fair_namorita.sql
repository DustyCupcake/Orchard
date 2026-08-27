CREATE TYPE "public"."browse_interest_status" AS ENUM('open', 'confirmed', 'failed');--> statement-breakpoint
CREATE TABLE "browse_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"expressed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reached_out" boolean DEFAULT false NOT NULL,
	"status" "browse_interest_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "endorsement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"browse_interest_id" uuid NOT NULL,
	"endorsed_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "admins_tag" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "admins_ever_claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "browse_interest" ADD CONSTRAINT "browse_interest_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browse_interest" ADD CONSTRAINT "browse_interest_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsement" ADD CONSTRAINT "endorsement_browse_interest_id_browse_interest_id_fk" FOREIGN KEY ("browse_interest_id") REFERENCES "public"."browse_interest"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsement" ADD CONSTRAINT "endorsement_endorsed_by_member_id_fk" FOREIGN KEY ("endorsed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
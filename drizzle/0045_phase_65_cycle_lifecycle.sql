ALTER TABLE "cycle" ADD COLUMN "closed_by" uuid;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "last_viewed_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD COLUMN "owner_marked_done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_closed_by_member_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
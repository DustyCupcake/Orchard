ALTER TYPE "public"."permission_grant_module" ADD VALUE 'shift_management';--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "shift_signups_opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift_series" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "shift_series" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shift_series" ADD CONSTRAINT "shift_series_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;
ALTER TABLE "scheduling_entry" ADD COLUMN "arrival_id" uuid;--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "interview_poll_id" uuid;--> statement-breakpoint
ALTER TABLE "admission" ADD COLUMN "subscription_lapse_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_interview_poll_id_scheduling_poll_id_fk" FOREIGN KEY ("interview_poll_id") REFERENCES "public"."scheduling_poll"("id") ON DELETE no action ON UPDATE no action;
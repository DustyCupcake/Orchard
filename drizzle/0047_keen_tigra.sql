ALTER TABLE "task_proposal" ADD COLUMN "suggested_branch_id" uuid;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_effort" "task_effort";--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_effort_magnitude" jsonb;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_tags" text[];--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_capacity" integer;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_critical" boolean;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_due_date" date;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_suggested_branch_id_branch_id_fk" FOREIGN KEY ("suggested_branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_proposal" ADD CONSTRAINT "task_proposal_suggested_cycle_id_cycle_id_fk" FOREIGN KEY ("suggested_cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;
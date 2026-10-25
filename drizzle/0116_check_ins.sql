ALTER TABLE "community" ADD COLUMN "accompaniment_check_ins" jsonb DEFAULT '[{"label":"Say hello","anchor":"after_joining","days":3},{"label":"How is it going?","anchor":"after_joining","days":30},{"label":"Before the event","anchor":"before_event","days":14}]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "check_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "completed_by" uuid;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD CONSTRAINT "task_milestone_completed_by_member_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
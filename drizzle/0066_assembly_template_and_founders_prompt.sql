ALTER TABLE "community" ADD COLUMN "founders_assembly_prompted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "assembly" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "settings_mapping" text;
ALTER TABLE "phase" ADD COLUMN "highlight_module_key" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "pinned_module_keys" text[] DEFAULT '{}' NOT NULL;
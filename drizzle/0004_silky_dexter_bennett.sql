ALTER TABLE "community" ADD COLUMN "staleness_soft_days" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "staleness_hard_days" integer DEFAULT 14 NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "task" ADD COLUMN "status_changed_at" timestamp with time zone DEFAULT now() NOT NULL;
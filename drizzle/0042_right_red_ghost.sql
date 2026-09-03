ALTER TABLE "member" ADD COLUMN "has_completed_onboarding" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "surfaces" text[] DEFAULT '{}' NOT NULL;
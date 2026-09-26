CREATE TYPE "public"."indicator_visibility" AS ENUM('public', 'coordination');--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "published_as_indicator" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "indicator_visibility" "indicator_visibility" DEFAULT 'public' NOT NULL;
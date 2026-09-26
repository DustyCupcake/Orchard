ALTER TYPE "public"."profile_answer_status" ADD VALUE 'declined';--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "allow_prefer_not_to_say" boolean DEFAULT false NOT NULL;
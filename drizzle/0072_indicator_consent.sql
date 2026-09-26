CREATE TYPE "public"."indicator_consent" AS ENUM('pending', 'granted', 'refused');--> statement-breakpoint
ALTER TABLE "profile_answer" ADD COLUMN "indicator_consent" "indicator_consent";
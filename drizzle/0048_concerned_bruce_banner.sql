CREATE TYPE "public"."member_language_level" AS ENUM('basic', 'conversational', 'fluent', 'native');--> statement-breakpoint
CREATE TABLE "member_language" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"language" text NOT NULL,
	"level" "member_language_level" DEFAULT 'conversational' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_language" ADD CONSTRAINT "member_language_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
-- The field-shape change (src/lib/field-shape.ts): six response types
-- with orthogonal per-type flags, replacing four types where one of them
-- ("free_text") described neither its length nor anything else useful.
--
-- This file is drizzle-generated and then hand-reordered, because the
-- generated order can't run: it sets the column's DEFAULT to 'text'
-- before 'text' exists in the enum, and it casts the column back to a
-- rebuilt enum while rows still hold the retired 'free_text'. Both need
-- the column detached to plain `text` first, at which point the backfill
-- is just a string UPDATE and no ALTER TYPE ... ADD VALUE is involved at
-- all — which also matters because drizzle runs all pending migrations
-- in ONE transaction, where a just-added enum value cannot be used.
-- Detaching sidesteps that constraint entirely.
--
-- Order matters:
--   1. new columns (so `multiline` exists for the backfill to set)
--   2. detach response_type to text — data survives as plain strings
--   3. drop the default: a text-typed default can't be cast implicitly
--      back to an enum, so it has to go before the re-attach
--   4. backfill rows, now unconstrained
--   5. rebuild the enum without 'free_text'
--   6. re-attach, then restore the default as a real enum literal
-- The format checks a text field can apply to its own value, declared
-- here rather than relying on drizzle's generated text column: a typo'd
-- validation would otherwise store happily and then be silently ignored
-- by validateFieldValue, which is exactly the kind of setting that looks
-- configured and does nothing. The later migrations (0068) reuse this
-- same type for task questions and assembly items.
CREATE TYPE "public"."text_validation" AS ENUM('none', 'email', 'phone', 'url');--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "multiline" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "validation" text_validation DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "allow_other" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "min" integer;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "max" integer;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "step" integer;--> statement-breakpoint
ALTER TABLE "public"."profile_question" ALTER COLUMN "response_type" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "profile_question" ALTER COLUMN "response_type" DROP DEFAULT;--> statement-breakpoint
UPDATE "profile_question" SET "response_type" = 'text', "multiline" = true WHERE "response_type" = 'free_text';--> statement-breakpoint
UPDATE "form" SET "fields" = COALESCE((SELECT jsonb_agg(CASE WHEN field->>'responseType' = 'free_text' THEN jsonb_set(field, '{responseType}', '"text"'::jsonb) || jsonb_build_object('multiline', true) ELSE field END) FROM jsonb_array_elements("fields") AS field), '[]'::jsonb) WHERE jsonb_typeof("fields") = 'array';--> statement-breakpoint
DROP TYPE "public"."profile_question_response_type";--> statement-breakpoint
CREATE TYPE "public"."profile_question_response_type" AS ENUM('text', 'single_choice', 'multi_choice', 'date', 'boolean', 'number');--> statement-breakpoint
ALTER TABLE "public"."profile_question" ALTER COLUMN "response_type" SET DATA TYPE "public"."profile_question_response_type" USING "response_type"::"public"."profile_question_response_type";--> statement-breakpoint
ALTER TABLE "profile_question" ALTER COLUMN "response_type" SET DEFAULT 'text';

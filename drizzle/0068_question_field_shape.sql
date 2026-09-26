-- The same field-shape change (src/lib/field-shape.ts) applied to the
-- other two question systems: task questions (Input rounds) and Assembly
-- agenda items. Both had their own three-value `free_text` enum, their
-- own zod schema, their own validator and their own inline renderer;
-- they now share the six-type union with ProfileQuestion and
-- Form.fields, while keeping their own (deliberately absent) status
-- model — no required, no deferral, no decline, no due date. An input
-- round is an opinion or an offer, and "not answering" is already a
-- complete response to it.
--
-- Hand-reordered for the same reason as 0067, and the reason is written
-- there at length: drizzle runs all pending migrations in ONE
-- transaction, so a value added by ALTER TYPE ... ADD VALUE cannot be
-- used in the same transaction. Detaching each column to plain `text`
-- first makes the backfill an unconstrained string UPDATE and removes
-- that constraint entirely. The old default must be dropped before the
-- column can be re-attached to a rebuilt enum (a text-typed default
-- doesn't implicitly cast to an enum), and restored afterwards.
--
-- `multiline` defaults TRUE here, unlike on profile_question: every one
-- of these rows was `free_text`, which always rendered a textarea, and
-- an input round or agenda answer is usually a sentence. Drizzle
-- generated false (matching profile_question); flipped below.

-- --- task questions (Input rounds) ---
ALTER TABLE "question" ADD COLUMN "multiline" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "validation" text_validation DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "allow_other" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "min" integer;
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "max" integer;
--> statement-breakpoint
ALTER TABLE "question" ADD COLUMN "step" integer;
--> statement-breakpoint
ALTER TABLE "public"."question" ALTER COLUMN "response_type" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "question" ALTER COLUMN "response_type" DROP DEFAULT;
--> statement-breakpoint
UPDATE "question" SET "response_type" = 'text' WHERE "response_type" = 'free_text';
--> statement-breakpoint
DROP TYPE "public"."question_response_type";
--> statement-breakpoint
CREATE TYPE "public"."question_response_type" AS ENUM('text', 'single_choice', 'multi_choice', 'boolean', 'date', 'number');
--> statement-breakpoint
ALTER TABLE "public"."question" ALTER COLUMN "response_type" SET DATA TYPE "public"."question_response_type" USING "response_type"::"public"."question_response_type";
--> statement-breakpoint
ALTER TABLE "question" ALTER COLUMN "response_type" SET DEFAULT 'text';

-- --- Assembly agenda items ---
ALTER TABLE "assembly_question" ADD COLUMN "multiline" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "validation" text_validation DEFAULT 'none' NOT NULL;
--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "allow_other" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "min" integer;
--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "max" integer;
--> statement-breakpoint
ALTER TABLE "assembly_question" ADD COLUMN "step" integer;
--> statement-breakpoint
ALTER TABLE "public"."assembly_question" ALTER COLUMN "response_type" SET DATA TYPE text;
--> statement-breakpoint
ALTER TABLE "assembly_question" ALTER COLUMN "response_type" DROP DEFAULT;
--> statement-breakpoint
UPDATE "assembly_question" SET "response_type" = 'text' WHERE "response_type" = 'free_text';
--> statement-breakpoint
DROP TYPE "public"."assembly_question_response_type";
--> statement-breakpoint
CREATE TYPE "public"."assembly_question_response_type" AS ENUM('text', 'single_choice', 'multi_choice', 'boolean', 'date', 'number');
--> statement-breakpoint
ALTER TABLE "public"."assembly_question" ALTER COLUMN "response_type" SET DATA TYPE "public"."assembly_question_response_type" USING "response_type"::"public"."assembly_question_response_type";
--> statement-breakpoint
ALTER TABLE "assembly_question" ALTER COLUMN "response_type" SET DEFAULT 'text';


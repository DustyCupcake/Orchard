CREATE TYPE "public"."kitchen_signal" AS ENUM('allergy', 'intolerance', 'dislike');--> statement-breakpoint
CREATE TYPE "public"."meal_slot" AS ENUM('breakfast', 'lunch', 'dinner');--> statement-breakpoint
CREATE TYPE "public"."meal_head_count_source" AS ENUM('manual', 'participation');--> statement-breakpoint
CREATE TABLE "food_idea_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idea_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric,
	"unit" text,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dish_ingredient" ALTER COLUMN "amount" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "profile_question" ADD COLUMN "kitchen_signal" "kitchen_signal";--> statement-breakpoint
ALTER TABLE "participation" ADD COLUMN "arrival_time" time;--> statement-breakpoint
ALTER TABLE "participation" ADD COLUMN "departure_time" time;--> statement-breakpoint
ALTER TABLE "participation" ADD COLUMN "first_meal" "meal_slot";--> statement-breakpoint
ALTER TABLE "participation" ADD COLUMN "last_meal" "meal_slot";--> statement-breakpoint
ALTER TABLE "food_idea" ADD COLUMN "serves" integer;--> statement-breakpoint
ALTER TABLE "food_idea" ADD COLUMN "allergen_flags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "food_idea" ADD COLUMN "dietary_note" text;--> statement-breakpoint
ALTER TABLE "meal" ADD COLUMN "slot" "meal_slot";--> statement-breakpoint
ALTER TABLE "meal" ADD COLUMN "time" time;--> statement-breakpoint
ALTER TABLE "meal" ADD COLUMN "head_count_source" "meal_head_count_source" DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal" ADD COLUMN "guests" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "menu_plan" ADD COLUMN "meal_times" jsonb;--> statement-breakpoint
ALTER TABLE "food_idea_ingredient" ADD CONSTRAINT "food_idea_ingredient_idea_id_food_idea_id_fk" FOREIGN KEY ("idea_id") REFERENCES "public"."food_idea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profile_question_kitchen_signal_unique" ON "profile_question" USING btree ("community_id","kitchen_signal") WHERE "profile_question"."kitchen_signal" is not null and "profile_question"."archived_at" is null;
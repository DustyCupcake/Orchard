CREATE TYPE "public"."dish_source" AS ENUM('seed', 'from_idea');--> statement-breakpoint
CREATE TYPE "public"."food_idea_kind" AS ENUM('recipe_suggestion', 'dish_request', 'preference');--> statement-breakpoint
CREATE TYPE "public"."food_idea_status" AS ENUM('open', 'adopted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."permission_grant_module" ADD VALUE 'kitchen';--> statement-breakpoint
CREATE TABLE "dish" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meal_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"serves" integer,
	"allergen_flags" text[] DEFAULT '{}' NOT NULL,
	"dietary_note" text,
	"source" "dish_source" DEFAULT 'seed' NOT NULL,
	"source_idea_id" uuid,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dish_ingredient" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dish_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount" numeric NOT NULL,
	"unit" text,
	"sort_order" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_idea" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_plan_id" uuid NOT NULL,
	"kind" "food_idea_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"suggested_by" uuid NOT NULL,
	"status" "food_idea_status" DEFAULT 'open' NOT NULL,
	"declined_reason" text,
	"adopted_dish_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"menu_plan_id" uuid NOT NULL,
	"label" text NOT NULL,
	"date" date NOT NULL,
	"phase_id" uuid,
	"head_count" integer,
	"shift_series_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "menu_plan" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD COLUMN "unlocked_by_grant_module_key" "permission_grant_module";--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_meal_id_meal_id_fk" FOREIGN KEY ("meal_id") REFERENCES "public"."meal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_source_idea_id_food_idea_id_fk" FOREIGN KEY ("source_idea_id") REFERENCES "public"."food_idea"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish" ADD CONSTRAINT "dish_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dish_ingredient" ADD CONSTRAINT "dish_ingredient_dish_id_dish_id_fk" FOREIGN KEY ("dish_id") REFERENCES "public"."dish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_idea" ADD CONSTRAINT "food_idea_menu_plan_id_menu_plan_id_fk" FOREIGN KEY ("menu_plan_id") REFERENCES "public"."menu_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_idea" ADD CONSTRAINT "food_idea_suggested_by_member_id_fk" FOREIGN KEY ("suggested_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_idea" ADD CONSTRAINT "food_idea_adopted_dish_id_dish_id_fk" FOREIGN KEY ("adopted_dish_id") REFERENCES "public"."dish"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal" ADD CONSTRAINT "meal_menu_plan_id_menu_plan_id_fk" FOREIGN KEY ("menu_plan_id") REFERENCES "public"."menu_plan"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal" ADD CONSTRAINT "meal_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal" ADD CONSTRAINT "meal_shift_series_id_shift_series_id_fk" FOREIGN KEY ("shift_series_id") REFERENCES "public"."shift_series"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan" ADD CONSTRAINT "menu_plan_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan" ADD CONSTRAINT "menu_plan_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_plan" ADD CONSTRAINT "menu_plan_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
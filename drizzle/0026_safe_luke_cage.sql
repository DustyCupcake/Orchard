CREATE TYPE "public"."placement_category" AS ENUM('tent', 'vehicle', 'structure', 'furniture', 'generic');--> statement-breakpoint
CREATE TYPE "public"."placement_member_status" AS ENUM('invited', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."placement_shape_type" AS ENUM('rectangle', 'circle', 'polygon', 'line');--> statement-breakpoint
CREATE TYPE "public"."placement_status" AS ENUM('confirmed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."sleep_arrangement" AS ENUM('solo_tent', 'shared_tent', 'solo_vehicle', 'shared_vehicle', 'other');--> statement-breakpoint
CREATE TABLE "placement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plot_id" uuid NOT NULL,
	"zone_id" uuid,
	"shape_type" "placement_shape_type" NOT NULL,
	"geometry" jsonb NOT NULL,
	"label" text NOT NULL,
	"category" "placement_category" NOT NULL,
	"linked_task_id" uuid,
	"status" "placement_status" DEFAULT 'confirmed' NOT NULL,
	"pending_by_member_id" uuid,
	"pending_prev_geometry" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "placement_member" (
	"placement_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "placement_member_status" DEFAULT 'confirmed' NOT NULL,
	"invited_by" uuid NOT NULL,
	"invited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "placement_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"shape_type" "placement_shape_type" NOT NULL,
	"geometry" jsonb NOT NULL,
	"category" "placement_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "space_preference" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"sleep_arrangement" "sleep_arrangement" NOT NULL,
	"vehicle_dimensions" jsonb,
	"group_with" uuid[],
	"sharing_with" uuid[],
	"accessibility_notes" text
);
--> statement-breakpoint
ALTER TABLE "placement" ADD CONSTRAINT "placement_plot_id_plot_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plot"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement" ADD CONSTRAINT "placement_zone_id_zone_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."zone"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement" ADD CONSTRAINT "placement_linked_task_id_task_id_fk" FOREIGN KEY ("linked_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement" ADD CONSTRAINT "placement_pending_by_member_id_member_id_fk" FOREIGN KEY ("pending_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_member" ADD CONSTRAINT "placement_member_placement_id_placement_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."placement"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_member" ADD CONSTRAINT "placement_member_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_member" ADD CONSTRAINT "placement_member_invited_by_member_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_template" ADD CONSTRAINT "placement_template_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "space_preference" ADD CONSTRAINT "space_preference_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
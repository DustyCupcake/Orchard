CREATE TABLE "plot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"name" text NOT NULL,
	"base_image_url" text,
	"base_vector" jsonb,
	"scale_calibration" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zone" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plot_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"polygon" jsonb NOT NULL,
	"color" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "spatial_planning_task_id" uuid;--> statement-breakpoint
ALTER TABLE "plot" ADD CONSTRAINT "plot_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plot" ADD CONSTRAINT "plot_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zone" ADD CONSTRAINT "zone_plot_id_plot_id_fk" FOREIGN KEY ("plot_id") REFERENCES "public"."plot"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "pack_phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"start_relative_mode" date_relative_mode,
	"start_offset_anchor" "cycle_offset_anchor",
	"start_offset_days" integer,
	"start_percent" integer,
	"end_relative_mode" date_relative_mode,
	"end_offset_anchor" "cycle_offset_anchor",
	"end_offset_days" integer,
	"end_percent" integer
);
--> statement-breakpoint
CREATE TABLE "task_pack" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source" text,
	"version" text DEFAULT '1' NOT NULL,
	"domain_tags" text[] DEFAULT '{}' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "task_pack_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"branch_name_hint" text NOT NULL,
	"phase_ref" integer,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"effort" "task_effort" NOT NULL,
	"effort_magnitude" jsonb NOT NULL,
	"critical" boolean DEFAULT false NOT NULL,
	"capacity" integer DEFAULT 1,
	"openness" "task_openness" DEFAULT 'request' NOT NULL,
	"endorsement_threshold" integer,
	"requirements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"wiki_summary_seed" text,
	"resources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"milestones" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle_type" ADD COLUMN "default_pack_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "source_pack_id" uuid;--> statement-breakpoint
ALTER TABLE "pack_phase" ADD CONSTRAINT "pack_phase_pack_id_task_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."task_pack"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_pack" ADD CONSTRAINT "task_pack_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_pack" ADD CONSTRAINT "task_pack_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_pack_item" ADD CONSTRAINT "task_pack_item_pack_id_task_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."task_pack"("id") ON DELETE no action ON UPDATE no action;
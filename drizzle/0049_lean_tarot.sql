CREATE TABLE "trait_axis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"key" text NOT NULL,
	"low_label" text NOT NULL,
	"high_label" text NOT NULL,
	"option_labels" text[] DEFAULT '{}' NOT NULL,
	"ask_at_onboarding" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "member_axis_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"axis_id" uuid NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_axis_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"axis_id" uuid NOT NULL,
	"value" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_proposal" ADD COLUMN "suggested_axis_values" jsonb;--> statement-breakpoint
ALTER TABLE "trait_axis" ADD CONSTRAINT "trait_axis_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_axis_value" ADD CONSTRAINT "member_axis_value_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_axis_value" ADD CONSTRAINT "member_axis_value_axis_id_trait_axis_id_fk" FOREIGN KEY ("axis_id") REFERENCES "public"."trait_axis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_axis_value" ADD CONSTRAINT "task_axis_value_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_axis_value" ADD CONSTRAINT "task_axis_value_axis_id_trait_axis_id_fk" FOREIGN KEY ("axis_id") REFERENCES "public"."trait_axis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "member_axis_value_member_axis_idx" ON "member_axis_value" USING btree ("member_id","axis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_axis_value_task_axis_idx" ON "task_axis_value" USING btree ("task_id","axis_id");
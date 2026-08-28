CREATE TABLE "conflict_report" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"reported_by" uuid NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"escalated" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conflict_report_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "conflict_team_task_id" uuid;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "conflict_ack_window_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "conflict_report" ADD CONSTRAINT "conflict_report_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_report" ADD CONSTRAINT "conflict_report_reported_by_member_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_report" ADD CONSTRAINT "conflict_report_acknowledged_by_member_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_report_exclusion" ADD CONSTRAINT "conflict_report_exclusion_report_id_conflict_report_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."conflict_report"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_report_exclusion" ADD CONSTRAINT "conflict_report_exclusion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conflict_report_exclusion" ADD CONSTRAINT "conflict_report_exclusion_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
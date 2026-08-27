CREATE TYPE "public"."task_join_request_status" AS ENUM('pending', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "task_join_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "task_join_request_status" DEFAULT 'pending' NOT NULL,
	"decline_reason" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "task_join_request" ADD CONSTRAINT "task_join_request_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_join_request" ADD CONSTRAINT "task_join_request_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_join_request" ADD CONSTRAINT "task_join_request_resolved_by_member_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
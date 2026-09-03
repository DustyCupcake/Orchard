CREATE TYPE "public"."task_nomination_status" AS ENUM('pending', 'accepted', 'declined', 'not_now', 'expired');--> statement-breakpoint
CREATE TABLE "task_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"nominated_member_id" uuid NOT NULL,
	"nominated_by" uuid NOT NULL,
	"message" text,
	"status" "task_nomination_status" DEFAULT 'pending' NOT NULL,
	"respond_by_deadline" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "action_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "task_nomination_response_days" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "task_nomination" ADD CONSTRAINT "task_nomination_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nomination" ADD CONSTRAINT "task_nomination_nominated_member_id_member_id_fk" FOREIGN KEY ("nominated_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_nomination" ADD CONSTRAINT "task_nomination_nominated_by_member_id_fk" FOREIGN KEY ("nominated_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
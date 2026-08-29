CREATE TYPE "public"."budget_cycle_status" AS ENUM('proposals_open', 'voting', 'confirmed');--> statement-breakpoint
CREATE TABLE "budget_cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"title" text NOT NULL,
	"fixed_costs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposal_deadline" timestamp with time zone NOT NULL,
	"status" "budget_cycle_status" DEFAULT 'proposals_open' NOT NULL,
	"owner_task_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_proposal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_cycle_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"line_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"total_amount" integer NOT NULL,
	"branch_id" uuid,
	"phase_id" uuid,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD CONSTRAINT "budget_cycle_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD CONSTRAINT "budget_cycle_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD CONSTRAINT "budget_cycle_owner_task_id_task_id_fk" FOREIGN KEY ("owner_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD CONSTRAINT "budget_cycle_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_budget_cycle_id_budget_cycle_id_fk" FOREIGN KEY ("budget_cycle_id") REFERENCES "public"."budget_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_submitted_by_member_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phase"("id") ON DELETE no action ON UPDATE no action;
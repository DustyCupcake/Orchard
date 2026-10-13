CREATE TYPE "public"."budget_proposal_kind" AS ENUM('spending', 'event_allocation', 'event_deficit');--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "kind" "budget_proposal_kind" DEFAULT 'spending' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "event_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "plan_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "requested_contribution_per_member" integer;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "expected_contributors" integer;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_event_cycle_id_cycle_id_fk" FOREIGN KEY ("event_cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;
CREATE TABLE "budget_vote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_cycle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"ranked_proposal_ids" jsonb NOT NULL,
	"contribution_signal" integer,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD COLUMN "confirmed_proposal_ids" jsonb;--> statement-breakpoint
ALTER TABLE "budget_cycle" ADD COLUMN "confirmation_rationale" text;--> statement-breakpoint
ALTER TABLE "budget_vote" ADD CONSTRAINT "budget_vote_budget_cycle_id_budget_cycle_id_fk" FOREIGN KEY ("budget_cycle_id") REFERENCES "public"."budget_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_vote" ADD CONSTRAINT "budget_vote_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
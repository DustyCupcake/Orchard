CREATE TYPE "public"."budget_proposal_status" AS ENUM('open', 'approved', 'declined', 'withdrawn', 'closed');--> statement-breakpoint
CREATE TABLE "budget_pledge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"budget_cycle_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_pledge_member_unique" UNIQUE("budget_cycle_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "budget_proposal_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_proposal_support_member_unique" UNIQUE("proposal_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "budget_proposal" ALTER COLUMN "budget_cycle_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "fund_support_per_backer" integer;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "community_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "status" "budget_proposal_status" DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "decided_by" uuid;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "decision_note" text;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD COLUMN "approved_amount" integer;--> statement-breakpoint
ALTER TABLE "budget_pledge" ADD CONSTRAINT "budget_pledge_budget_cycle_id_budget_cycle_id_fk" FOREIGN KEY ("budget_cycle_id") REFERENCES "public"."budget_cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_pledge" ADD CONSTRAINT "budget_pledge_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_support" ADD CONSTRAINT "budget_proposal_support_proposal_id_budget_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."budget_proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_support" ADD CONSTRAINT "budget_proposal_support_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal" ADD CONSTRAINT "budget_proposal_decided_by_member_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Hand-written from here: Drizzle generates the structure, but the rows that
-- already exist need converting from rounds-and-ranking to backed proposals.
-- docs/plans/budget-funds-plan.md, Phase 2, "Existing data".

-- A proposal now carries its own community and scope, because a proposal made
-- in the community's own budget has no round to read them through.
UPDATE "budget_proposal" p
SET "community_id" = bc."community_id", "cycle_id" = bc."cycle_id"
FROM "budget_cycle" bc
WHERE p."budget_cycle_id" = bc."id";--> statement-breakpoint
ALTER TABLE "budget_proposal" ALTER COLUMN "community_id" SET NOT NULL;--> statement-breakpoint

-- A confirmed round decided its funded set: those proposals become approved,
-- for their stored total, and the rest declined with a note saying why. The
-- round's own rationale stays on the round, for reference.
UPDATE "budget_proposal" p
SET "status" = 'approved', "approved_amount" = p."total_amount", "decided_at" = now()
FROM "budget_cycle" bc
WHERE p."budget_cycle_id" = bc."id"
  AND bc."status" = 'confirmed'
  AND COALESCE(bc."confirmed_proposal_ids", '[]'::jsonb) @> to_jsonb(p."id"::text);--> statement-breakpoint
UPDATE "budget_proposal" p
SET "status" = 'declined', "decided_at" = now(), "decision_note" = 'Not funded in the confirmed budget.'
FROM "budget_cycle" bc
WHERE p."budget_cycle_id" = bc."id"
  AND bc."status" = 'confirmed'
  AND NOT (COALESCE(bc."confirmed_proposal_ids", '[]'::jsonb) @> to_jsonb(p."id"::text));--> statement-breakpoint

-- A round that was still open, or in voting, has its proposals left open (the
-- column's default). The round itself: an event's budget is open until
-- finished, so "voting" becomes open; a community round is history now, since
-- the community's own budget has proposals and no rounds.
UPDATE "budget_cycle" SET "status" = 'proposals_open' WHERE "status" = 'voting' AND "cycle_id" IS NOT NULL;--> statement-breakpoint
UPDATE "budget_cycle" SET "status" = 'confirmed' WHERE "cycle_id" IS NULL AND "status" <> 'confirmed';--> statement-breakpoint

-- The pledge was a field on the ranking ballot. Keep the latest per member.
INSERT INTO "budget_pledge" ("budget_cycle_id", "member_id", "amount", "created_at", "updated_at")
SELECT DISTINCT ON ("budget_cycle_id", "member_id")
  "budget_cycle_id", "member_id", "contribution_signal", "submitted_at", "submitted_at"
FROM "budget_vote"
WHERE "contribution_signal" IS NOT NULL
ORDER BY "budget_cycle_id", "member_id", "submitted_at" DESC;

CREATE TYPE "public"."budget_entry_kind" AS ENUM('opening_balance', 'expense', 'income', 'contribution', 'allocation', 'settlement', 'adjustment');--> statement-breakpoint
CREATE TYPE "public"."budget_entry_status" AS ENUM('pending', 'confirmed', 'rejected');--> statement-breakpoint
CREATE TABLE "budget_entry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"kind" "budget_entry_kind" NOT NULL,
	"amount" integer NOT NULL,
	"status" "budget_entry_status" DEFAULT 'pending' NOT NULL,
	"member_id" uuid,
	"submitted_by" uuid NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"decision_note" text,
	"description" text NOT NULL,
	"occurred_on" date NOT NULL,
	"receipt_note" text,
	"proposal_id" uuid,
	"reimbursed_at" timestamp with time zone,
	"transfer_id" uuid,
	"reverses_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_submitted_by_member_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_confirmed_by_member_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_entry" ADD CONSTRAINT "budget_entry_proposal_id_budget_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."budget_proposal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_entry_one_opening_balance" ON "budget_entry" USING btree ("community_id") WHERE "budget_entry"."kind" = 'opening_balance' and "budget_entry"."cycle_id" is null and "budget_entry"."status" <> 'rejected';--> statement-breakpoint
CREATE UNIQUE INDEX "budget_entry_reversed_once" ON "budget_entry" USING btree ("reverses_entry_id") WHERE "budget_entry"."reverses_entry_id" is not null;
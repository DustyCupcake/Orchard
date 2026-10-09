CREATE TYPE "public"."event_proposal_interest_level" AS ENUM('yes', 'maybe');--> statement-breakpoint
CREATE TABLE "event_proposal_interest" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"level" "event_proposal_interest_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_proposal_interest_member_unique" UNIQUE("proposal_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "event_proposal_interest" ADD CONSTRAINT "event_proposal_interest_proposal_id_event_proposal_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."event_proposal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_proposal_interest" ADD CONSTRAINT "event_proposal_interest_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
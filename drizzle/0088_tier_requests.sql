CREATE TYPE "public"."tier_request_decision" AS ENUM('approved', 'declined');--> statement-breakpoint
CREATE TABLE "tier_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"tier_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision" "tier_request_decision"
);
--> statement-breakpoint
ALTER TABLE "tier_request" ADD CONSTRAINT "tier_request_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_request" ADD CONSTRAINT "tier_request_tier_id_tier_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."tier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier_request" ADD CONSTRAINT "tier_request_decided_by_member_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tier_request_pending_member_tier_unique" ON "tier_request" USING btree ("member_id","tier_id") WHERE "tier_request"."decided_at" is null;
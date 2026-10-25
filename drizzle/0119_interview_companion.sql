CREATE TYPE "public"."interview_companion_status" AS ENUM('requested', 'accepted', 'declined');--> statement-breakpoint
CREATE TABLE "interview_companion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"arrival_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "interview_companion_status" DEFAULT 'requested' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "interview_offer_inviter" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "interview_companion" ADD CONSTRAINT "interview_companion_arrival_id_admission_id_fk" FOREIGN KEY ("arrival_id") REFERENCES "public"."admission"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_companion" ADD CONSTRAINT "interview_companion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "interview_companion_arrival_member_unique" ON "interview_companion" USING btree ("arrival_id","member_id");
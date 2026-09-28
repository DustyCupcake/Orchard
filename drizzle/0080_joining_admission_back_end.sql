CREATE TYPE "public"."objection_overrule_mode" AS ENUM('majority', 'quorum');--> statement-breakpoint
CREATE TYPE "public"."invite_consensus_state" AS ENUM('not_required', 'awaiting_consent', 'announced', 'admitted', 'withheld');--> statement-breakpoint
CREATE TYPE "public"."joining_nomination_state" AS ENUM('awaiting', 'supported', 'skipped', 'lapsed');--> statement-breakpoint
CREATE TYPE "public"."objection_resolution" AS ENUM('standing', 'cleared', 'upheld', 'overruled', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."recruitment_pair_status" AS ENUM('awaiting_applicant', 'awaiting_accept', 'accepted', 'declined');--> statement-breakpoint
ALTER TYPE "public"."permission_grant_module" ADD VALUE 'recruitment_mediation' BEFORE 'spatial_planning';--> statement-breakpoint
CREATE TABLE "joining_nomination" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"invite_id" uuid,
	"form_response_id" uuid,
	"support_token" text NOT NULL,
	"state" "joining_nomination_state" DEFAULT 'awaiting' NOT NULL,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "joining_nomination_support_token_unique" UNIQUE("support_token")
);
--> statement-breakpoint
CREATE TABLE "joining_support" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nomination_id" uuid NOT NULL,
	"supporter_id" uuid NOT NULL,
	"knows_personally" boolean DEFAULT false NOT NULL,
	"thinks_good_fit" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_application_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_response_id" uuid NOT NULL,
	"disclosure" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recruitment_pair" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"token" text NOT NULL,
	"requested_by_id" uuid NOT NULL,
	"first_response_id" uuid,
	"second_member_id" uuid,
	"second_response_id" uuid,
	"status" "recruitment_pair_status" DEFAULT 'awaiting_applicant' NOT NULL,
	"shared_call_offered_at" timestamp with time zone,
	"shared_call_accepted_at" timestamp with time zone,
	"shared_call_declined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "recruitment_pair_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "objection_party_consent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objection_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "objection_party_exclusion" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"objection_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "objection" ALTER COLUMN "form_response_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_interviews_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_nomination_window_hours" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_objection_overrule" "objection_overrule_mode" DEFAULT 'majority' NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_objection_quorum" integer DEFAULT 3 NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "interviews_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "awareness_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "awareness_confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "consent_disclosure" text;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "consensus_state" "invite_consensus_state" DEFAULT 'not_required' NOT NULL;--> statement-breakpoint
ALTER TABLE "community_invite" ADD COLUMN "consensus_deadline" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "community_id" uuid NOT NULL;--> statement-breakpoint
-- community_id is denormalized onto objection so the mediation queue can
-- scope by community without joining through either subject. The column
-- is NOT NULL, so the pre-existing rows have to be filled from the one
-- subject they have: form_response -> form -> community. Rows that
-- somehow have no response behind them (impossible before this
-- migration, which is exactly why it is safe to assume a response) are
-- attached to nothing and would fail the ALTER, deliberately — a
-- silently-missing community would be a shielded objection no mediation
-- body could ever find.
UPDATE "objection" o SET "community_id" = f."community_id" FROM "form_response" fr JOIN "form" f ON f."id" = fr."form_id" WHERE fr."id" = o."form_response_id";--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "invite_id" uuid;--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "resolution" "objection_resolution" DEFAULT 'standing' NOT NULL;--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "resolved_by_id" uuid;--> statement-breakpoint
ALTER TABLE "objection" ADD COLUMN "resolution_note" text;--> statement-breakpoint
ALTER TABLE "joining_nomination" ADD CONSTRAINT "joining_nomination_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joining_nomination" ADD CONSTRAINT "joining_nomination_invite_id_community_invite_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."community_invite"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joining_nomination" ADD CONSTRAINT "joining_nomination_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joining_support" ADD CONSTRAINT "joining_support_nomination_id_joining_nomination_id_fk" FOREIGN KEY ("nomination_id") REFERENCES "public"."joining_nomination"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joining_support" ADD CONSTRAINT "joining_support_supporter_id_member_id_fk" FOREIGN KEY ("supporter_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_application_consent" ADD CONSTRAINT "recruitment_application_consent_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_requested_by_id_member_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_first_response_id_form_response_id_fk" FOREIGN KEY ("first_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_second_member_id_member_id_fk" FOREIGN KEY ("second_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recruitment_pair" ADD CONSTRAINT "recruitment_pair_second_response_id_form_response_id_fk" FOREIGN KEY ("second_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_party_consent" ADD CONSTRAINT "objection_party_consent_objection_id_objection_id_fk" FOREIGN KEY ("objection_id") REFERENCES "public"."objection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_party_consent" ADD CONSTRAINT "objection_party_consent_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_party_exclusion" ADD CONSTRAINT "objection_party_exclusion_objection_id_objection_id_fk" FOREIGN KEY ("objection_id") REFERENCES "public"."objection"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_party_exclusion" ADD CONSTRAINT "objection_party_exclusion_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection_party_exclusion" ADD CONSTRAINT "objection_party_exclusion_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "joining_nomination_invite_idx" ON "joining_nomination" USING btree ("invite_id");--> statement-breakpoint
CREATE UNIQUE INDEX "joining_nomination_response_idx" ON "joining_nomination" USING btree ("form_response_id");--> statement-breakpoint
ALTER TABLE "community_invite" ADD CONSTRAINT "community_invite_awareness_confirmed_by_member_id_fk" FOREIGN KEY ("awareness_confirmed_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection" ADD CONSTRAINT "objection_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection" ADD CONSTRAINT "objection_invite_id_community_invite_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."community_invite"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "objection" ADD CONSTRAINT "objection_resolved_by_id_member_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
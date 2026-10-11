CREATE TYPE "public"."sso_join_policy" AS ENUM('anyone_with_role', 'admitted_only');--> statement-breakpoint
CREATE TYPE "public"."sign_in_setup_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "public"."unmatched_sign_in_resolution" AS ENUM('linked', 'turned_away');--> statement-breakpoint
ALTER TYPE "public"."settings_change_entity" ADD VALUE 'member_sign_in';--> statement-breakpoint
CREATE TABLE "sign_in_setup" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"status" "sign_in_setup_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "unmatched_sign_in" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"provider_subject" text NOT NULL,
	"login_email" text NOT NULL,
	"email_verified" boolean,
	"nickname" text,
	"given_name" text,
	"suggested_member_id" uuid,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolution" "unmatched_sign_in_resolution",
	"resolved_at" timestamp with time zone,
	"resolved_by_id" uuid,
	"linked_member_id" uuid
);
--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "sso_create_on_admit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "sso_revoke_on_leave" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "sso_join_policy" "sso_join_policy" DEFAULT 'anyone_with_role' NOT NULL;--> statement-breakpoint
ALTER TABLE "sign_in_setup" ADD CONSTRAINT "sign_in_setup_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sign_in_setup" ADD CONSTRAINT "sign_in_setup_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_sign_in" ADD CONSTRAINT "unmatched_sign_in_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_sign_in" ADD CONSTRAINT "unmatched_sign_in_suggested_member_id_member_id_fk" FOREIGN KEY ("suggested_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_sign_in" ADD CONSTRAINT "unmatched_sign_in_resolved_by_id_member_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unmatched_sign_in" ADD CONSTRAINT "unmatched_sign_in_linked_member_id_member_id_fk" FOREIGN KEY ("linked_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sign_in_setup_member_unique" ON "sign_in_setup" USING btree ("member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unmatched_sign_in_subject_unique" ON "unmatched_sign_in" USING btree ("provider_subject");
CREATE TYPE "public"."joining_invite_mode" AS ENUM('direct', 'referral');--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_applications_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_invites_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "recruitment_application_form_id" uuid;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "applications_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "invites_open" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "joining_invite_mode" "joining_invite_mode" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "joining_window_closes_at" timestamp with time zone;
CREATE TYPE "public"."settings_change_entity" AS ENUM('community', 'branch', 'tier', 'cycle_type', 'trait_axis', 'form', 'profile_question', 'consent_purpose', 'sensitive_field_rule', 'permission_grant', 'open_permission_grant', 'bulk_member_import');--> statement-breakpoint
CREATE TABLE "settings_change" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"entity" "settings_change_entity" NOT NULL,
	"entity_id" uuid,
	"entity_label" text,
	"action" text NOT NULL,
	"field" text NOT NULL,
	"values_withheld" boolean DEFAULT false NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "settings_change" ADD CONSTRAINT "settings_change_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_change" ADD CONSTRAINT "settings_change_actor_id_member_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."consent_method" AS ENUM('explicit_action', 'form_submission');--> statement-breakpoint
CREATE TYPE "public"."contact_method_visibility" AS ENUM('everyone', 'task_or_group_mates', 'emergency_only');--> statement-breakpoint
CREATE TABLE "consent_purpose" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"notice_version" integer DEFAULT 1 NOT NULL,
	"notice_text" text NOT NULL,
	"requires_explicit" boolean DEFAULT false NOT NULL,
	"gates_sensitive_field" "sensitive_field_key"
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"purpose_id" uuid NOT NULL,
	"notice_version" integer NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"method" "consent_method" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_method" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"type" text NOT NULL,
	"value" text NOT NULL,
	"visibility" "contact_method_visibility" DEFAULT 'everyone' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_access_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"activated_by" uuid NOT NULL,
	"target_member_id" uuid NOT NULL,
	"explanation" text,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "consent_purpose" ADD CONSTRAINT "consent_purpose_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_purpose_id_consent_purpose_id_fk" FOREIGN KEY ("purpose_id") REFERENCES "public"."consent_purpose"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_method" ADD CONSTRAINT "contact_method_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_log" ADD CONSTRAINT "emergency_access_log_activated_by_member_id_fk" FOREIGN KEY ("activated_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_access_log" ADD CONSTRAINT "emergency_access_log_target_member_id_member_id_fk" FOREIGN KEY ("target_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;
CREATE TYPE "public"."sensitive_field_key" AS ENUM('health_conditions', 'allergies', 'emergency_contact', 'orientation');--> statement-breakpoint
CREATE TABLE "sensitive_field_access_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"field_key" "sensitive_field_key" NOT NULL,
	"unlocked_by_task_id" uuid,
	"unlocked_by_tier_id" uuid
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "health_conditions" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "allergies" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "emergency_contact" text;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "orientation" text;--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD CONSTRAINT "sensitive_field_access_rule_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD CONSTRAINT "sensitive_field_access_rule_unlocked_by_task_id_task_id_fk" FOREIGN KEY ("unlocked_by_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sensitive_field_access_rule" ADD CONSTRAINT "sensitive_field_access_rule_unlocked_by_tier_id_tier_id_fk" FOREIGN KEY ("unlocked_by_tier_id") REFERENCES "public"."tier"("id") ON DELETE no action ON UPDATE no action;
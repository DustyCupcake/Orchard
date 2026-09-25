CREATE TYPE "public"."joining_lane_kind" AS ENUM('invited_knows_personally', 'invited_good_fit', 'invited_neither', 'public_application');--> statement-breakpoint
CREATE TYPE "public"."joining_verification_mode" AS ENUM('basic', 'nomination', 'consensus');--> statement-breakpoint
CREATE TABLE "joining_lane" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"lane" "joining_lane_kind" NOT NULL,
	"verification_mode" "joining_verification_mode" DEFAULT 'basic' NOT NULL,
	"support_count" integer DEFAULT 1 NOT NULL,
	"application_required" boolean DEFAULT true NOT NULL,
	"interview_required" boolean DEFAULT true NOT NULL,
	"apply_instead_available" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "joining_lane" ADD CONSTRAINT "joining_lane_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "joining_lane" ADD CONSTRAINT "joining_lane_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "joining_lane_community_cycle_lane_idx" ON "joining_lane" USING btree ("community_id","cycle_id","lane");--> statement-breakpoint
ALTER TABLE "cycle" DROP COLUMN "joining_invite_mode";--> statement-breakpoint
DROP TYPE "public"."joining_invite_mode";--> statement-breakpoint
-- §2.9 seed (docs/joining-admission-plan.md §2.9/§4.1/2d): one
-- community-wide row per lane with the defaults that reproduce today's
-- behavior — knows-personally = direct (basic verification, no
-- application, no interview), the other three = process. Values mirror
-- JOINING_LANE_DEFAULTS in src/lib/recruitment/joining-lanes.ts; a
-- cycle with its own row overrides, a community with no rows falls back
-- to the code defaults in getJoinLaneRulesForContext. Rows are seeded
-- for pre-existing communities only; communities created after this
-- migration rely on the code-level §2.9 fallback (which is also what
-- resetDatabase-truncated test/scratch communities hit).
INSERT INTO "joining_lane" ("community_id", "cycle_id", "lane", "verification_mode", "support_count", "application_required", "interview_required", "apply_instead_available")
SELECT "id", NULL, 'invited_knows_personally', 'basic', 1, false, false, true FROM "community";--> statement-breakpoint
INSERT INTO "joining_lane" ("community_id", "cycle_id", "lane", "verification_mode", "support_count", "application_required", "interview_required", "apply_instead_available")
SELECT "id", NULL, 'invited_good_fit', 'basic', 1, true, true, true FROM "community";--> statement-breakpoint
INSERT INTO "joining_lane" ("community_id", "cycle_id", "lane", "verification_mode", "support_count", "application_required", "interview_required", "apply_instead_available")
SELECT "id", NULL, 'invited_neither', 'basic', 1, true, true, true FROM "community";--> statement-breakpoint
INSERT INTO "joining_lane" ("community_id", "cycle_id", "lane", "verification_mode", "support_count", "application_required", "interview_required", "apply_instead_available")
SELECT "id", NULL, 'public_application', 'basic', 1, true, true, true FROM "community";
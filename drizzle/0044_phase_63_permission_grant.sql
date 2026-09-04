CREATE TYPE "public"."permission_grant_module" AS ENUM('admin', 'branch_coordination', 'conflict_team', 'feedback_review', 'event_scheduling_owner', 'recruitment', 'spatial_planning', 'announcements', 'support');--> statement-breakpoint
CREATE TABLE "permission_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"module_key" "permission_grant_module" NOT NULL,
	"task_id" uuid NOT NULL,
	"cycle_id" uuid,
	"permission_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_grant" ADD CONSTRAINT "permission_grant_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- One-time data migration: seed permission_grant from the nine old
-- Community fields before they're dropped below. The six single-task
-- pointers map 1:1 onto a grant row; the three tag-based fields
-- (admins/coordination/support) become a grant row for every task
-- presently carrying that community's configured tag — the exact set
-- of tasks each old tag-match check would have recognized (admin's
-- also required openness = 'community_endorsed', matching
-- requireAdmins' own holder filter; coordination/support never did).
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'conflict_team', "conflict_team_task_id" FROM "community" WHERE "conflict_team_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'feedback_review', "feedback_review_task_id" FROM "community" WHERE "feedback_review_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'event_scheduling_owner', "event_scheduling_owner_task_id" FROM "community" WHERE "event_scheduling_owner_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'recruitment', "recruitment_task_id" FROM "community" WHERE "recruitment_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'spatial_planning', "spatial_planning_task_id" FROM "community" WHERE "spatial_planning_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "id", 'announcements', "announcement_task_id" FROM "community" WHERE "announcement_task_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "t"."community_id", 'admin', "t"."id"
FROM "task" "t" JOIN "community" "c" ON "c"."id" = "t"."community_id"
WHERE "t"."openness" = 'community_endorsed' AND "c"."admins_tag" = ANY("t"."tags");--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "t"."community_id", 'branch_coordination', "t"."id"
FROM "task" "t" JOIN "community" "c" ON "c"."id" = "t"."community_id"
WHERE "c"."coordination_tag" = ANY("t"."tags");--> statement-breakpoint
INSERT INTO "permission_grant" ("community_id", "module_key", "task_id")
SELECT "t"."community_id", 'support', "t"."id"
FROM "task" "t" JOIN "community" "c" ON "c"."id" = "t"."community_id"
WHERE "c"."support_tag" = ANY("t"."tags");--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "conflict_team_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "admins_tag";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "coordination_tag";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "feedback_review_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "event_scheduling_owner_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "recruitment_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "spatial_planning_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "announcement_task_id";--> statement-breakpoint
ALTER TABLE "community" DROP COLUMN "support_tag";
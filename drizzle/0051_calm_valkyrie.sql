-- Cycle-scope remediation (docs/cycle-scope-remediation-plan.md) — D8:
-- retire permission_grant.cycleId in the same migration that backfills
-- its conflicts. The granted task's placement (task.cycleId) becomes the
-- single scope read; the grant row becomes a bare "this task grants
-- module M" fact.
--
-- Backfill: a grant row that names a cycle while its task has no
-- placement yet moves the task into that cycle (grant.cycleId -> the
-- granting task's task.cycleId). Rows where the task already sits
-- somewhere are left untouched; rows where both are set and disagree are
-- surfaced below for a human (only the Phase 68 two-cycle stacking case
-- could have produced them).
UPDATE "task" SET "cycle_id" = pg."cycle_id"
FROM "permission_grant" pg
WHERE pg."task_id" = "task"."id"
  AND pg."cycle_id" IS NOT NULL
  AND "task"."cycle_id" IS NULL;
--> statement-breakpoint
-- Surface disagreeing rows for a human before the drop hides them:
-- task already placed in one cycle while its grant names another.
SELECT t."id" AS "task_id", t."cycle_id" AS "task_cycle_id", pg."cycle_id" AS "grant_cycle_id"
FROM "permission_grant" pg
JOIN "task" t ON t."id" = pg."task_id"
WHERE pg."cycle_id" IS NOT NULL
  AND t."cycle_id" IS NOT NULL
  AND t."cycle_id" <> pg."cycle_id";
--> statement-breakpoint
ALTER TABLE "permission_grant" DROP CONSTRAINT "permission_grant_cycle_id_cycle_id_fk";
--> statement-breakpoint
ALTER TABLE "permission_grant" DROP COLUMN "cycle_id";
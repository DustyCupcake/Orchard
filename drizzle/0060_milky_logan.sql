LOCK TABLE "public"."task" IN SHARE MODE;--> statement-breakpoint
LOCK TABLE "public"."budget_cycle", "public"."permission_grant" IN ACCESS EXCLUSIVE MODE;--> statement-breakpoint
CREATE TYPE "public"."permission_grant_module__new" AS ENUM('admin', 'branch_coordination', 'conflict_team', 'feedback_review', 'event_scheduling_owner', 'recruitment', 'spatial_planning', 'announcements', 'support', 'backstop', 'shift_management', 'budget');--> statement-breakpoint
ALTER TABLE "public"."permission_grant" ALTER COLUMN "module_key" SET DATA TYPE "public"."permission_grant_module__new" USING "module_key"::text::"public"."permission_grant_module__new";--> statement-breakpoint
DROP TYPE "public"."permission_grant_module";--> statement-breakpoint
ALTER TYPE "public"."permission_grant_module__new" RENAME TO "permission_grant_module";--> statement-breakpoint
-- Materialize legacy owner mappings with anomaly classification
CREATE TEMP TABLE "budget_owner_legacy_0060" ON COMMIT DROP AS
SELECT
  "bc"."id" AS "budget_cycle_id",
  "bc"."community_id",
  "bc"."cycle_id",
  "bc"."owner_task_id",
  "bc"."created_at",
  CASE
    WHEN "t"."id" IS NULL THEN 'missing_task'
    WHEN "t"."community_id" IS DISTINCT FROM "bc"."community_id" THEN 'cross_community_task'
    WHEN "t"."cycle_id" IS NOT DISTINCT FROM "bc"."cycle_id" THEN 'scope_match'
    ELSE 'scope_mismatch'
  END AS "anomaly",
  row_number() OVER (
    PARTITION BY "bc"."community_id", "bc"."cycle_id"
    ORDER BY "bc"."created_at" DESC, "bc"."id" DESC
  ) AS "scope_rank"
FROM "public"."budget_cycle" AS "bc"
LEFT JOIN "public"."task" AS "t"
  ON "t"."id" = "bc"."owner_task_id";--> statement-breakpoint
-- Report anomalies (visible in migration output despite onnotice suppression via RAISE NOTICE)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM "budget_owner_legacy_0060" WHERE "anomaly" <> 'scope_match' LOOP
    RAISE NOTICE '0060 Budget owner anomaly: budget_cycle_id=%, community_id=%, cycle_id=%, owner_task_id=%, reason=%',
      r."budget_cycle_id", r."community_id", r."cycle_id", r."owner_task_id", r."anomaly";
  END LOOP;
END $$;--> statement-breakpoint
-- Backfill valid mappings: newest eligible budget_cycle per (community_id, cycle_id) wins
WITH "eligible" AS (
  SELECT
    "community_id",
    "cycle_id",
    "owner_task_id"
  FROM "budget_owner_legacy_0060"
  WHERE "anomaly" = 'scope_match'
    AND "scope_rank" = 1
)
INSERT INTO "public"."permission_grant" ("community_id", "module_key", "task_id")
SELECT
  "eligible"."community_id",
  'budget'::"public"."permission_grant_module",
  "eligible"."owner_task_id"
FROM "eligible"
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."permission_grant" AS "existing_grant"
  INNER JOIN "public"."task" AS "existing_task"
    ON "existing_task"."id" = "existing_grant"."task_id"
  WHERE "existing_grant"."community_id" = "eligible"."community_id"
    AND "existing_grant"."module_key" = 'budget'::"public"."permission_grant_module"
    AND "existing_task"."community_id" = "eligible"."community_id"
    AND "existing_task"."cycle_id" IS NOT DISTINCT FROM "eligible"."cycle_id"
);--> statement-breakpoint
-- Postcondition: every community/scope that had a valid legacy owner now has exactly one Budget grant
DO $$
DECLARE
  missing_scope record;
  duplicate_scope record;
BEGIN
  -- Check for scopes that had valid owners but now have no grant
  FOR missing_scope IN
    SELECT DISTINCT "community_id", "cycle_id"
    FROM "budget_owner_legacy_0060"
    WHERE "anomaly" = 'scope_match'
    AND "scope_rank" = 1
    AND NOT EXISTS (
      SELECT 1
      FROM "public"."permission_grant" AS "pg"
      INNER JOIN "public"."task" AS "t" ON "t"."id" = "pg"."task_id"
      WHERE "pg"."community_id" = "budget_owner_legacy_0060"."community_id"
        AND "pg"."module_key" = 'budget'
        AND "t"."community_id" = "budget_owner_legacy_0060"."community_id"
        AND "t"."cycle_id" IS NOT DISTINCT FROM "budget_owner_legacy_0060"."cycle_id"
    )
  LOOP
    RAISE EXCEPTION '0060 postcondition failed: community_id=%, cycle_id=% had a valid legacy owner but no Budget grant was created',
      missing_scope."community_id", missing_scope."cycle_id";
  END LOOP;

  -- Check for duplicate grants in any scope (should not happen due to NOT EXISTS, but defense in depth)
  FOR duplicate_scope IN
    SELECT "pg"."community_id", "t"."cycle_id", count(*) AS "grant_count"
    FROM "public"."permission_grant" AS "pg"
    INNER JOIN "public"."task" AS "t" ON "t"."id" = "pg"."task_id"
    WHERE "pg"."module_key" = 'budget'
    GROUP BY "pg"."community_id", "t"."cycle_id"
    HAVING count(*) > 1
  LOOP
    RAISE EXCEPTION '0060 postcondition failed: community_id=%, cycle_id=% has % Budget grants (expected 1)',
      duplicate_scope."community_id", duplicate_scope."cycle_id", duplicate_scope."grant_count";
  END LOOP;
END $$;--> statement-breakpoint
ALTER TABLE "public"."budget_cycle" DROP CONSTRAINT "budget_cycle_owner_task_id_task_id_fk";--> statement-breakpoint
ALTER TABLE "public"."budget_cycle" DROP COLUMN "owner_task_id";
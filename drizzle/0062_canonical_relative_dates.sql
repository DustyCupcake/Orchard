CREATE TYPE "public"."date_display_mode" AS ENUM('exact', 'period');--> statement-breakpoint
CREATE TYPE "public"."date_relative_basis" AS ENUM('start', 'end', 'between');--> statement-breakpoint
CREATE TYPE "public"."milestone_parent_type" AS ENUM('cycle', 'phase');--> statement-breakpoint

ALTER TABLE "community" ADD COLUMN "default_date_display_mode" date_display_mode DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_relative_value" integer;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_relative_value" integer;--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "date_display_mode" date_display_mode;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "relative_value" integer;--> statement-breakpoint
ALTER TABLE "task_milestone" ADD COLUMN "parent_type" "milestone_parent_type";--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "relative_value" integer;--> statement-breakpoint
ALTER TABLE "pack_phase" ADD COLUMN "start_relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "pack_phase" ADD COLUMN "start_relative_value" integer;--> statement-breakpoint
ALTER TABLE "pack_phase" ADD COLUMN "end_relative_basis" date_relative_basis;--> statement-breakpoint
ALTER TABLE "pack_phase" ADD COLUMN "end_relative_value" integer;--> statement-breakpoint

-- One-time recipe conversion. Percent values are stored as hundredths of a
-- percent, and old offsets are first mapped to the new basis/value columns.
UPDATE "phase" SET
  "start_relative_basis" = CASE
    WHEN "start_relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "start_relative_mode" = 'offset' AND "start_offset_anchor" = 'cycle_start' THEN 'start'::date_relative_basis
    WHEN "start_relative_mode" = 'offset' AND "start_offset_anchor" = 'cycle_end' THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "start_relative_value" = CASE
    WHEN "start_relative_mode" = 'percent' THEN "start_percent" * 100
    WHEN "start_relative_mode" = 'offset' THEN "start_offset_days"
    ELSE NULL
  END,
  "end_relative_basis" = CASE
    WHEN "end_relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "end_relative_mode" = 'offset' AND "end_offset_anchor" = 'cycle_start' THEN 'start'::date_relative_basis
    WHEN "end_relative_mode" = 'offset' AND "end_offset_anchor" = 'cycle_end' THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "end_relative_value" = CASE
    WHEN "end_relative_mode" = 'percent' THEN "end_percent" * 100
    WHEN "end_relative_mode" = 'offset' THEN "end_offset_days"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "calendar_event" SET
  "relative_basis" = CASE
    WHEN "relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "relative_mode" = 'offset' AND "anchor_type" = 'cycle_start' THEN 'start'::date_relative_basis
    WHEN "relative_mode" = 'offset' AND "anchor_type" = 'cycle_end' THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "relative_value" = CASE
    WHEN "relative_mode" = 'percent' THEN "percent" * 100
    WHEN "relative_mode" = 'offset' THEN "offset_days"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "pack_phase" SET
  "start_relative_basis" = CASE
    WHEN "start_relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "start_relative_mode" = 'offset' AND "start_offset_anchor" = 'cycle_start' THEN 'start'::date_relative_basis
    WHEN "start_relative_mode" = 'offset' AND "start_offset_anchor" = 'cycle_end' THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "start_relative_value" = CASE
    WHEN "start_relative_mode" = 'percent' THEN "start_percent" * 100
    WHEN "start_relative_mode" = 'offset' THEN "start_offset_days"
    ELSE NULL
  END,
  "end_relative_basis" = CASE
    WHEN "end_relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "end_relative_mode" = 'offset' AND "end_offset_anchor" = 'cycle_start' THEN 'start'::date_relative_basis
    WHEN "end_relative_mode" = 'offset' AND "end_offset_anchor" = 'cycle_end' THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "end_relative_value" = CASE
    WHEN "end_relative_mode" = 'percent' THEN "end_percent" * 100
    WHEN "end_relative_mode" = 'offset' THEN "end_offset_days"
    ELSE NULL
  END;--> statement-breakpoint

UPDATE "task_milestone" SET
  "parent_type" = CASE
    WHEN "anchor_type" IN ('phase_start', 'phase_end') THEN 'phase'::milestone_parent_type
    WHEN "anchor_type" IN ('cycle_start', 'cycle_end') THEN 'cycle'::milestone_parent_type
    ELSE NULL
  END,
  "relative_basis" = CASE
    WHEN "relative_mode" = 'percent' THEN 'between'::date_relative_basis
    WHEN "relative_mode" = 'offset' AND "anchor_type" IN ('phase_start', 'cycle_start') THEN 'start'::date_relative_basis
    WHEN "relative_mode" = 'offset' AND "anchor_type" IN ('phase_end', 'cycle_end') THEN 'end'::date_relative_basis
    ELSE NULL
  END,
  "relative_value" = CASE
    WHEN "relative_mode" = 'percent' THEN "percent" * 100
    WHEN "relative_mode" = 'offset' THEN "offset_days"
    ELSE NULL
  END;--> statement-breakpoint

-- Re-canonicalize Phase recipes that already have both parent dates. The
-- cached date is the legacy target, so even an old in-range offset becomes
-- the correct percent recipe before the old columns disappear.
WITH "legacy_phase_dates" AS (
  SELECT
    p."id",
    c."start_date" AS "parent_start",
    c."end_date" AS "parent_end",
    p."start_date" AS "target_start",
    p."end_date" AS "target_end"
  FROM "phase" p
  JOIN "cycle" c ON c."id" = p."cycle_id"
  WHERE p."start_date_type" = 'relative'
     OR p."end_date_type" = 'relative'
)
UPDATE "phase" p
SET
  "start_relative_basis" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_start" < l."parent_start" THEN 'start'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_start" > l."parent_end" THEN 'end'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND p."start_date_type" = 'relative' THEN 'between'::date_relative_basis
    ELSE p."start_relative_basis"
  END,
  "start_relative_value" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_start" < l."parent_start" THEN l."target_start" - l."parent_start"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_start" > l."parent_end" THEN l."target_start" - l."parent_end"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND p."start_date_type" = 'relative' AND l."target_start" IS NOT NULL THEN ROUND(10000.0 * (l."target_start" - l."parent_start")::numeric / NULLIF((l."parent_end" - l."parent_start")::numeric, 0))::integer
    ELSE p."start_relative_value"
  END,
  "end_relative_basis" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_end" < l."parent_start" THEN 'start'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_end" > l."parent_end" THEN 'end'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND p."end_date_type" = 'relative' THEN 'between'::date_relative_basis
    ELSE p."end_relative_basis"
  END,
  "end_relative_value" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_end" < l."parent_start" THEN l."target_end" - l."parent_start"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target_end" > l."parent_end" THEN l."target_end" - l."parent_end"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND p."end_date_type" = 'relative' AND l."target_end" IS NOT NULL THEN ROUND(10000.0 * (l."target_end" - l."parent_start")::numeric / NULLIF((l."parent_end" - l."parent_start")::numeric, 0))::integer
    ELSE p."end_relative_value"
  END
FROM "legacy_phase_dates" l
WHERE l."id" = p."id"
  AND (l."target_start" IS NOT NULL OR l."target_end" IS NOT NULL);--> statement-breakpoint

-- Do the same for Calendar events.
WITH "legacy_event_dates" AS (
  SELECT
    e."id",
    c."start_date" AS "parent_start",
    c."end_date" AS "parent_end",
    e."date" AS "target"
  FROM "calendar_event" e
  JOIN "cycle" c ON c."id" = e."cycle_id"
  WHERE e."date_type" = 'relative'
)
UPDATE "calendar_event" e
SET
  "relative_basis" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" < l."parent_start" THEN 'start'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" > l."parent_end" THEN 'end'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL THEN 'between'::date_relative_basis
    ELSE e."relative_basis"
  END,
  "relative_value" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" < l."parent_start" THEN l."target" - l."parent_start"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" > l."parent_end" THEN l."target" - l."parent_end"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" IS NOT NULL THEN ROUND(10000.0 * (l."target" - l."parent_start")::numeric / NULLIF((l."parent_end" - l."parent_start")::numeric, 0))::integer
    ELSE e."relative_value"
  END
FROM "legacy_event_dates" l
WHERE l."id" = e."id" AND l."target" IS NOT NULL;--> statement-breakpoint

-- Task milestones have no cached date, so reconstruct the old target from
-- the old recipe before normalizing it.
WITH "legacy_milestones" AS (
  SELECT
    m."id",
    CASE WHEN m."parent_type" = 'cycle' THEN c."start_date" ELSE p."start_date" END AS "parent_start",
    CASE WHEN m."parent_type" = 'cycle' THEN c."end_date" ELSE p."end_date" END AS "parent_end",
    CASE
      WHEN m."relative_mode" = 'percent' AND (CASE WHEN m."parent_type" = 'cycle' THEN c."start_date" ELSE p."start_date" END) IS NOT NULL
        AND (CASE WHEN m."parent_type" = 'cycle' THEN c."end_date" ELSE p."end_date" END) IS NOT NULL
        THEN (CASE WHEN m."parent_type" = 'cycle' THEN c."start_date" ELSE p."start_date" END)
          + ROUND(((CASE WHEN m."parent_type" = 'cycle' THEN c."end_date" ELSE p."end_date" END) - (CASE WHEN m."parent_type" = 'cycle' THEN c."start_date" ELSE p."start_date" END)) * m."percent" / 100.0)::integer
      WHEN m."relative_mode" = 'offset' AND m."anchor_type" IN ('cycle_start', 'phase_start')
        THEN (CASE WHEN m."parent_type" = 'cycle' THEN c."start_date" ELSE p."start_date" END) + m."offset_days"
      WHEN m."relative_mode" = 'offset' AND m."anchor_type" IN ('cycle_end', 'phase_end')
        THEN (CASE WHEN m."parent_type" = 'cycle' THEN c."end_date" ELSE p."end_date" END) + m."offset_days"
      ELSE NULL
    END AS "target"
  FROM "task_milestone" m
  JOIN "task" t ON t."id" = m."task_id"
  LEFT JOIN "cycle" c ON c."id" = t."cycle_id"
  LEFT JOIN "phase" p ON p."id" = COALESCE(m."phase_id", t."phase_id")
  WHERE m."date_type" = 'relative'
)
UPDATE "task_milestone" m
SET
  "relative_basis" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" < l."parent_start" THEN 'start'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" > l."parent_end" THEN 'end'::date_relative_basis
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL THEN 'between'::date_relative_basis
    ELSE m."relative_basis"
  END,
  "relative_value" = CASE
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" < l."parent_start" THEN l."target" - l."parent_start"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" > l."parent_end" THEN l."target" - l."parent_end"
    WHEN l."parent_start" IS NOT NULL AND l."parent_end" IS NOT NULL AND l."target" IS NOT NULL THEN ROUND(10000.0 * (l."target" - l."parent_start")::numeric / NULLIF((l."parent_end" - l."parent_start")::numeric, 0))::integer
    ELSE m."relative_value"
  END
FROM "legacy_milestones" l
WHERE l."id" = m."id" AND l."target" IS NOT NULL;--> statement-breakpoint

ALTER TABLE "phase" DROP COLUMN "start_relative_mode";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "start_offset_anchor";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "start_offset_days";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "start_percent";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "end_relative_mode";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "end_offset_anchor";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "end_offset_days";--> statement-breakpoint
ALTER TABLE "phase" DROP COLUMN "end_percent";--> statement-breakpoint
ALTER TABLE "task_milestone" DROP COLUMN "relative_mode";--> statement-breakpoint
ALTER TABLE "task_milestone" DROP COLUMN "anchor_type";--> statement-breakpoint
ALTER TABLE "task_milestone" DROP COLUMN "offset_days";--> statement-breakpoint
ALTER TABLE "task_milestone" DROP COLUMN "percent";--> statement-breakpoint
ALTER TABLE "calendar_event" DROP COLUMN "relative_mode";--> statement-breakpoint
ALTER TABLE "calendar_event" DROP COLUMN "anchor_type";--> statement-breakpoint
ALTER TABLE "calendar_event" DROP COLUMN "offset_days";--> statement-breakpoint
ALTER TABLE "calendar_event" DROP COLUMN "percent";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "start_relative_mode";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "start_offset_anchor";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "start_offset_days";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "start_percent";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "end_relative_mode";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "end_offset_anchor";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "end_offset_days";--> statement-breakpoint
ALTER TABLE "pack_phase" DROP COLUMN "end_percent";--> statement-breakpoint
DROP TYPE "public"."cycle_offset_anchor";--> statement-breakpoint
DROP TYPE "public"."date_relative_mode";--> statement-breakpoint
DROP TYPE "public"."milestone_anchor_type";
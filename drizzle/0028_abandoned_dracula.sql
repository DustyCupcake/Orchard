CREATE TYPE "public"."cycle_offset_anchor" AS ENUM('cycle_start', 'cycle_end');--> statement-breakpoint
CREATE TYPE "public"."date_relative_mode" AS ENUM('offset', 'percent');--> statement-breakpoint
CREATE TYPE "public"."date_type" AS ENUM('absolute', 'relative');--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_date_type" date_type DEFAULT 'absolute' NOT NULL;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_relative_mode" date_relative_mode;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_offset_anchor" "cycle_offset_anchor";--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_offset_days" integer;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "start_percent" integer;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_date_type" date_type DEFAULT 'absolute' NOT NULL;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_relative_mode" date_relative_mode;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_offset_anchor" "cycle_offset_anchor";--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_offset_days" integer;--> statement-breakpoint
ALTER TABLE "phase" ADD COLUMN "end_percent" integer;
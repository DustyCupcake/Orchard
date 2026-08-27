CREATE TYPE "public"."branch_membership_model" AS ENUM('emergent', 'explicit');--> statement-breakpoint
CREATE TYPE "public"."membership_model" AS ENUM('cohort', 'rolling', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."tier_criterion_type" AS ENUM('manual', 'tenure', 'completion', 'cohort', 'cycle_type_count');--> statement-breakpoint
CREATE TYPE "public"."branch_status" AS ENUM('confirmed', 'pending');--> statement-breakpoint
CREATE TYPE "public"."cycle_source_type" AS ENUM('blank', 'pack');--> statement-breakpoint
CREATE TYPE "public"."cycle_status" AS ENUM('draft', 'round_0', 'round_1', 'round_2', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."task_attention_level" AS ENUM('ok', 'soft', 'hard', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."task_effort" AS ENUM('one_off', 'ongoing', 'owns_a_thing');--> statement-breakpoint
CREATE TYPE "public"."task_openness" AS ENUM('open', 'request', 'coordination_approved', 'community_endorsed');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('unclaimed', 'claimed', 'waiting', 'done');--> statement-breakpoint
CREATE TYPE "public"."requirement_mode" AS ENUM('individual_gate', 'group_coverage', 'soft_priority');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('tier', 'language', 'completed_task', 'custom');--> statement-breakpoint
CREATE TABLE "community" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"membership_model" "membership_model" DEFAULT 'rolling' NOT NULL,
	"branch_membership_model" "branch_membership_model" DEFAULT 'emergent' NOT NULL,
	"cycles_enabled" boolean DEFAULT false NOT NULL,
	"cycle_initiation_tier_id" uuid,
	"phases_enabled" boolean DEFAULT false NOT NULL,
	"onsite_mode_enabled" boolean DEFAULT false NOT NULL,
	"input_round_interval_days" integer DEFAULT 7 NOT NULL,
	"default_call_has_agenda" boolean DEFAULT false NOT NULL,
	"default_call_needs_summary" boolean DEFAULT false NOT NULL,
	"default_call_require_read" boolean DEFAULT false NOT NULL,
	"modules_enabled" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tier" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"criterion_type" "tier_criterion_type" DEFAULT 'manual' NOT NULL,
	"criterion_config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" "branch_status" DEFAULT 'confirmed' NOT NULL,
	"default_call_has_agenda" boolean,
	"default_call_needs_summary" boolean,
	"default_call_require_read" boolean
);
--> statement-breakpoint
CREATE TABLE "cycle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "cycle_status" DEFAULT 'draft' NOT NULL,
	"started_by" uuid,
	"started_at" timestamp with time zone,
	"source_type" "cycle_source_type" DEFAULT 'blank' NOT NULL,
	"capacity" integer,
	"returning_window_closes_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "phase" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"name" text NOT NULL,
	"order" integer NOT NULL,
	"start_date" date,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"tier_ids" uuid[] DEFAULT '{}' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"referred_by_member_id" uuid
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"cycle_id" uuid,
	"phase_id" uuid,
	"parent_task_id" uuid,
	"cloned_from_task_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"effort" "task_effort" NOT NULL,
	"effort_magnitude" jsonb NOT NULL,
	"status" "task_status" DEFAULT 'unclaimed' NOT NULL,
	"capacity" integer DEFAULT 1,
	"openness" "task_openness" DEFAULT 'request' NOT NULL,
	"endorsement_threshold" integer,
	"browse_period_end" timestamp with time zone,
	"critical" boolean DEFAULT false NOT NULL,
	"next_checkin_at" timestamp with time zone,
	"waiting_note" text,
	"created_by" uuid NOT NULL,
	"suggested_member_id" uuid,
	"attention_level" "task_attention_level" DEFAULT 'ok' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_resource" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"added_by" uuid NOT NULL,
	"label" text NOT NULL,
	"url" text NOT NULL,
	"tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_wiki_revision" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"content" text NOT NULL,
	"edited_by" uuid NOT NULL,
	"edited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignment" (
	"task_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"is_coordination_slot" boolean DEFAULT false NOT NULL,
	"is_shadow" boolean DEFAULT false NOT NULL,
	"is_outgoing" boolean DEFAULT false NOT NULL,
	"gate_waived_by" uuid,
	"gate_waived_reason" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignment_task_id_member_id_pk" PRIMARY KEY("task_id","member_id")
);
--> statement-breakpoint
CREATE TABLE "task_dependency" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependency_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "requirement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"type" "requirement_type" NOT NULL,
	"mode" "requirement_mode" DEFAULT 'individual_gate' NOT NULL,
	"value" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "community" ADD CONSTRAINT "community_cycle_initiation_tier_id_tier_id_fk" FOREIGN KEY ("cycle_initiation_tier_id") REFERENCES "public"."tier"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tier" ADD CONSTRAINT "tier_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle" ADD CONSTRAINT "cycle_started_by_member_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phase" ADD CONSTRAINT "phase_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_referred_by_member_id_member_id_fk" FOREIGN KEY ("referred_by_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_branch_id_branch_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branch"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_phase_id_phase_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phase"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_parent_task_id_task_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_cloned_from_task_id_task_id_fk" FOREIGN KEY ("cloned_from_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_suggested_member_id_member_id_fk" FOREIGN KEY ("suggested_member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_resource" ADD CONSTRAINT "task_resource_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_resource" ADD CONSTRAINT "task_resource_added_by_member_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_wiki_revision" ADD CONSTRAINT "task_wiki_revision_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_wiki_revision" ADD CONSTRAINT "task_wiki_revision_edited_by_member_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_member_id_member_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignment" ADD CONSTRAINT "task_assignment_gate_waived_by_member_id_fk" FOREIGN KEY ("gate_waived_by") REFERENCES "public"."member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependency" ADD CONSTRAINT "task_dependency_depends_on_task_id_task_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement" ADD CONSTRAINT "requirement_task_id_task_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."task"("id") ON DELETE no action ON UPDATE no action;
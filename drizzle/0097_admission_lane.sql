CREATE TYPE "public"."admission_lane_kind" AS ENUM('invite', 'public');--> statement-breakpoint
CREATE TYPE "public"."admission_verification" AS ENUM('none', 'community_check');--> statement-breakpoint
CREATE TYPE "public"."admission_arrival_route" AS ENUM('invite', 'application');--> statement-breakpoint
CREATE TYPE "public"."admission_origin" AS ENUM('funnel', 'import');--> statement-breakpoint
CREATE TABLE "admission_lane" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "admission_lane_kind" NOT NULL,
	"handles_knows_personally" boolean DEFAULT false NOT NULL,
	"handles_good_fit_only" boolean DEFAULT false NOT NULL,
	"handles_neither" boolean DEFAULT false NOT NULL,
	"public_slug" text,
	"application_required" boolean DEFAULT true NOT NULL,
	"interview_required" boolean DEFAULT true NOT NULL,
	"verification" "admission_verification" DEFAULT 'none' NOT NULL,
	"reports_needed" integer,
	"support_shortcut_count" integer,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"community_id" uuid NOT NULL,
	"cycle_id" uuid,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"lane_id" uuid NOT NULL,
	"route" "admission_arrival_route" NOT NULL,
	"origin" "admission_origin" DEFAULT 'funnel' NOT NULL,
	"invite_id" uuid,
	"form_response_id" uuid,
	"required_verification" "admission_verification" DEFAULT 'none' NOT NULL,
	"required_application" boolean DEFAULT true NOT NULL,
	"required_interview" boolean DEFAULT true NOT NULL,
	"required_evaluation" boolean DEFAULT true NOT NULL,
	"reports_needed" integer,
	"support_shortcut_count" integer,
	"token" text NOT NULL,
	"consent_given_at" timestamp with time zone,
	"check_passed_at" timestamp with time zone,
	"application_submitted_at" timestamp with time zone,
	"interview_scheduled_at" timestamp with time zone,
	"interview_held_at" timestamp with time zone,
	"decision_recorded_at" timestamp with time zone,
	"support_shortcut_reached_at" timestamp with time zone,
	"admitted_at" timestamp with time zone,
	"admitted_member_id" uuid,
	"declined_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"waitlisted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admission_lane" ADD CONSTRAINT "admission_lane_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_community_id_community_id_fk" FOREIGN KEY ("community_id") REFERENCES "public"."community"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_lane_id_admission_lane_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."admission_lane"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admission" ADD CONSTRAINT "admission_form_response_id_form_response_id_fk" FOREIGN KEY ("form_response_id") REFERENCES "public"."form_response"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admission_lane_community_name_idx" ON "admission_lane" USING btree ("community_id","name");--> statement-breakpoint
-- Partial: a public lane's slug has to be unique among public lanes, but
-- invite lanes have no slug at all (null), and Postgres treats nulls in a
-- unique index as distinct — so one index over (community_id, public_slug)
-- already admits any number of slug-less invite lanes. Kept as a plain
-- index rather than partial for the same reason joining_lane's is: this
-- drizzle-kit version cannot serialize `index.where`.
CREATE UNIQUE INDEX "admission_lane_community_public_slug_idx" ON "admission_lane" USING btree ("community_id","public_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_token_idx" ON "admission" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "admission_community_email_unique" ON "admission" USING btree ("community_id","email");--> statement-breakpoint
-- §2a: "An existing community's four lanes are carried over as they are."
--
-- Every community gets the four lanes the old fixed enum described, with
-- the configuration JOINING_LANE_DEFAULTS seeded for it. A community that
-- has since edited its joining_lane rows keeps *those*, read per lane, so
-- this reproduces today's behaviour rather than the documented default.
--
-- The two carries that need a decision rather than a copy:
--
--   - `nomination` becomes verification `none` with its support count kept
--     as the support shortcut (§2). Nomination is gone as a *waiting* mode
--     (the waiting model is what §7 deletes), but a community that chose
--     it wanted other members' word on that lane, and support still
--     exists — it just runs alongside the path instead of in front of it.
--     Dropping the shortcut instead would silently discard a decision
--     somebody made.
--   - `consensus` becomes `community_check`, a rename rather than a
--     change: §5 keeps it and gives it the same body.
--
-- Reads `cycle_id is null` (the community-wide row) rather than every row,
-- because a cycle row is an *override* and §2a retires per-event overrides
-- in favour of a context choosing which lanes are open. A lane's identity
-- is its community-wide row.
insert into admission_lane (community_id, name, kind, handles_knows_personally, handles_good_fit_only, handles_neither, public_slug, application_required, interview_required, verification, reports_needed, support_shortcut_count)
select
  c.id,
  seed.name,
  seed.kind,
  seed.handles_knows_personally,
  seed.handles_good_fit_only,
  seed.handles_neither,
  seed.public_slug,
  coalesce(rule.application_required, seed.application_required),
  coalesce(rule.interview_required, seed.interview_required),
  case coalesce(rule.verification_mode, 'basic')
    when 'consensus' then 'community_check'::admission_verification
    when 'nomination' then 'none'::admission_verification
    else 'none'::admission_verification
  end,
  -- Reports needed moves off the community-wide recruitmentEvaluatorCount
  -- onto each lane (§7), so every existing lane takes the current value and
  -- nothing changes until someone edits one. Null where the lane has
  -- nothing to evaluate: a lane with neither application nor interview has
  -- no report to file, and the seeded knows-personally lane is exactly that.
  case
    when coalesce(rule.application_required, seed.application_required)
      or coalesce(rule.interview_required, seed.interview_required)
      then coalesce(c.recruitment_evaluator_count, 2)
    else null
  end,
  case coalesce(rule.verification_mode, 'basic')
    when 'nomination' then coalesce(rule.support_count, 1)
    else null
  end
from community c
cross join (values
  ('Invited — knows personally', 'invite'::admission_lane_kind, true,  false, false, null::text, false, false),
  ('Invited — vouches (good fit)', 'invite'::admission_lane_kind, false, true,  false, null::text, true,  true),
  ('Invited — neither mark',      'invite'::admission_lane_kind, false, false, true,  null::text, true,  true),
  ('Open application',            'public'::admission_lane_kind, false, false, false, null::text, true,  true)
) as seed(name, kind, handles_knows_personally, handles_good_fit_only, handles_neither, public_slug, application_required, interview_required)
left join joining_lane rule
  on rule.community_id = c.id
  and rule.cycle_id is null
  and rule.lane = case seed.name
    when 'Invited — knows personally' then 'invited_knows_personally'::joining_lane_kind
    when 'Invited — vouches (good fit)' then 'invited_good_fit'::joining_lane_kind
    when 'Invited — neither mark' then 'invited_neither'::joining_lane_kind
    else 'public_application'::joining_lane_kind
  end;
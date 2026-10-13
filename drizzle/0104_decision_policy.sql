CREATE TYPE "public"."recruitment_any_no_means" AS ENUM('wider_discussion', 'decline');--> statement-breakpoint
CREATE TYPE "public"."recruitment_discussion_ends" AS ENUM('admit', 'decline');--> statement-breakpoint
CREATE TYPE "public"."recruitment_in_when" AS ENUM('no_no_one_yes', 'more_yes_than_no', 'all_yes', 'custom');--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_in_when" "recruitment_in_when" DEFAULT 'no_no_one_yes' NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_custom_min_yes" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_custom_max_no" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_any_no_means" "recruitment_any_no_means" DEFAULT 'wider_discussion' NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_discussion_ends" "recruitment_discussion_ends" DEFAULT 'decline' NOT NULL;--> statement-breakpoint
ALTER TABLE "community" ADD COLUMN "recruitment_decline_outright_at" integer;--> statement-breakpoint
-- Carry each community's ordered decision rules over into the form, where they
-- have a shape the form can say. The old rules could only say "at least N said X",
-- so the three things that matter are recoverable: the first plain "at least k
-- proceed → proceed" rule becomes "in when at least k yes" (with no cap on no's,
-- since k yes out of N reports already bounds them), the first plain "at least k
-- decline → decline" becomes "decline outright at k", and the closing fallback says
-- what any other set of reports leads to — a wider discussion (and which way it
-- ends if nobody raises a concern) or a decline. A rule that read the inviter's
-- marks has no equivalent (the marks pick the lane now, and vouches are shown to
-- the evaluators) and is dropped. Communities with no rules keep the defaults. The
-- old column stays, unread, so a carry can be checked against what it came from.
with rules as (
  select c.id as community_id, c.recruitment_evaluator_count as n, r.rule, r.ord,
         jsonb_array_length(c.recruitment_decision_rules) as len
  from community c, jsonb_array_elements(c.recruitment_decision_rules) with ordinality as r(rule, ord)
  where jsonb_array_length(c.recruitment_decision_rules) > 0
),
plain as (
  select * from rules
  where rule->'conditions' ? 'minCounts'
    and not (rule->'conditions' ? 'inviterThinksGoodFit')
    and not (rule->'conditions' ? 'inviterKnowsPersonally')
),
proceed_rule as (
  select distinct on (community_id) community_id, n, (rule->'conditions'->'minCounts'->>'proceed')::int as k
  from plain where rule->>'outcome' = 'proceed' and rule->'conditions'->'minCounts' ? 'proceed'
  order by community_id, ord
),
decline_rule as (
  select distinct on (community_id) community_id, (rule->'conditions'->'minCounts'->>'decline')::int as k
  from plain where rule->>'outcome' = 'decline' and rule->'conditions'->'minCounts' ? 'decline'
  order by community_id, ord
),
fallback as (
  select community_id, rule->>'outcome' as outcome, rule->>'defaultResolution' as resolution
  from rules
  where ord = len
    and not (rule->'conditions' ? 'inviterThinksGoodFit')
    and not (rule->'conditions' ? 'inviterKnowsPersonally')
    and (not (rule->'conditions' ? 'minCounts') or rule->'conditions'->'minCounts' = '{}'::jsonb)
)
update community c set
  recruitment_in_when = case when p.k is not null then 'custom'::recruitment_in_when else c.recruitment_in_when end,
  recruitment_custom_min_yes = coalesce(p.k, c.recruitment_custom_min_yes),
  recruitment_custom_max_no = case when p.k is not null then greatest(p.n, 0) else c.recruitment_custom_max_no end,
  recruitment_decline_outright_at = d.k,
  recruitment_any_no_means = case when f.outcome = 'decline' then 'decline'::recruitment_any_no_means else c.recruitment_any_no_means end,
  recruitment_discussion_ends = case when f.outcome = 'wider_discussion' and f.resolution = 'proceed' then 'admit'::recruitment_discussion_ends
                                     when f.outcome = 'wider_discussion' then 'decline'::recruitment_discussion_ends
                                     else c.recruitment_discussion_ends end
from (select id from community where jsonb_array_length(recruitment_decision_rules) > 0) m
left join proceed_rule p on p.community_id = m.id
left join decline_rule d on d.community_id = m.id
left join fallback f on f.community_id = m.id
where c.id = m.id;

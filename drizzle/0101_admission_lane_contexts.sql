CREATE TABLE "cycle_admission_lane" (
	"cycle_id" uuid NOT NULL,
	"lane_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cycle" ADD COLUMN "own_admission_lanes" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "admission_lane" ADD COLUMN "open_in_community" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "cycle_admission_lane" ADD CONSTRAINT "cycle_admission_lane_cycle_id_cycle_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycle"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cycle_admission_lane" ADD CONSTRAINT "cycle_admission_lane_lane_id_admission_lane_id_fk" FOREIGN KEY ("lane_id") REFERENCES "public"."admission_lane"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cycle_admission_lane_unique" ON "cycle_admission_lane" USING btree ("cycle_id","lane_id");--> statement-breakpoint
-- §2a retires per-event override rows in favour of an event choosing which
-- lanes are open. An event that had overridden a lane keeps exactly what it
-- had: the override becomes a lane of its own (named for the lane and the
-- event), open only in that event; the event gets its own set made of those
-- plus the community's lane for every kind it had not overridden.
--
-- joining_lane itself is left in place, unread, until the clean-up step drops
-- it, so a bad carry can be looked at rather than reconstructed.
alter table admission_lane add column carry_cycle_id uuid, add column carry_lane joining_lane_kind;--> statement-breakpoint
insert into admission_lane (community_id, name, kind, handles_knows_personally, handles_good_fit_only, handles_neither, application_required, interview_required, verification, reports_needed, support_shortcut_count, open_in_community, carry_cycle_id, carry_lane)
select
  q.community_id,
  q.name || case when count(*) over (partition by q.community_id, q.name) > 1
    then ' ' || row_number() over (partition by q.community_id, q.name order by q.cycle_id) else '' end,
  q.kind, q.k, q.g, q.n, q.application_required, q.interview_required, q.verification,
  q.reports_needed, q.support_shortcut_count, false, q.cycle_id, q.lane
from (
  select
    jl.community_id,
    jl.cycle_id,
    jl.lane,
    seed.title || ' — ' || cy.name as name,
    seed.kind,
    seed.k, seed.g, seed.n,
    jl.application_required,
    jl.interview_required,
    case jl.verification_mode when 'consensus' then 'community_check'::admission_verification else 'none'::admission_verification end as verification,
    case when jl.application_required or jl.interview_required then coalesce(c.recruitment_evaluator_count, 2) else null end as reports_needed,
    case jl.verification_mode when 'nomination' then jl.support_count else null end as support_shortcut_count
  from joining_lane jl
  join cycle cy on cy.id = jl.cycle_id
  join community c on c.id = jl.community_id
  join (values
    ('invited_knows_personally'::joining_lane_kind, 'Invited — knows personally', 'invite'::admission_lane_kind, true,  false, false),
    ('invited_good_fit'::joining_lane_kind,         'Invited — vouches (good fit)', 'invite'::admission_lane_kind, false, true,  false),
    ('invited_neither'::joining_lane_kind,          'Invited — neither mark',      'invite'::admission_lane_kind, false, false, true),
    ('public_application'::joining_lane_kind,       'Open application',            'public'::admission_lane_kind, false, false, false)
  ) as seed(lane, title, kind, k, g, n) on seed.lane = jl.lane
  where jl.cycle_id is not null
) q;--> statement-breakpoint
update cycle set own_admission_lanes = true
where id in (select cycle_id from joining_lane where cycle_id is not null);--> statement-breakpoint
insert into cycle_admission_lane (cycle_id, lane_id)
select cy.id, coalesce(ovr.id, comm.id)
from cycle cy
cross join (values
  ('invited_knows_personally'::joining_lane_kind, 'Invited — knows personally'),
  ('invited_good_fit'::joining_lane_kind,         'Invited — vouches (good fit)'),
  ('invited_neither'::joining_lane_kind,          'Invited — neither mark'),
  ('public_application'::joining_lane_kind,       'Open application')
) as kinds(lane, title)
join admission_lane comm
  on comm.community_id = cy.community_id and comm.name = kinds.title and comm.carry_cycle_id is null
left join admission_lane ovr
  on ovr.carry_cycle_id = cy.id and ovr.carry_lane = kinds.lane
where cy.own_admission_lanes;--> statement-breakpoint
alter table admission_lane drop column carry_cycle_id, drop column carry_lane;

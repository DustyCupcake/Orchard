import type { community as communityTable } from "@/db/schema";
import { SettingsCard, SettingsSection, TextField, ToggleField } from "../ui";
import {
  updateCoordinationTimingsAction,
  updateIndicatorSettingsAction,
  updateResponseTrackingAction,
} from "../actions";

export default function CoordinationTab({ community }: { community: typeof communityTable.$inferSelect }) {
  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Deadlines"
        description="How long somebody gets before a thing is somebody else's problem. Every one of these is a *quiet* default, not a deadline: nothing is refused when a clock runs out, it just stops being held by the person it was waiting on."
      >
        <SettingsCard
          action={updateCoordinationTimingsAction}
          submitLabel="Save deadlines"
          title="Response windows"
          state={
            <>
              A conflict report is overdue after {community.conflictAckWindowHours}h · a task
              nomination goes back after {pluralDays(community.taskNominationResponseDays)} · a
              published call summary counts as unread after {pluralDays(community.callSummaryReadWindowDays)}
            </>
          }
          description="All counted from the moment the thing was sent. The conflict window is in hours because it is a working-hours judgement; the other two are in days, because they are read by a person between other things."
        >
          <TextField
            label="Acknowledge a conflict report within (hours)"
            name="conflictAckWindowHours"
            type="number"
            defaultValue={community.conflictAckWindowHours}
            hint="After this, the report is shown as overdue on the conflict team's page. It is never escalated by the clock."
          />
          <TextField
            label="Answer a task nomination within (days)"
            name="taskNominationResponseDays"
            type="number"
            defaultValue={community.taskNominationResponseDays}
            hint="Pass the deadline by and the assignment goes back to Unclaimed — no penalty either way."
          />
          <TextField
            label="A call summary waits this long before counting as unread (days)"
            name="callSummaryReadWindowDays"
            type="number"
            defaultValue={community.callSummaryReadWindowDays}
            hint="How long before a published summary appears as something you haven't read."
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Response tracking"
        description="Reads a pattern of engagement across every surface where a member can act — offers, questions, messages, summaries — and puts it in their profile rather than in anybody's dashboard."
      >
        <SettingsCard
          action={updateResponseTrackingAction}
          submitLabel="Save thresholds"
          title="When a pattern is a pattern"
          state={
            <>
              Worth noticing at {community.engagementSoftFlagThreshold} missed responses · shown to
              the member themselves at {community.engagementPatternThreshold}. One response can
              never cross both.
            </>
          }
          description="The thresholds are a ladder: one response is ordinary, a few is worth noticing, more is a pattern. A single engagement event can never cross both bars on its own."
        >
          <TextField
            label="Noted at"
            name="engagementSoftFlagThreshold"
            type="number"
            defaultValue={community.engagementSoftFlagThreshold}
            hint="This many responses and it's quietly worth noticing."
          />
          <TextField
            label="Surfaced as a pattern at"
            name="engagementPatternThreshold"
            type="number"
            defaultValue={community.engagementPatternThreshold}
            hint="This many and the member sees it in their own profile. It's their number, about them, and nobody is told."
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Indicators"
        description="Community indicators are the patterns the data shows about who takes part — never published about a person, never gated. This one setting is only about how small a population can be broken out for."
      >
        <SettingsCard
          action={updateIndicatorSettingsAction}
          submitLabel="Save indicator settings"
          title="Breaking out a single event"
          state={
            community.cycleIndicatorsEnabled
              ? "On — each event's figures are shown for whoever is already in it"
              : "Off — indicators are only ever shown for the community as a whole"
          }
          description="An event population is both small and identifiable: you know exactly who's coming, so '1 in 8' is one person rather than a rounding error. This is the community's own lever against that."
        >
          <ToggleField
            label="Break indicators out per event"
            name="cycleIndicatorsEnabled"
            defaultChecked={community.cycleIndicatorsEnabled}
            hint="Off, indicators are only ever shown for the community as a whole. On, each event gets its own figures for whoever's already in it."
          />
          {/* The "never below this many members" floor that used to sit
              here is gone, and not because this is a tidier screen. It
              guarded breaking an indicator out for one event when the
              attendee count was small; but an indicator is now an
              aggregate of public questions only, so its breakdown is
              derivable from the per-person public answers and the
              participation list, and the floor guarded nothing that
              wasn't already visible. Its one remaining catch — a declined
              answer in a small population, where "1 of 3" identifies who
              didn't say — is a consequence of *counting declines* rather
              than of the floor, so dropping the floor had to drop the
              thing it guarded with it, or it would have dropped a guard
              without dropping what it guarded. See
              drizzle/0081_indicator_consent_collapse.sql, which drops the
              column and says the same thing at the place the decision
              belongs. */}
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}

/** "1 day" / "3 days", for a state line. A bare "3" next to a setting
 *  whose unit is the whole point would be the same unreadable number the
 *  label used to hide behind a wrong unit. */
function pluralDays(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

import { getJoinLaneRulesForContext, listLaneOverridesByCycle } from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_DEFAULTS, JOINING_LANE_ORDER, type JoiningLaneRule } from "@/lib/recruitment/lanes";
import type { community as communityTable, form as formTable } from "@/db/schema";
import Link from "next/link";
import { SelectField, SettingsGroup, SettingsPanel, SettingsSection, TextAreaField, TextField, ToggleField } from "../ui";
import {
  updateAdmissionRulesAction,
  updateRecruitmentApplicationAction,
  updateRecruitmentDecisionRulesAction,
  updateRecruitmentDoorsAction,
  updateRecruitmentWindowsAction,
} from "../actions";
import LaneRulesEditor from "../LaneRulesEditor";

const DECISION_RULES_EXAMPLE = `[
  {
    "conditions": { "minCounts": { "proceed": 2 } },
    "outcome": "proceed"
  },
  {
    "conditions": {},
    "outcome": "wider_discussion",
    "defaultResolution": "proceed"
  }
]`;

// §5.1's "Settings → Recruitment: Admission rules", reorganised around
// what somebody is actually trying to decide, in the order they decide
// it. The order matters and is not cosmetic:
//
//   1. the lanes — who gets in, and what happens to them. This is the
//      community's admission *design* and it is the first thing a reader
//      should meet, because everything below it is machinery for
//      implementing the design they just chose.
//   2. the doors — is any of it open right now.
//   3. the windows — how long the two kinds of waiting last, and the one
//      exception the community gets on concerns.
//   4. the application funnel — which form, who evaluates, how their
//      recommendations become an outcome.
//   5. decision rules, alone, because they are the one field on this
//      screen that is genuinely error-prone and used to share a Save
//      button with all of the above.
//
// The whole tab used to be one form with one Save, which meant a rejected
// decision-rule set silently reverted the doors and the windows; see
// ../actions.ts's own header for that.
export default async function RecruitmentTab({
  community,
  forms,
  cycles,
  authorized,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
  // Only to name the events that override these defaults below — the tab
  // has no other use for the list.
  cycles: { id: string; name: string }[];
  authorized: boolean;
}) {
  const rules = await getJoinLaneRulesForContext(community.id, null);
  const lanes = Object.fromEntries(
    JOINING_LANE_ORDER.map((lane) => [lane, rules.get(lane) ?? JOINING_LANE_DEFAULTS[lane]]),
  ) as Record<(typeof JOINING_LANE_ORDER)[number], JoiningLaneRule>;

  const activeForms = forms.filter((f) => !f.archivedAt);
  const noFormConfigured = !community.recruitmentApplicationFormId;

  // Which events shadow these defaults, and which lanes. Read on the
  // community screen because that is where a blind edit happens: these are
  // *defaults*, and a default only reaches an event whose lane isn't
  // overridden there. Without this line an Admin changes a community rule
  // with no way to know it will land at next year's reunion but not at the
  // event next month.
  const overrides = await listLaneOverridesByCycle(community.id);
  const cycleNameById = new Map(cycles.map((c) => [c.id, c.name]));

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Admission rules"
        description="Four ways in. What someone declares about themselves — or what the member inviting them declares — picks the lane, and this is what each lane does about it. The defaults are what Orchard does out of the box: someone you personally know joins straight away, everyone else fills in the form and has an interview."
      >
        {authorized ? (
          <SettingsGroup
            action={updateAdmissionRulesAction}
            submitLabel="Save admission rules"
            title="One rule per lane"
            aside={
              overrides.length > 0 ? (
                <Link
                  href="#lane-overrides"
                  className="text-[12px] font-medium text-[var(--accent-1)] hover:underline"
                >
                  {overrides.length} event{overrides.length === 1 ? "" : "s"} override
                  {overrides.length === 1 ? "s" : ""} these
                </Link>
              ) : undefined
            }
            state={
              <div className="flex flex-col gap-0.5">
                {JOINING_LANE_ORDER.map((lane) => (
                  <span key={lane}>
                    <span className="text-[var(--text)]">{laneTitle(lane)}:</span>{" "}
                    {laneSummary(lanes[lane])}
                  </span>
                ))}
              </div>
            }
            description="Verification and process are set per lane, never stacked: a lane either asks for extra proof or it asks for a form and an interview, not both kinds of waiting on one person."
          >
            <LaneRulesEditor initial={lanes} />
          </SettingsGroup>
        ) : (
          <SettingsPanel title="One rule per lane">
            <div className="flex flex-col gap-3">
              {JOINING_LANE_ORDER.map((lane) => (
                <div key={lane} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                  <p className="text-[13px] font-medium text-[var(--text)]">{laneTitle(lane)}</p>
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">{laneSummary(lanes[lane])}</p>
                </div>
              ))}
            </div>
          </SettingsPanel>
        )}

        {/* Named, and linked, because a default nobody can trace is a
            default nobody can reason about. This is the visible half of
            the never-snapshotted design: the row is not a frozen copy of
            the community rule, it is an absence, so it keeps tracking the
            community even after the community moves on. */}
        {overrides.length > 0 && (
          <div id="lane-overrides" className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-[12px] font-medium text-[var(--text)]">
              {overrides.length === 1 ? "One event runs" : `${overrides.length} events run`} different
              admission rules
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {overrides.map((o) => (
                <li key={o.cycleId} className="text-[12px] text-[var(--text-muted)]">
                  <Link
                    href={`/${o.cycleId}/participation`}
                    className="font-medium text-[var(--accent-1)] hover:underline"
                  >
                    {cycleNameById.get(o.cycleId) ?? "An event"}
                  </Link>{" "}
                  — {o.lanes.map((l) => laneTitle(l).toLowerCase()).join(", ")}
                </li>
              ))}
            </ul>
            <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
              Changing a rule above reaches every event except these — and reaches these only for
              the lanes they haven&rsquo;t overridden.
            </p>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Doors"
        description="Three independent doors, and they really are independent: closing interviews doesn't stop applications, and closing applications doesn't stop somebody you know joining outright. These are the community-wide, event-independent doors — each event can also close its own."
      >
        <SettingsGroup
          action={updateRecruitmentDoorsAction}
          submitLabel="Save doors"
          title="Open right now?"
          state={
            <>
              {[
                community.recruitmentApplicationsOpen ? "applications open" : "applications closed",
                community.recruitmentInvitesOpen ? "invites open" : "invites closed",
                community.recruitmentInterviewsOpen ? "interviews open" : "interviews closed",
              ].join(" · ")}
            </>
          }
          description="Close these to run the community fully closed except for the events or periods you open separately."
        >
          <ToggleField
            label="Applications"
            name="recruitmentApplicationsOpen"
            defaultChecked={community.recruitmentApplicationsOpen}
            hint="Whether anyone can apply at all, on any lane that asks for a form."
          />
          <ToggleField
            label="Invites"
            name="recruitmentInvitesOpen"
            defaultChecked={community.recruitmentInvitesOpen}
            hint="Whether a member can hand out an invite link. Someone you know personally can't join without one of these, so closing this closes that too."
          />
          <ToggleField
            label="Interviews"
            name="recruitmentInterviewsOpen"
            defaultChecked={community.recruitmentInterviewsOpen}
            hint="Whether an interview can be scheduled. New in the redesign: the interview stage used to be something that either always happened or was skipped by whoever arrived on a direct invite, and now it's a door you can close on its own."
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Windows and exceptions"
        description="Both of the plan's waiting periods live here rather than on a lane. That's deliberate: stacking a nomination and a community check on one lane would mean two timers and two sets of people who'd each think they owned the decision."
      >
        <SettingsGroup
          action={updateRecruitmentWindowsAction}
          submitLabel="Save windows"
          title="How long people wait"
          state={
            <>
              A nomination is backed for {community.recruitmentNominationWindowHours}h · a
              community-checked arrival is announced for {community.recruitmentWiderDiscussionHours}h
              · a concern is overruled by{" "}
              {community.recruitmentObjectionOverrule === "quorum"
                ? `${community.recruitmentObjectionQuorum} people`
                : "a majority of the mediation body"}
              .
            </>
          }
          description="A window never refuses anyone. When a support window lapses the person falls through to their lane's process, and when a community check closes with no concern the person is admitted — a clock can only ever let someone in, never out."
        >
          <TextField
            label="Support window (hours)"
            name="recruitmentNominationWindowHours"
            type="number"
            defaultValue={community.recruitmentNominationWindowHours}
            hint="How long someone waits for other members to back up a nomination. After this, nothing happens to them either way."
          />
          <TextField
            label="Community-check window (hours)"
            name="recruitmentWiderDiscussionHours"
            type="number"
            defaultValue={community.recruitmentWiderDiscussionHours}
            hint="How long a community-checked arrival stays announced before it's settled. It also sets the deadline quoted in the disclosure an invitee consents to, so the two can never disagree."
          />
          <SelectField
            label="Overrule threshold"
            name="recruitmentObjectionOverrule"
            defaultValue={community.recruitmentObjectionOverrule}
            options={[
              { value: "majority", label: "A majority of whoever holds Recruitment mediation" },
              { value: "quorum", label: "A fixed number of people" },
            ]}
            hint="The exception, and the only thing the community can vote over a concern. Clearing a concern is mediation's own job and needs no threshold; admitting somebody over a concern nobody could resolve needs this."
          />
          {community.recruitmentObjectionOverrule === "quorum" && (
            <TextField
              label="How many people"
              name="recruitmentObjectionQuorum"
              type="number"
              defaultValue={community.recruitmentObjectionQuorum}
              hint="If the mediation body is smaller than this, the overrule can't be exercised at all — which is a real choice, not a bug, and the mediation page says so plainly rather than letting one person quietly overrule."
            />
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="The application"
        description="What a newcomer fills in, who reads it, and how their readers' recommendations turn into an outcome."
      >
        {noFormConfigured && (
          <SettingsPanel title="No application form yet">
            <p className="text-[13px] text-[var(--text-muted)]">
              Build one under the Forms tab, then choose it here. Until you do, every lane that asks
              for a form has nothing to ask with — including the public application, which is only a
              door at all once there&rsquo;s something behind it.
            </p>
          </SettingsPanel>
        )}
        <SettingsGroup
          action={updateRecruitmentApplicationAction}
          submitLabel="Save application settings"
          title="Form, readers and words"
          state={
            <>
              {activeForms.find((f) => f.id === community.recruitmentApplicationFormId)
                ? `Applicants fill in "${activeForms.find((f) => f.id === community.recruitmentApplicationFormId)!.title}".`
                : "No application form chosen."}{" "}
              Decided at {community.recruitmentEvaluatorCount} recommendation
              {community.recruitmentEvaluatorCount === 1 ? "" : "s"} · a subscription lapses after{" "}
              {community.recruitmentSubscriptionLapseThreshold} no-show
              {community.recruitmentSubscriptionLapseThreshold === 1 ? "" : "s"} ·{" "}
              {community.recruitmentRejectionTemplate?.trim()
                ? "a decline draft exists"
                : "no decline draft written"}
              .
            </>
          }
          description="Everything about the funnel itself, apart from how readers' recommendations become an outcome — that has its own card below, because it's the field most likely to be wrong."
        >
          <SelectField
            label="Application form"
            name="recruitmentApplicationFormId"
            defaultValue={community.recruitmentApplicationFormId ?? ""}
            wide
            options={[
              { value: "", label: "— none configured —" },
              ...activeForms.map((f) => ({ value: f.id, label: f.title })),
            ]}
            hint="This is what renders at the public /apply page, and what any lane asking for a form asks with. An event can point at a different form of its own."
          />
          <TextField
            label="Evaluators needed before a decision is reached"
            name="recruitmentEvaluatorCount"
            type="number"
            defaultValue={community.recruitmentEvaluatorCount}
            hint="How many different people holding the recruitment task have to file a recommendation. Evaluators are whoever currently holds the task — set that up under Access & permissions."
          />
          <TextField
            label="Lapse a subscription after this many no-shows"
            name="recruitmentSubscriptionLapseThreshold"
            type="number"
            defaultValue={community.recruitmentSubscriptionLapseThreshold}
            hint="A subscription is the standing opt-in that lets a member see that something is pending and raise a concern. This turns one off after it many applications in a row with no availability offered."
          />
          <TextAreaField
            label="Starting point for a decline"
            name="recruitmentRejectionTemplate"
            defaultValue={community.recruitmentRejectionTemplate ?? ""}
            rows={5}
            hint="Shown to whoever is about to send an actual decline. Never sent automatically — this is a first draft to argue with, not a message the platform delivers."
          />
        </SettingsGroup>

        <SettingsGroup
          action={updateRecruitmentDecisionRulesAction}
          submitLabel="Save decision rules"
          title="How recommendations become an outcome"
          state={
            (community.recruitmentDecisionRules as DecisionRule[]).length === 0
              ? "No rules configured — no application can be decided at all"
              : describeDecisionRules(community.recruitmentDecisionRules as DecisionRule[])
          }
          description="An ordered list, first match wins. The last rule has to have no conditions — it's the fallback, and without it no application can be decided at all."
        >
          <TextAreaField
            label="Decision rules (JSON)"
            name="recruitmentDecisionRulesRaw"
            defaultValue={JSON.stringify(community.recruitmentDecisionRules, null, 2)}
            rows={12}
            mono
            required
            hint={
              <>
                An outcome is one of <code>proceed</code>, <code>wider_discussion</code> or{" "}
                <code>decline</code>. A <code>wider_discussion</code> rule must also say which way it
                goes by default (<code>defaultResolution</code>), because that is what happens if the
                community check finds nobody objecting. Conditions can also test the inviter&rsquo;s
                marks, so a rule can weigh how someone arrived as well as what the evaluators said.
              </>
            }
          />
          <div>
            <p className="text-[12px] font-medium text-[var(--text-muted)]">An example</p>
            <pre className="mt-1 overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--neutral-100)] p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
              {DECISION_RULES_EXAMPLE}
            </pre>
            <p className="mt-1 text-[12px] text-[var(--text-muted)]">
              That reads: two evaluators said proceed, so they&rsquo;re in. Otherwise announce it and
              give the community the check window, and admit them if nobody objects.
            </p>
          </div>
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}

function laneTitle(lane: (typeof JOINING_LANE_ORDER)[number]) {
  return {
    invited_knows_personally: "Invited — knows personally",
    invited_good_fit: "Invited — vouches (good fit)",
    invited_neither: "Invited — neither mark",
    public_application: "Public application",
  }[lane];
}

function laneSummary(rule: JoiningLaneRule) {
  const proof = {
    basic: "one member's word is enough",
    nomination: `needs ${rule.supportCount} more member${rule.supportCount === 1 ? "" : "s"}`,
    consensus: "announced to the community before admission",
  }[rule.verificationMode];
  const process = [
    rule.applicationRequired ? "an application" : null,
    rule.interviewRequired ? "an interview" : null,
  ].filter(Boolean);
  return `${proof}${process.length ? `, plus ${process.join(" and ")}` : ""}.`;
}

type DecisionRule = {
  conditions?: {
    minCounts?: { proceed?: number; decline?: number; unsure?: number };
    inviterThinksGoodFit?: boolean;
    inviterKnowsPersonally?: boolean;
  };
  outcome: "proceed" | "wider_discussion" | "decline";
  defaultResolution?: "proceed" | "decline";
};

/**
 * The rule set in the sentence an admin would use to describe it, so the
 * collapsed card says what the rules *do* rather than making the reader
 * open a JSON textarea to find out. This is the field the surrounding
 * comment calls the one most likely to be wrong, and it is also the one
 * that was previously only legible as escaped JSON — the two facts pull
 * against each other, and being able to read the intent without decoding
 * is what makes a wrong rule obvious before it decides somebody's
 * application.
 */
function describeDecisionRules(rules: DecisionRule[]): string {
  const parts = rules.map((r) => {
    const c = r.conditions?.minCounts ?? {};
    const bits: string[] = [];
    if (c.proceed !== undefined) bits.push(`${c.proceed} say proceed`);
    if (c.decline !== undefined) bits.push(`${c.decline} say decline`);
    if (c.unsure !== undefined) bits.push(`${c.unsure} unsure`);
    if (r.conditions?.inviterKnowsPersonally) bits.push("inviter knows them");
    if (r.conditions?.inviterThinksGoodFit) bits.push("inviter vouches");
    const when = bits.length ? bits.join(", ") : "anything else";
    if (r.outcome === "wider_discussion") {
      return `if ${when}, announce it to the community (resolving to ${r.defaultResolution ?? "?"} if nobody objects)`;
    }
    if (r.outcome === "proceed") return `if ${when}, they're in`;
    return `if ${when}, decline`;
  });
  return `${rules.length} rule${rules.length === 1 ? "" : "s"}, first match wins — ${parts.join("; ")}.`;
}

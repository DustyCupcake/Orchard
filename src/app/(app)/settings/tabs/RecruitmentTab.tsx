import { getJoinLaneRulesForContext, listLaneOverridesByCycle } from "@/lib/recruitment/joining-lanes";
import { JOINING_LANE_DEFAULTS, JOINING_LANE_ORDER, type JoiningLaneRule } from "@/lib/recruitment/lanes";
import type { community as communityTable, form as formTable } from "@/db/schema";
import type { RecruitmentDecisionRule } from "@/lib/recruitment/evaluations";
import Link from "next/link";
import { SelectField, SettingsGroup, SettingsPanel, SettingsSection, TextAreaField, TextField, ToggleField } from "../ui";
import {
  updateAdmissionRulesAction,
  updateRecruitmentApplicationAction,
  updateRecruitmentDecisionRulesAction,
  updateRecruitmentDoorsAction,
  updateRecruitmentCheckWindowAction,
  updateRecruitmentSupportWindowAction,
} from "../actions";
import LaneRulesEditor from "../LaneRulesEditor";
import DecisionRulesEditor, { describeRuleCondition } from "../DecisionRulesEditor";


// The tab is ordered as the pipeline runs, and each window sits next to the
// step it times rather than in a block of its own:
//
//   1. the lanes     — who gets in, and what they have to go through
//   2. support window — how long somebody waits to be backed up, i.e. the
//                      verification step of whichever lane asked for it
//   3. the form      — what a public applicant fills in
//   4. readers       — who evaluates, and how many of them
//   5. the rules     — how their recommendations become an outcome
//   6. check window  — how long a community-checked arrival stays announced
//   7. overrule      — what it takes to admit somebody over a concern
//   8. the doors     — whether any of it is open right now
//
// Two of those orderings are the point rather than a detail. The windows
// were one section between the application and the doors, which put the
// support window (a step *inside* admission) two sections away from the lane
// rule that invokes it, and the check window — which is triggered by a
// `wider_discussion` outcome — a screen away from the rules that produce
// one. A reader configuring "announce arrivals to the community" had to hold
// two sections in their head at once.
//
// The doors come last because they are the only question here with an answer
// that changes without anybody editing anything, and putting it at the end
// means the screen ends on the thing a reader most often wants: can someone
// apply today.
//
// What the whole tab used to be was one form with one Save, which meant a
// rejected decision-rule set silently reverted the doors and the windows;
// see ../actions.ts's own header for that.
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
        description="What someone declares about themselves — or what the member inviting them declares — picks one of four lanes, and each lane sets what happens next. Defaults: someone you personally know joins straight away, everyone else fills in the form and has an interview."
      >
        {authorized ? (
          <SettingsGroup
            action={updateAdmissionRulesAction}
            submitLabel="Save admission rules"
            title="One rule per lane"
          stateLabel="One rule per lane: verification and process for each of the four admission lanes"
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
            description="Set one verification and one process per lane."
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

        {/* The support window sits directly after the lane rules, because it
            only ever does anything for a lane set to "one more member's
            word" — the mode chosen two cards above. Setting the requirement
            and its clock in one place beats looking for the clock elsewhere. */}
        <SettingsGroup
          action={updateRecruitmentSupportWindowAction}
          submitLabel="Save support window"
          title="How long a nomination waits for backing"
          stateLabel="A nomination is backed for the configured number of hours, then the person carries on either way"
          state={
            <>
              A nomination is backed for {community.recruitmentNominationWindowHours} hours, then
              the person carries on either way.
            </>
          }
          description="Applies to a lane set to 'one more member's word'. A window can only let someone through, never turn them away: when it lapses they carry on regardless."
        >
          <TextField
            label="Support window (hours)"
            name="recruitmentNominationWindowHours"
            type="number"
            defaultValue={community.recruitmentNominationWindowHours}
            hint="How long someone waits for other members to back up a nomination."
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="The application"
        description="What a newcomer fills in, who reads it, and how their recommendations become an outcome."
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
          stateLabel="Which form applicants fill in, how many recommendations a decision needs, when a subscription lapses, and whether a decline draft is written"
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
          description="Which form, who reads it, and what the decline starts from."
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
            hint="How many different people holding the recruitment task must file a recommendation. Set who holds it under Access & permissions."
          />
          <TextField
            label="Lapse a subscription after this many no-shows"
            name="recruitmentSubscriptionLapseThreshold"
            type="number"
            defaultValue={community.recruitmentSubscriptionLapseThreshold}
            hint="Turns a subscription off after this many applications in a row with no availability offered. A subscription is what lets a member see something is pending and raise a concern."
          />
          <TextAreaField
            label="Starting point for a decline"
            name="recruitmentRejectionTemplate"
            defaultValue={community.recruitmentRejectionTemplate ?? ""}
            rows={5}
            hint="A first draft to argue with, shown to whoever is about to send the decline. Never sent automatically."
          />
        </SettingsGroup>


        <SettingsGroup
          action={updateRecruitmentDecisionRulesAction}
          submitLabel="Save decision rules"
          title="How recommendations become an outcome"
          stateLabel="The ordered decision rules, described in words"
          state={
            (community.recruitmentDecisionRules as DecisionRule[]).length === 0
              ? "No rules configured — no application can be decided at all"
              : describeDecisionRules(community.recruitmentDecisionRules as DecisionRule[])
          }
          description="An ordered list, first match wins. The last rule must have no conditions — it's the fallback, and without it no application can be decided."
        >
          {authorized ? (
            <DecisionRulesEditor initial={community.recruitmentDecisionRules as DecisionRule[]} />
          ) : (
            <p className="text-[13px] leading-relaxed text-[var(--text)]">
              {(community.recruitmentDecisionRules as DecisionRule[]).length === 0
                ? "No rules configured — no application can be decided at all."
                : describeDecisionRules(community.recruitmentDecisionRules as DecisionRule[])}
            </p>
          )}
        </SettingsGroup>
        {/* The check window and the overrule live here, next to the rules
            that can trigger them, rather than in a section of their own.
            A `wider_discussion` outcome is what starts this clock, so a
            reader asking "how long does the community have to object?"
            should not have to leave the decision rules to find out. */}
        <SettingsGroup
          action={updateRecruitmentCheckWindowAction}
          submitLabel="Save check window"
          title="How long a community check runs"
          stateLabel="How long a community-checked arrival stays announced, and what it takes to overrule a concern"
          state={
            <>
              A community-checked arrival stays announced for{" "}
              {community.recruitmentWiderDiscussionHours}h, and is admitted if nobody objects. A
              concern that can&rsquo;t be resolved is overruled by{" "}
              {community.recruitmentObjectionOverrule === "quorum"
                ? `${community.recruitmentObjectionQuorum} people`
                : "a majority of the mediation body"}
              .
            </>
          }
          description="Only applies to a lane set to 'the whole community sees them arrive', and to a decision rule whose outcome is a community check. A window can only let someone in, never out."
        >
          <TextField
            label="Community-check window (hours)"
            name="recruitmentWiderDiscussionHours"
            type="number"
            defaultValue={community.recruitmentWiderDiscussionHours}
            hint="How long a community-checked arrival stays announced before it's settled. Also the deadline quoted in the disclosure an invitee agrees to."
          />
          <SelectField
            label="Overrule threshold"
            name="recruitmentObjectionOverrule"
            defaultValue={community.recruitmentObjectionOverrule}
            options={[
              { value: "majority", label: "A majority of whoever holds Recruitment mediation" },
              { value: "quorum", label: "A fixed number of people" },
            ]}
            hint="What it takes to admit somebody over a concern that couldn't be resolved. Clearing a concern needs no threshold."
          />
          {community.recruitmentObjectionOverrule === "quorum" && (
            <TextField
              label="How many people"
              name="recruitmentObjectionQuorum"
              type="number"
              defaultValue={community.recruitmentObjectionQuorum}
              hint="If the mediation body has fewer people than this, the overrule can't be exercised at all."
            />
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Doors"
        description="Three independent doors, and they really are independent: closing interviews doesn't stop applications, or somebody you know joining outright. Community-wide; each event can also close its own."
      >
        <SettingsGroup
          action={updateRecruitmentDoorsAction}
          submitLabel="Save doors"
          title="Open right now?"
          stateLabel="Whether applications, invites and interviews are open"
          state={
            <>
              {[
                community.recruitmentApplicationsOpen ? "applications open" : "applications closed",
                community.recruitmentInvitesOpen ? "invites open" : "invites closed",
                community.recruitmentInterviewsOpen ? "interviews open" : "interviews closed",
              ].join(" · ")}
            </>
          }
          description="Close all three to run the community fully closed."
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
            hint="Whether an interview can be scheduled."
          />
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

// The column's own type, rather than a hand-written structural copy of it.
// The local copy drifted once already: it marked `conditions` optional,
// which made `rule.conditions.minCounts` a type error in the editor and had
// to be written as optional-chaining at every use. `conditions` is NOT
// optional in the schema — a rule without it is a parse error — and taking
// the type from the schema means the UI cannot describe a shape the server
// refuses.
type DecisionRule = RecruitmentDecisionRule;

function describeDecisionRules(rules: DecisionRule[]): string {
  const parts = rules.map((r) => {
    const when = describeRuleCondition(r.conditions);
    if (r.outcome === "wider_discussion") {
      return `if ${when}, announce it to the community (resolving to ${r.defaultResolution ?? "?"} if nobody objects)`;
    }
    if (r.outcome === "proceed") return `if ${when}, they're in`;
    return `if ${when}, decline`;
  });
  return `${rules.length} rule${rules.length === 1 ? "" : "s"}, first match wins \u2014 ${parts.join("; ")}.`;
}

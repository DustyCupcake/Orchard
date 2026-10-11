import { laneRuleOf, listEventLaneSets, listLanes } from "@/lib/recruitment/admission-lanes";
import { describeLaneConsequence } from "@/lib/recruitment/lane-rules";
import type { community as communityTable, form as formTable } from "@/db/schema";
import { policyOf } from "@/lib/recruitment/evaluations";
import { describeDecisionPolicy } from "@/lib/recruitment/decision-policy";
import { SelectField, SettingsGroup, SettingsPanel, SettingsSection, TextAreaField, TextField, ToggleField } from "../ui";
import {
  saveAdmissionLanesAction,
  updateRecruitmentApplicationAction,
  updateRecruitmentDecisionPolicyAction,
  updateRecruitmentDoorsAction,
  updateRecruitmentCheckWindowAction,
} from "../actions";
import AdmissionLaneEditor from "../AdmissionLaneEditor";
import DecisionPolicyEditor from "../DecisionPolicyEditor";


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
  authorized,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
  authorized: boolean;
}) {
  const laneRules = (await listLanes(community.id)).map(laneRuleOf);
  const eventSets = (await listEventLaneSets(community.id)).map((e) => ({ id: e.id, label: e.name, laneIds: e.laneIds }));

  const activeForms = forms.filter((f) => !f.archivedAt);
  const noFormConfigured = !community.recruitmentApplicationFormId;

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="Admission lanes"
        description="A lane is a way someone arrives, and sets what happens next. You define only the lanes you need: invitations from members who know someone personally, every other invitation, an open application — or only some of those."
      >
        {authorized ? (
          <SettingsGroup
            action={saveAdmissionLanesAction}
            submitLabel="Save lanes"
            title="Your lanes"
            stateLabel="The lanes this community takes people in through"
            state={
              laneRules.length === 0 ? (
                "No lanes — nobody can arrive."
              ) : (
                <div className="flex flex-col gap-0.5">
                  {laneRules.map((lane) => (
                    <span key={lane.id}>
                      <span className="text-[var(--text)]">{lane.name}:</span> {describeLaneConsequence(lane)}
                    </span>
                  ))}
                </div>
              )
            }
            description="Each lane says who arrives that way and what they go through. Anyone already in the process keeps the path they entered on when a lane changes."
          >
            <AdmissionLaneEditor initial={laneRules} eventSets={eventSets} />
          </SettingsGroup>
        ) : (
          <SettingsPanel title="Your lanes">
            <div className="flex flex-col gap-3">
              {laneRules.map((lane) => (
                <div key={lane.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                  <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{lane.name}</p>
                  <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{describeLaneConsequence(lane)}</p>
                </div>
              ))}
            </div>
          </SettingsPanel>
        )}
      </SettingsSection>

      <SettingsSection
        title="The application"
        description="What a newcomer fills in, who reads it, and how their recommendations become an outcome."
      >
        {noFormConfigured && (
          <SettingsPanel title="No application form yet">
            <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
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
          stateLabel="Which form applicants fill in, when a subscription lapses, and whether a decline draft is written"
          state={
            <>
              {activeForms.find((f) => f.id === community.recruitmentApplicationFormId)
                ? `Applicants fill in "${activeForms.find((f) => f.id === community.recruitmentApplicationFormId)!.title}".`
                : "No application form chosen."}{" "}
              A subscription lapses after{" "}
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
          action={updateRecruitmentDecisionPolicyAction}
          submitLabel="Save how reports decide"
          title="How reports decide"
          stateLabel="What a full set of reports means"
          state={describeDecisionPolicy(policyOf(community))}
          description="How many reports an application or interview needs is set on each lane. This is what a full set of them means — one policy for every lane."
        >
          {authorized ? (
            <DecisionPolicyEditor initial={policyOf(community)} />
          ) : (
            <p className="text-[length:var(--text-body)] leading-relaxed text-[var(--text)]">{describeDecisionPolicy(policyOf(community))}</p>
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
              {community.recruitmentWiderDiscussionHours}h, and goes on if nobody raises a concern. A
              concern that can&rsquo;t be resolved is overruled by{" "}
              {community.recruitmentObjectionOverrule === "quorum"
                ? `${community.recruitmentObjectionQuorum} people`
                : "a majority of the mediation body"}
              .
            </>
          }
          description="The one window every community check runs for — a lane set to 'the whole community sees them arrive', and a decision that leads to a wider discussion. A window that closes with no concern does what it said it would; one with a concern standing is only ever ended by the mediation body."
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

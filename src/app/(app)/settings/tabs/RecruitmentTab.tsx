import { laneRuleOf, listEventLaneSets, listLanes } from "@/lib/recruitment/admission-lanes";
import { describeLaneConsequence, laneRelevance } from "@/lib/recruitment/lane-rules";
import { listMediationMembers } from "@/lib/recruitment/mediation";
import type { community as communityTable, form as formTable, tier as tierTable } from "@/db/schema";
import { policyOf } from "@/lib/recruitment/evaluations";
import { describeDecisionPolicy } from "@/lib/recruitment/decision-policy";
import { SelectField, SettingsGroup, SettingsPanel, SettingsSection, TextAreaField, TextField, ToggleField } from "../ui";
import {
  saveAdmissionLanesAction,
  updateRecruitmentApplicationAction,
  updateRecruitmentDecisionPolicyAction,
  updateRecruitmentDoorsAction,
  updateRecruitmentCheckWindowAction,
  updateAccompanimentSettingsAction,
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
  tiers,
  authorized,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
  tiers: (typeof tierTable.$inferSelect)[];
  authorized: boolean;
}) {
  const laneRules = (await listLanes(community.id)).map(laneRuleOf);
  const eventSets = (await listEventLaneSets(community.id)).map((e) => ({ id: e.id, label: e.name, laneIds: e.laneIds }));

  const activeForms = forms.filter((f) => !f.archivedAt);
  const noFormConfigured = !community.recruitmentApplicationFormId;

  // What the lanes involve decides which of the sections below exist at all (§3): nobody is
  // asked to configure something no lane uses.
  const relevance = laneRelevance(laneRules, eventSets.flatMap((e) => e.laneIds));
  const policy = policyOf(community);
  const opensDiscussion = relevance.evaluates && policy.anyNoMeans === "wider_discussion";
  const showCheckWindow = relevance.anyCheck || opensDiscussion;
  const mediators = showCheckWindow ? await listMediationMembers(community.id) : [];

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

      {!relevance.anyApplication && !relevance.evaluates ? (
        <SettingsSection title="Evaluation" description="What happens between someone arriving and being let in.">
          <SettingsPanel title="Nothing to evaluate">
            <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
              {relevance.anyLane
                ? "None of your lanes asks for an application or an interview, so nobody is read about or reported on — people are admitted straight away or by the community check — and there is nothing to configure here. Add a lane with an application or an interview and this section appears."
                : "You have no lanes yet, so there is nothing to evaluate. Add one above and this section shows what it needs."}
            </p>
          </SettingsPanel>
        </SettingsSection>
      ) : (
      <SettingsSection
        title={relevance.anyApplication ? "The application" : "Evaluation"}
        description={
          relevance.anyApplication
            ? "What a newcomer fills in, who reads it, and how their recommendations become an outcome."
            : "Who reports after a conversation, and how their recommendations become an outcome."
        }
      >
        {noFormConfigured && relevance.anyApplication && (
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
          title={relevance.anyApplication ? "Form, readers and words" : "Readers and words"}
          stateLabel="Which form applicants fill in, and whether a decline draft is written"
          state={
            <>
              {relevance.anyApplication &&
                (activeForms.find((f) => f.id === community.recruitmentApplicationFormId)
                  ? `Applicants fill in "${activeForms.find((f) => f.id === community.recruitmentApplicationFormId)!.title}". `
                  : "No application form chosen. ")}
              {community.recruitmentRejectionTemplate?.trim()
                ? "a decline draft exists"
                : "no decline draft written"}
              .
            </>
          }
          description={relevance.anyApplication ? "Which form, who reads it, and what the decline starts from." : "Who reports, and what the decline starts from."}
        >
          {relevance.anyApplication && (
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
          )}
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
          state={describeDecisionPolicy(policy)}
          description="How many reports an application or interview needs is set on each lane. This is what a full set of them means — one policy for every lane that has one."
        >
          {authorized ? (
            <DecisionPolicyEditor initial={policy} />
          ) : (
            <p className="text-[length:var(--text-body)] leading-relaxed text-[var(--text)]">{describeDecisionPolicy(policy)}</p>
          )}
        </SettingsGroup>
      </SettingsSection>
      )}

      {showCheckWindow && (
        <SettingsSection
          title="Community check"
          description={
            relevance.anyCheck && opensDiscussion
              ? "A lane announces arrivals to the community, and a decision can open a wider discussion — both run the same window."
              : relevance.anyCheck
                ? "A lane announces arrivals to the community, and any member can raise a concern."
                : "A decision can open a wider discussion, in which any member can raise a concern."
          }
        >
          <SettingsGroup
            action={updateRecruitmentCheckWindowAction}
            submitLabel="Save check window"
            title="How long a community check runs"
            stateLabel="How long a window stays open, who settles a concern, and what it takes to overrule one"
            state={
              <>
                A window stays open for {community.recruitmentWiderDiscussionHours}h, and goes on if nobody raises a concern.{" "}
                {mediators.length === 0
                  ? "Nobody holds Recruitment mediation yet, so a concern would have nobody to settle it. "
                  : `Concerns are settled by ${mediators.map((m) => m.name).join(", ")}. `}
                A concern that can&rsquo;t be resolved is overruled by{" "}
                {community.recruitmentObjectionOverrule === "quorum"
                  ? `${community.recruitmentObjectionQuorum} people`
                  : "a majority of the mediation body"}
                .
              </>
            }
            description="The one window every community check runs for. A window that closes with no concern does what it said it would; one with a concern standing is only ever ended by the mediation body, which an administrator grants under Access & permissions, on the “Recruitment mediation” row."
          >
            <TextField
              label="Community-check window (hours)"
              name="recruitmentWiderDiscussionHours"
              type="number"
              defaultValue={community.recruitmentWiderDiscussionHours}
              hint="How long an arrival stays open to a concern. Also the deadline quoted in the disclosure an invitee agrees to."
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
      )}

      <SettingsSection
        title="Doors"
        description="Independent doors, and they really are independent: closing interviews doesn't stop applications, or somebody you know joining outright. Community-wide; each event can also close its own."
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
                ...(relevance.anyInterview ? [community.recruitmentInterviewsOpen ? "interviews open" : "interviews closed"] : []),
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
          {relevance.anyInterview && (
            <ToggleField
              label="Interviews"
              name="recruitmentInterviewsOpen"
              defaultChecked={community.recruitmentInterviewsOpen}
              hint="Whether an interview can be scheduled."
            />
          )}
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Accompaniment"
        description="Someone who is there for a new member from the start: a person to ask questions of and to check in with. It is a task like any other, made when someone is admitted, and the new member is always told about it."
      >
        <SettingsGroup
          action={updateAccompanimentSettingsAction}
          submitLabel="Save accompaniment"
          title="Does a new member get someone?"
          stateLabel="Whether new members are accompanied, by whom, and for how long"
          state={
            community.accompanimentEnabled ? (
              <>
                New members are accompanied for {community.accompanimentEndsAfterDays} days.{" "}
                {community.accompanimentTierId
                  ? `Only ${tiers.find((t) => t.id === community.accompanimentTierId)?.name ?? "a tier that no longer exists"} can take it on.`
                  : "Any member can take it on."}
              </>
            ) : (
              "New members are not given someone to accompany them."
            )
          }
          description="Changing this never touches an accompaniment already running; each one's end was fixed when it began."
        >
          <ToggleField
            label="Accompany new members"
            name="accompanimentEnabled"
            defaultChecked={community.accompanimentEnabled}
            hint="When someone is admitted, a task is made for a member to accompany them. People who were already members, and people added directly by an administrator, are not accompanied."
          />
          <SelectField
            label="Who may accompany"
            name="accompanimentTierId"
            defaultValue={community.accompanimentTierId ?? ""}
            options={[
              { value: "", label: "— any member —" },
              ...tiers.map((t) => ({ value: t.id, label: t.name })),
            ]}
            hint="Only members of this tier can take the task on."
          />
          <TextField
            label="Lasts (days)"
            name="accompanimentEndsAfterDays"
            type="number"
            defaultValue={community.accompanimentEndsAfterDays}
            hint="Counted from when the person is admitted. It also ends sooner if the accompanier marks the task done."
          />
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}

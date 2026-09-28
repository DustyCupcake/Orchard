import type {
  consentPurpose as consentPurposeTable,
  profileQuestion as profileQuestionTable,
  sensitiveFieldAccessRule as ruleTable,
  tier as tierTable,
  traitAxis as traitAxisTable,
} from "@/db/schema";
import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS } from "@/lib/permissions";
import {
  INDICATOR_FAMILY_LABELS,
  canPublishAsIndicator,
  indicatorBlocker,
  indicatorFamilyFor,
} from "@/lib/profile-questions/indicators";
import { toEditableFieldShape } from "@/lib/field-shape";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SelectField, SettingsCard, SettingsPanel, SettingsSection, TextField, ToggleField } from "../ui";
import {
  archiveProfileQuestionAction,
  archiveTraitAxisAction,
  createConsentPurposeAction,
  createProfileQuestionAction,
  createSensitiveFieldAccessRuleAction,
  createTraitAxisAction,
  deleteConsentPurposeAction,
  deleteSensitiveFieldAccessRuleAction,
  seedDefaultProfileQuestionsAction,
  unarchiveProfileQuestionAction,
  unarchiveTraitAxisAction,
  updateProfileQuestionAction,
  updateTraitAxisAction,
} from "../actions";
import ProfileQuestionEditor from "../ProfileQuestionEditor";
import StarterQuestionPicker from "../StarterQuestionPicker";

type Option = { id: string; label: string };

// The most content-heavy tab on the screen, and the one that most needed
// breaking up: four quite different mechanisms (questions, axes, access
// rules, consent purposes) were four `18px` headings inside one
// `gap-8` column, so a reader looking for "who can read this field" had
// to scroll past every trait axis to find out. Each is now its own
// section with its own explanation of what it's for and what happens if
// you get it wrong — the explanations were already written and good, they
// were just competing for the same visual weight as the controls.
//
// Note what is *not* here any more, and the four columns of it are the
// other half of this: naming a Sensitive-data column as a rule's target,
// marking a question restricted after the fact, the "add a group
// afterwards is a no-op" ordering note, and the demographic indicator
// category. All four were consequences of the fixed `member` columns, and
// they went when the columns did (migration 0080). What replaces them is
// one decision at creation time — restricted, with its audience, in the
// same form — which is why the create card below is the busiest thing on
// this tab.
export default function ProfilePrivacyTab({
  profileQuestions,
  traitAxes,
  rules,
  consentPurposes,
  tiers,
  communityTasks,
  currentPhases,
  sensitiveQuestionOptions,
  questionLabelById,
  ruleTaskNameById,
  tierNameById,
}: {
  profileQuestions: (typeof profileQuestionTable.$inferSelect)[];
  traitAxes: (typeof traitAxisTable.$inferSelect)[];
  rules: (typeof ruleTable.$inferSelect)[];
  consentPurposes: (typeof consentPurposeTable.$inferSelect)[];
  tiers: (typeof tierTable.$inferSelect)[];
  // The three audience routes, as plain rows. The create form needs all
  // three pickers side by side because `createProfileQuestion` takes the
  // audience as part of the same call — there is no second trip to the
  // Access rules section, and therefore no ordering to get wrong.
  communityTasks: { id: string; title: string }[];
  // The phase names of the event this member is currently looking at, so
  // a phase-scoped question for a phase this event doesn't have can say
  // so instead of sitting in the list looking broken.
  currentPhases: Set<string>;
  sensitiveQuestionOptions: Option[];
  questionLabelById: Map<string, string>;
  ruleTaskNameById: Map<string, string>;
  tierNameById: Map<string, string>;
}) {
  const maps: NameMaps = { ruleTaskNameById, tierNameById };
  return (
    <div className="flex flex-col gap-10">
      <ProfileQuestionsSection
        profileQuestions={profileQuestions}
        rules={rules}
        maps={maps}
        tiers={tiers}
        communityTasks={communityTasks}
        currentPhases={currentPhases}
      />
      <TraitAxesSection traitAxes={traitAxes} />
      <ConsentPurposesSection
        consentPurposes={consentPurposes}
        sensitiveQuestionOptions={sensitiveQuestionOptions}
        questionLabelById={questionLabelById}
      />
    </div>
  );
}

function ProfileQuestionsSection({
  profileQuestions,
  rules,
  maps,
  tiers,
  communityTasks,
  currentPhases,
}: {
  profileQuestions: (typeof profileQuestionTable.$inferSelect)[];
  rules: Rule[];
  maps: NameMaps;
  tiers: (typeof tierTable.$inferSelect)[];
  communityTasks: { id: string; title: string }[];
  currentPhases: Set<string>;
}) {
  // One index rather than a filter per card: a community has a handful of
  // restricted questions and a couple of dozen cards, and the audience line
  // is on every collapsed card, so this is computed once for all of them.
  const rulesByQuestion = new Map<string, Rule[]>();
  for (const r of rules) {
    const list = rulesByQuestion.get(r.questionId);
    if (list) list.push(r);
    else rulesByQuestion.set(r.questionId, [r]);
  }
  const cardProps = (q: typeof profileQuestionTable.$inferSelect) => ({
    question: q,
    rules: rulesByQuestion.get(q.id) ?? [],
    maps,
    tiers,
    communityTasks,
  });

  return (
    <SettingsSection
      title="Profile questions"
      description="Standing facts about a member — once-ever (an emergency contact), per-event, or tied to one phase name. Everyone's outstanding questions are answered at /questions, which is also where a member lands after saying they're coming to an event."
    >
      {profileQuestions.length === 0 ? (
        <SettingsPanel title="This community has no questions yet">
          {/* The starter set goes through a review step rather than a
              single button. The one-button version was defensible only
              until you counted what it left behind: every question it
              created had to be archived again by hand, and since a
              community with no questions has no members, none of them
              could have been answered — so the archive pass was pure
              friction at the one moment the set was cheapest to decline.
              It is also the one place an audience can be picked in bulk,
              because a restricted question is created restricted. */}
          <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
            Here is a suggested set — who someone is, what they can do, and a few answers the whole
            community must not read. Go through it: untick anything you don&rsquo;t want, retitle
            anything you&rsquo;d phrase differently, and pick who may read each restricted answer.
            Everything you keep stays editable afterwards; nothing here is a commitment.
          </p>
          <details open>
            <summary className="cursor-pointer text-[13px] font-medium text-[var(--accent-1)]">
              Review the starter set
            </summary>
            <form action={seedDefaultProfileQuestionsAction} className="mt-3 flex flex-col gap-3">
              <StarterQuestionPicker
                tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
                permissionModuleKeys={[...PERMISSION_MODULE_KEYS]}
                permissionModuleLabels={PERMISSION_MODULE_LABELS}
              />
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Add the selected questions
              </button>
            </form>
          </details>
        </SettingsPanel>
      ) : null}

      {/* The general mechanics are long and true and nobody needs them on
          every visit, so they live behind a disclosure. Previously they
          were three paragraphs of wall text above the questions, which is
          what made this section feel like a wall rather than a list. The
          per-category blurbs below carry only what is specific to that
          category. */}
      <SettingsPanel>
        <details>
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--accent-1)]">
            How privacy and consent work for these questions
          </summary>
          <div className="mt-2 flex max-w-[720px] flex-col gap-2">
            <p className="text-[13px] text-[var(--text-muted)]">
              A question is either <strong>readable by the whole community</strong> or{" "}
              <strong>restricted</strong>, and which one it is gets decided once, when it is created.
              It can&rsquo;t be flipped afterwards, because un-restricting a question would make every
              answer given so far readable by everyone — including answers people gave while it was
              restricted to a smaller group. No confirmation makes that a setting rather than a
              disclosure, so the remedy is to archive the question and add it again.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              A restricted question&rsquo;s audience is a list of <strong>rules</strong>, and anyone who
              satisfies any one of them may read it — a named Tier, the holder of one task, or anyone
              holding a particular permission. You can see and change that list on the question itself,
              under &ldquo;Who can read this&rdquo;.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              Adding a rule is a <strong>widening</strong>, and widening asks the people already
              affected rather than helping itself to their answers: a new rule reaches only answers
              given from the moment it exists. Everyone who had already answered is told and asked
              whether to extend sharing, and until each of them says yes their answer stays with the
              audience that already had it. Removing a rule is the opposite and needs nobody&rsquo;s
              agreement.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              <strong>Emergency access is an override, not a permission.</strong> Answering a question
              marked for it is the consent — there is no separate box, and the only way to refuse is
              not to answer. Anyone can activate emergency mode on another member&rsquo;s page, which is
              how a crisis gets read; every such read is written to a log, and unlike reading inside a
              permission someone granted, it is not silent.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              <strong>Publishing</strong> is only possible on a public question, and only for one that
              is asked once, isn&rsquo;t free text, and offers &ldquo;prefer not to say&rdquo;. It shows a
              proportion or a distribution on the community page, never anyone&rsquo;s individual answer —
              and that adds nothing a reader couldn&rsquo;t already work out by reading the answers one at
              a time, which is why it needs no separate consent.
            </p>
          </div>
        </details>
      </SettingsPanel>

      <SettingsPanel>
        <details>
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--accent-1)]">
            How answering, required questions and &ldquo;prefer not to say&rdquo; work
          </summary>
          <div className="mt-2 flex max-w-[720px] flex-col gap-2">
            <p className="text-[13px] text-[var(--text-muted)]">
              Marking one <strong>required</strong> means anyone who hasn&rsquo;t answered it yet
              gets a count on their Dashboard until they do — so reserve it for what you genuinely
              can&rsquo;t run the event without. &ldquo;I don&rsquo;t know yet&rdquo; counts as an
              answer, but add a <strong>needed by</strong> date if you need a real answer by a real
              time: past that date the deferral stops counting and the question comes back. Leave it
              blank for a standing fact like an emergency contact, where a deferral should really be
              permanent.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              The two &ldquo;not answering&rdquo; buttons are deliberately different.{" "}
              <strong>Allow &ldquo;I don&rsquo;t know yet&rdquo;</strong> is on by default and means
              &ldquo;ask me again later&rdquo;.{" "}
              <strong>Allow &ldquo;prefer not to say&rdquo;</strong> is off by default and means{" "}
              <em>this question is optional for everyone</em> — turning it on makes the question stop
              being required in practice, because picking it is a permanent, unchased answer. Turn it
              on for questions about someone&rsquo;s own identity or circumstances, and leave it off
              for questions the community genuinely needs a real answer to from everyone.
            </p>
            <p className="text-[13px] text-[var(--text-muted)]">
              A question per event is asked again each time, so it lives in the event section below
              rather than here. A phase-scoped question with &ldquo;feeds capacity signal&rdquo; on
              powers the Coordination view&rsquo;s fitted-ask flags and non-response list for
              whichever event phase matches its name.
            </p>
          </div>
        </details>
      </SettingsPanel>

      {/* Two sections, because a question is one of two things and the
          distinction is a consent boundary rather than a filing
          preference. Grouped by where the question is asked rather than by
          what it's about: the standing questions in one place, the
          per-event ones in another, under whichever category they belong
          to. A "demographic" group is deliberately absent — publication
          is a capability of a public question rather than a third kind of
          question, because an aggregate of answers everyone can already
          read individually discloses nothing the underlying data doesn't
          already say. */}
      {(["public", "restricted"] as const).map((category) => {
        const blurb =
          category === "public"
            ? "Readable by the whole Community. A once-ever question of these can also be published as a collective figure on the community page — a proportion or a distribution, never anybody's individual answer — as long as it isn't free text and offers “prefer not to say”."
            : "Not readable by the whole Community. Whoever you named as the audience can read it, and so can the person who answered. This is chosen when the question is created and can't be changed afterwards, because un-restricting it later would make every answer so far readable by everyone.";
        const inCategory = profileQuestions.filter((q) => q.sensitive === (category === "restricted"));
        const standing = inCategory.filter((q) => q.scope === "once_ever");
        const eventScoped = inCategory.filter((q) => q.scope !== "once_ever");
        // A phase question is asked during a phase of the current event, so
        // if the current event has no phase of that name it is a question
        // nobody will be asked this time round. Listing it flat alongside
        // the ones that are live is how a question on "Build" ends up
        // looking broken rather than dormant, so it goes under "for other
        // events".
        const live = eventScoped.filter(
          (q) => q.scope !== "phase" || currentPhases.has((q.phaseNameHint ?? "").toLowerCase()),
        );
        const hidden = eventScoped.filter((q) => !live.includes(q));

        return (
          <SettingsPanel key={category} title={`${category === "public" ? "Public" : "Restricted"} (${inCategory.length})`}>
            <p className="max-w-[720px] text-[13px] text-[var(--text-muted)]">{blurb}</p>

            {inCategory.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">None yet.</p>}

            <div className="mt-1 flex flex-col gap-1.5">
              {standing.map((q) => (
                <QuestionCard key={q.id} {...cardProps(q)} />
              ))}
            </div>

            {eventScoped.length > 0 && (
              <div className="mt-3">
                <p className="text-[12px] font-medium text-[var(--text-muted)]">
                  Asked again for each event
                </p>
                <div className="mt-1.5 flex flex-col gap-1.5">
                  {live.map((q) => (
                    <QuestionCard key={q.id} {...cardProps(q)} />
                  ))}
                </div>
                {hidden.length > 0 && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[12px] text-[var(--accent-1)]">
                      {hidden.length} more for other events
                    </summary>
                    <div className="mt-1.5 flex flex-col gap-1.5">
                      {hidden.map((q) => (
                        <QuestionCard key={q.id} {...cardProps(q)} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </SettingsPanel>
        );
      })}

      <SettingsCard action={createProfileQuestionAction} submitLabel="Add question" title="Add a question">
        <ProfileQuestionEditor initial={toEditableFieldShape({ label: "", responseType: "text", required: false })} />
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Asked</span>
          <select name="scope" defaultValue="once_ever" className={INPUT}>
            <option value="once_ever">Once ever</option>
            <option value="per_cycle">Per event</option>
            <option value="phase">Tied to one phase name</option>
          </select>
        </label>
        <TextField
          label="Phase name (only for a phase-scoped question)"
          name="phaseNameHint"
          placeholder="e.g. Build"
        />
        <CheckField label="Feeds the capacity signal (phase-scoped only)" name="feedsCapacitySignal" />
        <CheckField label="Also ask during a new member's first-week onboarding" name="onboardingSurface" />
        <CheckField label="Allow &ldquo;I don&rsquo;t know yet&rdquo;" name="allowDeferral" defaultChecked />
        <CheckField label="Allow &ldquo;prefer not to say&rdquo;" name="allowPreferNotToSay" />
        {/* Restricted, with its audience, in the same form. This used to be
            a checkbox on the question's own row that was disabled until a
            rule existed further down this page, which meant creating a
            restricted question was three visits to two sections and the
            discoverable path was: add the question, remember which row it
            was, add a rule naming it, come back, tick the box. All of that
            is one field group now, and since it can't be changed
            afterwards, this is the only moment it can be set. */}
        <CheckField label="Restricted — only the audience below can read it" name="sensitive" />
        <AudiencePickers tiers={tiers} communityTasks={communityTasks} />
        <CheckField label="Reachable through Emergency access" name="emergencyAccess" />
        <p className="max-w-[620px] text-[12px] text-[var(--text-muted)]">
          Restricted or not can&rsquo;t be changed once the question exists, so it&rsquo;s picked here.
          The audience can be widened later under Access rules — which only reaches answers given
          from then on, unless each person who already answered says yes to it.
        </p>
        <p className="max-w-[620px] text-[12px] text-[var(--text-muted)]">
          You can turn a question into a community indicator after adding it — tick &ldquo;show the
          answers on the community page&rdquo; on its row. Only a public, once-ever question with a
          countable answer type can be one.
        </p>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          needed by (optional — only applies if required and deferrable)
          <input type="date" name="requiredBy" className={`${INPUT} py-1`} />
        </label>
      </SettingsCard>
    </SettingsSection>
  );
}

/** The three audience routes, as three selects.
 *
 *  One group rather than three fields because `createProfileQuestion`
 *  takes the audience as part of the same call: the write path does the
 *  insert → rule → flag sequence internally, so a restricted question
 *  without an audience is refused by the schema rather than created as
 *  something nobody can read. `readAudienceFields` in ../actions reads
 *  whichever of the three the form left filled, and a blank comes back
 *  undefined rather than "" so "no tier" and "the id of a tier that
 *  doesn't exist" stay different mistakes.
 *
 *  Deliberately *three* selects rather than a route dropdown followed by
 *  its value. That was the shape in the starter-set review, and it costs
 *  a click and a re-render to change route; here the three are the three
 *  things a Community actually has (a Tier, a task, a grant) and all of
 *  them are visible at once.
 */
function AudiencePickers({
  tiers,
  communityTasks,
}: {
  tiers: (typeof tierTable.$inferSelect)[];
  communityTasks: { id: string; title: string }[];
}) {
  return (
    <div className="flex max-w-[420px] flex-col gap-1">
      <span className={LABEL}>Who may read it (if restricted)</span>
      <select name="unlockedByGrantModuleKey" defaultValue="" className={INPUT}>
        <option value="">— pick an audience —</option>
        {PERMISSION_MODULE_KEYS.map((m) => (
          <option key={m} value={m}>
            anyone holding a {PERMISSION_MODULE_LABELS[m]} grant
          </option>
        ))}
      </select>
      <select name="unlockedByTierId" defaultValue="" className={INPUT}>
        <option value="">— or anyone in a Tier —</option>
        {tiers.map((t) => (
          <option key={t.id} value={t.id}>
            anyone in Tier &ldquo;{t.name}&rdquo;
          </option>
        ))}
      </select>
      <select name="unlockedByTaskId" defaultValue="" className={INPUT}>
        <option value="">— or anyone holding one task —</option>
        {communityTasks.map((t) => (
          <option key={t.id} value={t.id}>
            anyone holding &ldquo;{t.title}&rdquo;
          </option>
        ))}
      </select>
    </div>
  );
}

function TraitAxesSection({ traitAxes }: { traitAxes: (typeof traitAxisTable.$inferSelect)[] }) {
  return (
    <SettingsSection
      title="Trait axes"
      description="Bipolar scales — 'wants direction' ↔ 'wants independence' — set on both members (their own preference) and tasks (a proposer's suggestion, reviewed at activation), and compared by proximity to rank onboarding's task suggestions."
    >
      <SettingsPanel>
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          An axis is a surfacing signal, not a score: never shown as a number and never a hard
          requirement. &ldquo;Surface during onboarding&rdquo; keeps the first-session screen short — an
          axis left unchecked is still settable any time at /profile.
        </p>
      </SettingsPanel>

      {traitAxes.map((a) => (
        <SettingsCard
          key={a.id}
          action={updateTraitAxisAction}
          submitLabel="Save axis"
          title={
            <span className="flex items-center gap-2">
              {a.highLabel} ↔ {a.lowLabel}
              {a.archivedAt && <Tag tone="warning">archived</Tag>}
            </span>
          }
          description={`Key: ${a.key} — not editable here.`}
          aside={
            <form action={a.archivedAt ? unarchiveTraitAxisAction : archiveTraitAxisAction}>
              <input type="hidden" name="axisId" value={a.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                {a.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </form>
          }
        >
          <input type="hidden" name="axisId" value={a.id} />
          <div className="flex flex-wrap gap-2">
            <input type="text" name="lowLabel" defaultValue={a.lowLabel} placeholder="low label" className={`${INPUT} flex-1`} />
            <input type="text" name="highLabel" defaultValue={a.highLabel} placeholder="high label" className={`${INPUT} flex-1`} />
          </div>
          <TextField
            label="Five option labels, “|”-separated (optional)"
            name="optionLabels"
            defaultValue={a.optionLabels.join(" | ")}
            hint="Overrides the low/high slider with labelled choices."
          />
          <div className="flex flex-wrap items-center gap-3">
            <ToggleField label="Surface during onboarding" name="askAtOnboarding" defaultChecked={a.askAtOnboarding} />
            <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
              Sort order
              <input type="number" name="sortOrder" defaultValue={a.sortOrder} className={`${INPUT} w-20`} />
            </label>
          </div>
        </SettingsCard>
      ))}

      <SettingsCard action={createTraitAxisAction} submitLabel="Add trait axis" title="Add a trait axis">
        <TextField label="Key" name="key" placeholder="e.g. autonomy" required />
        <div className="flex flex-wrap gap-2">
          <input type="text" name="lowLabel" placeholder="low label" required className={`${INPUT} flex-1`} />
          <input type="text" name="highLabel" placeholder="high label" required className={`${INPUT} flex-1`} />
        </div>
        <TextField
          label="Five option labels, “|”-separated (optional)"
          name="optionLabels"
          hint="Overrides the low/high slider with labelled choices."
        />
        <ToggleField label="Surface during onboarding" name="askAtOnboarding" />
      </SettingsCard>
    </SettingsSection>
  );
}

function ConsentPurposesSection({
  consentPurposes,
  sensitiveQuestionOptions,
  questionLabelById,
}: {
  consentPurposes: (typeof consentPurposeTable.$inferSelect)[];
  sensitiveQuestionOptions: Option[];
  questionLabelById: Map<string, string>;
}) {
  return (
    <SettingsSection
      title="Consent purposes"
      description="One row per distinct purpose needing a member's consent. Ordinary operational processing gets no row at all."
    >
      <SettingsPanel>
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          Pin a purpose to one profile question and it becomes the read path&rsquo;s gate: once set,
          a member cannot answer that question at all without agreeing, and their answer stops being
          visible to anyone else the moment they withdraw. A gated question also reports how many
          members have agreed, because &ldquo;0 of 12&rdquo; reads identically whether nobody answered
          or nobody consented.
        </p>
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          This is a separate decision from an access rule, and the two answer different questions. A
          rule says <em>who in this community may read it</em> — the kitchen team, a wellbeing Tier. A
          purpose says <em>whether the member agreed to it being read at all</em>. A question can be
          restricted to the kitchen while every member still has to tick a box before the kitchen sees
          anything.
        </p>
      </SettingsPanel>

      {consentPurposes.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">No purposes yet.</p>}
      {consentPurposes.map((p) => (
        <div
          key={p.id}
          className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
        >
          <div className="flex-1">
            <span className="text-[13px] font-medium text-[var(--text)]">{p.label}</span>{" "}
            <code className="text-[12px] text-[var(--text-muted)]">{p.key}</code>
            {p.gatesQuestionId && (
              <span className="text-[12px] text-[var(--text-muted)]">
                {" "}
                &mdash; gates &ldquo;{questionLabelById.get(p.gatesQuestionId) ?? "a question that has been archived or removed"}&rdquo;
              </span>
            )}
            {p.requiresExplicit && <span className="text-[12px] text-[var(--text-muted)]"> (explicit)</span>}
            <div className="text-[12px] text-[var(--text-muted)]">{p.noticeText}</div>
          </div>
          <form action={deleteConsentPurposeAction}>
            <input type="hidden" name="purposeId" value={p.id} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Delete
            </button>
          </form>
        </div>
      ))}

      <SettingsCard action={createConsentPurposeAction} submitLabel="Add purpose" title="Add a purpose">
        <TextField label="Key" name="key" placeholder="e.g. kitchen_dietary" required />
        <TextField label="Label" name="label" required />
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>The notice a member reads</span>
          <textarea name="noticeText" required rows={2} className={INPUT} />
        </label>
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Gates a profile question (optional)</span>
          <select name="gatesQuestionId" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {sensitiveQuestionOptions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        <ToggleField
          label="Requires explicit consent"
          name="requiresExplicit"
          hint="Required when gating a question — a member can't be assumed to have agreed to something that gates an answer."
        />
      </SettingsCard>
    </SettingsSection>
  );
}

/** One profile question: a collapsed row of facts, with the form behind a
 *  disclosure for the times you actually came to change something.
 *
 *  The disclosure isn't decoration. There are a dozen questions on a
 *  typical community and every one of them is a dozen fields, so an
 *  always-expanded list is a wall of identical inputs; and the question
 *  that matters most on the row — whether it is restricted — is fixed at
 *  creation, so there is nothing to edit about it here and it reads much
 *  better as a fact than as a greyed-out checkbox.
 */
type Rule = typeof ruleTable.$inferSelect;
type NameMaps = { ruleTaskNameById: Map<string, string>; tierNameById: Map<string, string> };

/** One rule, as the sentence an admin would say out loud.
 *
 *  Every branch falls back rather than asserting. The write side refuses a
 *  rule carrying two routes, but the database is editable by hand, and the
 *  non-null assertion this replaced rendered the string "undefined" into
 *  the list — which reads as a rendering fault rather than as the broken
 *  row it actually is. Naming the fault is the point.
 */
function ruleRoute(r: Rule, maps: NameMaps): string {
  if (r.unlockedByTaskId) {
    return `anyone holding “${maps.ruleTaskNameById.get(r.unlockedByTaskId) ?? "a task not in this community"}”`;
  }
  if (r.unlockedByTierId) {
    return `anyone in Tier “${maps.tierNameById.get(r.unlockedByTierId) ?? "—"}”`;
  }
  if (r.unlockedByGrantModuleKey) {
    return `anyone holding a ${PERMISSION_MODULE_LABELS[r.unlockedByGrantModuleKey]} grant`;
  }
  return "nobody — this rule has no unlock route";
}

/** Who can read this question, for the collapsed card.
 *
 *  The whole point of moving access rules onto the card: the question and
 *  the answer to "who can read this" are one object, and an admin should
 *  never have to find a question's row in one section to learn its
 *  audience and then visit another section to change it.
 */
function audienceLine(q: typeof profileQuestionTable.$inferSelect, ownRules: Rule[], maps: NameMaps) {
  if (!q.sensitive) {
    return "Readable by the whole community.";
  }
  if (ownRules.length === 0) {
    // Relocated verbatim from the Access rules section this replaces, which
    // is where the honest description of the empty case already lived. A
    // restricted question with no rule resolves to nobody-but-the-owner,
    // which reads as broken rather than as private unless it is said.
    return "Readable by the person who answered, and by whoever activates Emergency access on their page. Nobody else.";
  }
  return `Also readable by ${ownRules.map((r) => ruleRoute(r, maps)).join("; ")}.`;
}

function QuestionCard({
  question: q,
  rules,
  maps,
  tiers,
  communityTasks,
}: {
  question: typeof profileQuestionTable.$inferSelect;
  rules: Rule[];
  maps: NameMaps;
  tiers: (typeof tierTable.$inferSelect)[];
  communityTasks: { id: string; title: string }[];
}) {
  const options = (q.options ?? []) as string[];
  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <summary
        className="flex cursor-pointer flex-wrap items-center gap-2"
        style={{ opacity: q.archivedAt ? 0.6 : 1 }}
      >
        <span className="text-[14px] font-medium text-[var(--text)]">{q.label}</span>
        {q.sensitive && <Fact>restricted</Fact>}
        {q.emergencyAccess && <Fact>emergency access</Fact>}
        {q.publishedAsIndicator && <Fact>published</Fact>}
        {q.required && <Fact>required</Fact>}
        {q.archivedAt && <Fact>archived</Fact>}
        <span className="text-[12px] text-[var(--text-muted)]">
          {q.scope === "once_ever"
            ? "asked once"
            : q.scope === "per_cycle"
              ? "asked per event"
              : `asked in the ${q.phaseNameHint} phase`}
        </span>
        <span className="ml-auto text-[12px] text-[var(--accent-1)]">Edit</span>
        {/* The state, on the collapsed side. A card that only said
            "restricted" made the reader open it to learn who could read
            the thing, which is the one fact a privacy surface exists to
            communicate. */}
        <span className="w-full text-[12px] leading-relaxed text-[var(--text-muted)]">
          {audienceLine(q, rules, maps)}
        </span>
        {options.length > 0 && (
          <span className="w-full text-[12px] leading-relaxed text-[var(--text-muted)]">
            Choices: {options.join(", ")}
          </span>
        )}
      </summary>

      {/* Inside the disclosure rather than a separate one: a <summary> and
          a form cannot share a parent, and a form nested in a *second*
          details would mean two disclosures stacked on one card. */}
      <form action={updateProfileQuestionAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="questionId" value={q.id} />
        <ProfileQuestionEditor
          initial={toEditableFieldShape({
            label: q.label,
            responseType: q.responseType,
            options: q.options,
            required: q.required,
            multiline: q.multiline,
            validation: q.validation,
            allowOther: q.allowOther,
            min: q.min,
            max: q.max,
            step: q.step,
          })}
        />
        <div className="flex flex-wrap items-center gap-3">
          {q.scope === "phase" && (
            <CheckField
              label="feeds capacity signal"
              name="feedsCapacitySignal"
              defaultChecked={q.feedsCapacitySignal}
            />
          )}
          <CheckField
            label="also ask during a new member's first-week onboarding"
            name="onboardingSurface"
            defaultChecked={q.surfaces.includes("onboarding")}
          />
          <CheckField
            label="allow &ldquo;I don&rsquo;t know yet&rdquo;"
            name="allowDeferral"
            defaultChecked={q.allowDeferral}
          />
          <CheckField
            label="allow &ldquo;prefer not to say&rdquo;"
            name="allowPreferNotToSay"
            defaultChecked={q.allowPreferNotToSay}
          />
          <IndicatorToggle question={q} />
        </div>
        {q.sensitive && <EmergencyToggle question={q} />}
        {q.required && q.allowDeferral && (
          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            needed by
            <input type="date" name="requiredBy" defaultValue={q.requiredBy ?? ""} className={`${INPUT} py-1`} />
          </label>
        )}
        {q.requiredBy && (
          <p className="text-[12px] text-[var(--text-muted)]">
            After {new Date(q.requiredBy).toLocaleDateString()}, anyone who answered
            &ldquo;I don&rsquo;t know yet&rdquo; counts as still owing an answer.
          </p>
        )}
        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            Save
          </button>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          {q.sensitive
            ? "This one is restricted, and that can't be changed here — un-restricting it would make every answer so far readable by the whole community. If it was filed wrongly, archive it and add it again with an audience."
            : "This one is readable by the whole community, and that can't be changed here either. To restrict it, archive it and add it again with an audience."}
        </p>
      </form>

      <form action={q.archivedAt ? unarchiveProfileQuestionAction : archiveProfileQuestionAction} className="mt-2">
        <input type="hidden" name="questionId" value={q.id} />
        <button type="submit" className="text-[12px] text-[var(--text-muted)] hover:underline">
          {q.archivedAt ? "Unarchive this question" : "Archive this question"}
        </button>
      </form>

      {q.sensitive && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="text-[12px] font-medium text-[var(--text-muted)]">Who can read this</p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--text-muted)]">
            {audienceLine(q, rules, maps)}
          </p>

          {rules.length > 0 && (
            <div className="mt-2 flex flex-col gap-1.5">
              {rules.map((r) => (
                <div key={r.id} className="flex items-center gap-2 text-[12px] text-[var(--text)]">
                  <span className="flex-1">Readable by {ruleRoute(r, maps)}</span>
                  <form action={deleteSensitiveFieldAccessRuleAction}>
                    <input type="hidden" name="ruleId" value={r.id} />
                    <button type="submit" className="text-[12px] text-[var(--text-muted)] hover:underline">
                      Remove
                    </button>
                  </form>
                </div>
              ))}
            </div>
          )}

          {/* Adding a group is the one action here that reaches people who
              already answered, so what it does is stated on the control
              rather than in a preamble some distance away. */}
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] text-[var(--accent-1)]">
              Add a group that can read this
            </summary>
            <div className="mt-2 flex max-w-[560px] flex-col gap-2">
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                Adding a group is a <strong>widening</strong>, and widening asks the people already
                affected: the new group reaches only answers given from the moment it exists. Everyone
                who has already answered is told about it and asked whether to extend sharing, and
                until each of them says yes their answer stays with the audience that already had it.
                That&rsquo;s the difference between widening an audience and quietly taking it.
              </p>
              <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
                Removing the last one leaves this readable by the person who answered and nobody else.
              </p>
              <form action={createSensitiveFieldAccessRuleAction} className="flex flex-col gap-2">
                {/* The question is the card, so unlike the old standalone
                    form there is nothing to pick here — which also removes
                    the one way to widen the audience of the wrong question. */}
                <input type="hidden" name="questionId" value={q.id} />
                <SelectField
                  label="Via a Tier"
                  name="unlockedByTierId"
                  defaultValue=""
                  options={[{ value: "", label: "— none —" }, ...tiers.map((t) => ({ value: t.id, label: t.name }))]}
                />
                <SelectField
                  label="Or via a permission grant"
                  name="unlockedByGrantModuleKey"
                  defaultValue=""
                  options={[
                    { value: "", label: "— none —" },
                    ...PERMISSION_MODULE_KEYS.map((k) => ({ value: k, label: PERMISSION_MODULE_LABELS[k] })),
                  ]}
                />
                <TextField
                  label="Or via a task (pick exactly one of the three)"
                  name="unlockedByTaskId"
                  placeholder="paste the task's ID from its /tasks/… URL"
                  hint={`Tasks this community has: ${communityTasks.length}`}
                />
                <div>
                  <button type="submit" className={BUTTON_PRIMARY}>
                    Add this group
                  </button>
                </div>
              </form>
            </div>
          </details>
        </div>
      )}
    </details>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
      {children}
    </span>
  );
}

/** The "publish this as a community indicator" control, disabled with the
 *  rule that blocks it attached.
 *
 *  Two things are being protected: a member's expectation that a fact
 *  about them is private unless the community said otherwise, and the
 *  aggregate's ability to render whatever it ends up pointed at. A
 *  checkbox that refuses to tick and says why teaches the rule; one that
 *  just isn't there leaves someone wondering where the option went.
 */
function IndicatorToggle({ question }: { question: typeof profileQuestionTable.$inferSelect }) {
  const canPublish = canPublishAsIndicator(question);
  const blocker = indicatorBlocker(question);
  const family = canPublish ? indicatorFamilyFor(question.responseType) : null;
  return (
    <div className="flex flex-col gap-1">
      <label
        className={`flex items-center gap-2 text-[13px] ${canPublish ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
      >
        <input
          type="checkbox"
          name="publishedAsIndicator"
          defaultChecked={question.publishedAsIndicator}
          disabled={!canPublish}
        />{" "}
        show the answers on the community page
      </label>
      {canPublish && family ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Shown as {INDICATOR_FAMILY_LABELS[family].toLowerCase()} &mdash; the form follows from the
          answer type, so it can&rsquo;t end up describing the answers wrongly.
        </p>
      ) : (
        blocker && (
          <p className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
            Not available here, because {blocker.reason}. {blocker.remedy}
          </p>
        )
      )}
    </div>
  );
}

/** Emergency access, on a question that already exists.
 *
 *  The counterpart to `sensitive`, and the reason it isn't simply another
 *  fixed attribute: emergency access *overrides* a restriction, and the
 *  restriction is now chosen once and for all. Turning it on later is a
 *  widening — a standing promise that whoever activates emergency mode on
 *  this member's page can read this fact — so it is a decision an Admin
 *  makes deliberately about questions they already know exist, and they can
 *  take it back without disclosing anything.
 */
function EmergencyToggle({ question }: { question: typeof profileQuestionTable.$inferSelect }) {
  // Only blocks turning it ON. A question somehow already marked without
  // being restricted must still be tickable-off, or the state would be
  // unescapable except by deleting the question.
  const blocked =
    (question.emergencyAccess && question.publishedAsIndicator) ||
    (!question.sensitive && !question.emergencyAccess);
  return (
    <div className="flex flex-col gap-1">
      <label
        className={`flex items-center gap-2 text-[13px] ${blocked ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
      >
        <input
          type="checkbox"
          name="emergencyAccess"
          defaultChecked={question.emergencyAccess}
          disabled={blocked}
        />
        readable through Emergency access
        <span className="text-[var(--text-muted)]">
          &mdash; whoever turns on emergency mode, and they&rsquo;re notified
        </span>
      </label>
      {question.emergencyAccess && question.publishedAsIndicator ? (
        <p className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          Not available while this question is published on the community page. An indicator is
          already readable by the whole community, so there&rsquo;s nothing for an emergency override
          to reach — and this isn&rsquo;t the kind of question anyone needs in an emergency.
          Unpublish it first, or leave this off.
        </p>
      ) : !question.sensitive && !question.emergencyAccess ? (
        <p className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          Not available on a public question. Emergency access overrides a restriction, so it needs
          one to override — and on a question everyone can already read there&rsquo;s nothing to
          reveal, which would put a read of public data in the log as though it had been protected.
        </p>
      ) : !question.emergencyAccess ? (
        <p className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          Turning this on for a question people have already answered asks each of them. They
          answered a question whose answers couldn&rsquo;t be pulled out in a crisis, and the reach
          is now being handed to whoever activates Emergency access on their page — so they get asked
          on their profile, and it stays off for them until they say yes. Turning it<em> off</em>{" "}
          asks nobody, because it discloses nothing.
        </p>
      ) : null}
    </div>
  );
}

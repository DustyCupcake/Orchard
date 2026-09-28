import type {
  consentPurpose as consentPurposeTable,
  profileQuestion as profileQuestionTable,
  sensitiveFieldAccessRule as ruleTable,
  tier as tierTable,
  traitAxis as traitAxisTable,
} from "@/db/schema";
import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS } from "@/lib/permissions";
import { SENSITIVE_FIELD_KEYS, SENSITIVE_FIELD_LABELS } from "@/lib/sensitive-data";
import { canPublishAsIndicator, indicatorBlocker } from "@/lib/profile-questions/indicators";
import { toEditableFieldShape } from "@/lib/field-shape";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SettingsCard, SettingsPanel, SettingsSection, TextField, ToggleField } from "../ui";
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
export default function ProfilePrivacyTab({
  profileQuestions,
  traitAxes,
  rules,
  consentPurposes,
  tiers,
  sensitiveQuestionOptions,
  questionLabelById,
  ruleCountByQuestion,
  ruleTaskNameById,
  tierNameById,
}: {
  profileQuestions: (typeof profileQuestionTable.$inferSelect)[];
  traitAxes: (typeof traitAxisTable.$inferSelect)[];
  rules: (typeof ruleTable.$inferSelect)[];
  consentPurposes: (typeof consentPurposeTable.$inferSelect)[];
  tiers: (typeof tierTable.$inferSelect)[];
  sensitiveQuestionOptions: Option[];
  questionLabelById: Map<string, string>;
  ruleCountByQuestion: Map<string, number>;
  ruleTaskNameById: Map<string, string>;
  tierNameById: Map<string, string>;
}) {
  return (
    <div className="flex flex-col gap-10">
      <ProfileQuestionsSection
        profileQuestions={profileQuestions}
        tiers={tiers}
        ruleCountByQuestion={ruleCountByQuestion}
      />
      <TraitAxesSection traitAxes={traitAxes} />
      <AccessRulesSection
        rules={rules}
        tiers={tiers}
        sensitiveQuestionOptions={sensitiveQuestionOptions}
        questionLabelById={questionLabelById}
        ruleTaskNameById={ruleTaskNameById}
        tierNameById={tierNameById}
      />
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
  tiers,
  ruleCountByQuestion,
}: {
  profileQuestions: (typeof profileQuestionTable.$inferSelect)[];
  tiers: (typeof tierTable.$inferSelect)[];
  ruleCountByQuestion: Map<string, number>;
}) {
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
              It is also the only place an audience can be picked, because
              `sensitive` is refused until a rule names the question, and a
              rule needs the question to exist. */}
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
      ) : (
        <SettingsPanel>
          <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
            Marking one <strong>required</strong> means anyone who hasn&rsquo;t answered it yet gets a
            count on their Dashboard until they do — so reserve it for what you genuinely can&rsquo;t run
            without. &ldquo;I don&rsquo;t know yet&rdquo; counts as an answer, but add a{" "}
            <strong>needed by</strong> date if you need a real answer by a real time: past that date the
            deferral stops counting and the question comes back. Leave it blank for a standing fact
            like an emergency contact, where a deferral should really be permanent.
          </p>
          <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
            The two &ldquo;not answering&rdquo; buttons are deliberately different.{" "}
            <strong>Allow &ldquo;I don&rsquo;t know yet&rdquo;</strong> means &ldquo;ask me again
            later&rdquo;. <strong>Allow &ldquo;prefer not to say&rdquo;</strong> means{" "}
            <em>this question is optional for everyone</em> — turning it on makes the question stop
            being required in practice, because picking it is a permanent, unchased answer. Turn it
            on for questions about someone&rsquo;s own identity or circumstances.
          </p>
          <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
            A phase-scoped question with &ldquo;feeds capacity signal&rdquo; on powers the Coordination
            view&rsquo;s fitted-ask flags for whichever event phase matches its name.
          </p>
        </SettingsPanel>
      )}

      {profileQuestions.map((q) => (
        <SettingsCard
          key={q.id}
          action={updateProfileQuestionAction}
          submitLabel="Save question"
          aside={
            <form action={q.archivedAt ? unarchiveProfileQuestionAction : archiveProfileQuestionAction}>
              <input type="hidden" name="questionId" value={q.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                {q.archivedAt ? "Unarchive" : "Archive"}
              </button>
            </form>
          }
          title={q.label}
          description={`${q.scope}${q.scope === "phase" ? ` (${q.phaseNameHint})` : ""} — scope is set when the question is created and can't be changed afterwards.`}
        >
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
          <div className="flex flex-col gap-2">
            {q.scope === "phase" && (
              <ToggleField
                label="Feeds the capacity signal"
                name="feedsCapacitySignal"
                defaultChecked={q.feedsCapacitySignal}
                hint="Puts this answer behind the Coordination view's fitted-ask flags and non-response list."
              />
            )}
            <ToggleField
              label="Also ask during a new member's first-week onboarding"
              name="onboardingSurface"
              defaultChecked={q.surfaces.includes("onboarding")}
            />
            <ToggleField
              label="Allow &ldquo;I don&rsquo;t know yet&rdquo;"
              name="allowDeferral"
              defaultChecked={q.allowDeferral}
            />
            <ToggleField
              label="Allow &ldquo;prefer not to say&rdquo;"
              name="allowPreferNotToSay"
              defaultChecked={q.allowPreferNotToSay}
              hint="This question is then optional for everyone in practice — picking it is a permanent answer nothing will chase."
            />
            {/* The indicator toggle is disabled with its reason attached,
                rather than hidden or silently ignored. Two things are being
                protected: a member's expectation that a fact about them is
                private unless the community said otherwise, and the
                aggregate's ability to render whatever it ends up pointed
                at. A checkbox that refuses to tick and says why teaches the
                rule; one that just isn't there leaves someone wondering
                where the option went. */}
            <IndicatorToggle question={q} />
            <PrivacyToggles question={q} ruleCount={ruleCountByQuestion.get(q.id) ?? 0} />
            {q.required && q.allowDeferral && (
              <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                needed by
                <input type="date" name="requiredBy" defaultValue={q.requiredBy ?? ""} className={`${INPUT} py-1`} />
              </label>
            )}
          </div>
          {q.requiredBy && (
            <p className="text-[12px] text-[var(--text-muted)]">
              After {new Date(q.requiredBy).toLocaleDateString()}, anyone who answered
              &ldquo;I don&rsquo;t know yet&rdquo; counts as still owing an answer.
            </p>
          )}
        </SettingsCard>
      ))}

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
        <ToggleField label="Feeds the capacity signal" name="feedsCapacitySignal" />
        <ToggleField label="Also ask during a new member's first-week onboarding" name="onboardingSurface" />
        <ToggleField label="Allow &ldquo;I don&rsquo;t know yet&rdquo;" name="allowDeferral" defaultChecked />
        <ToggleField label="Allow &ldquo;prefer not to say&rdquo;" name="allowPreferNotToSay" />
        <p className="text-[12px] text-[var(--text-muted)]">
          You can turn a question into a community indicator after adding it — tick &ldquo;show the
          answers on the Community page&rdquo; on its row. Only a once-ever question with a countable
          answer type can be one.
        </p>
        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          needed by (optional — only applies if required and deferrable)
          <input type="date" name="requiredBy" className={`${INPUT} py-1`} />
        </label>
      </SettingsCard>
    </SettingsSection>
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

function AccessRulesSection({
  rules,
  tiers,
  sensitiveQuestionOptions,
  questionLabelById,
  ruleTaskNameById,
  tierNameById,
}: {
  rules: (typeof ruleTable.$inferSelect)[];
  tiers: (typeof tierTable.$inferSelect)[];
  sensitiveQuestionOptions: Option[];
  questionLabelById: Map<string, string>;
  ruleTaskNameById: Map<string, string>;
  tierNameById: Map<string, string>;
}) {
  return (
    <SettingsSection
      title="Access rules"
      description="Purpose-bound, not role-bound: pick which task, tier or permission grant unlocks something for other members' values. A member can always see and edit their own, whatever you pick here."
    >
      <SettingsPanel title="What a rule names">
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          Naming a <strong>column</strong> — health conditions, allergies, emergency contact,
          orientation — unlocks it on /sensitive-data, and only once &ldquo;Sensitive
          data&rdquo; is checked under Modules. Naming a <strong>profile question</strong> is what
          makes that question restricted: the answer is readable by the union of everyone who
          satisfies any rule naming it, and by nobody else.
        </p>
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          The two are chosen in the opposite order, which is worth knowing before you start. Marking
          a question sensitive is refused until a rule names it, and a rule can only name a question
          that exists — so for a question, add the rule here <em>first</em>, then tick its{" "}
          <em>sensitive</em> box under Profile questions. The rule sitting there in between restricts
          nothing yet; the tick is what switches it on. The starter set asks for both at once, so
          there&rsquo;s rarely a reason to do it by hand.
        </p>
      </SettingsPanel>

      {rules.length === 0 && (
        <p className="text-[13px] text-[var(--text-muted)]">No rules yet — nothing is restricted.</p>
      )}
      {rules.map((r) => {
        /* Both the target and the route are read through a fallback rather
           than asserted. The write side refuses a rule with two targets or
           two routes, but the database is editable by hand, and a non-null
           assertion here rendered the string "undefined" into this list —
           which reads as a rendering fault rather than the broken row it
           actually is. Naming the fault is the point. */
        const target = r.questionId
          ? `Question "${questionLabelById.get(r.questionId) ?? "archived, or not in this community"}"`
          : r.fieldKey
            ? `Column ${SENSITIVE_FIELD_LABELS[r.fieldKey]}`
            : "Nothing — this rule names no target";
        const route = r.unlockedByTaskId
          ? `anyone holding "${ruleTaskNameById.get(r.unlockedByTaskId) ?? "a task not in this community"}"`
          : r.unlockedByTierId
            ? `anyone in Tier "${tierNameById.get(r.unlockedByTierId) ?? "—"}"`
            : r.unlockedByGrantModuleKey
              ? `anyone holding a ${PERMISSION_MODULE_LABELS[r.unlockedByGrantModuleKey]} grant`
              : "nobody — this rule has no unlock route";
        return (
          <div
            key={r.id}
            className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <span className="flex-1 text-[13px] text-[var(--text)]">
              {target} &mdash; readable by {route}
            </span>
            <form action={deleteSensitiveFieldAccessRuleAction}>
              <input type="hidden" name="ruleId" value={r.id} />
              <button type="submit" className={BUTTON_SECONDARY}>
                Delete
              </button>
            </form>
          </div>
        );
      })}

      <SettingsCard action={createSensitiveFieldAccessRuleAction} submitLabel="Add rule" title="Add a rule">
        {/* Both target selects need an explicit empty option, and that is
            not a nicety — it is the only reason a question-keyed rule can
            be created at all. The write side refuses a rule naming two
            targets, so a `fieldKey` select with no "— none —" submits a
            field *and* a question for every question-keyed rule, and every
            one of them fails. Combined with `sensitive` being refused
            until a rule exists, that left no way to mark a question
            sensitive from settings at all. */}
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>A Sensitive-data column</span>
          <select name="fieldKey" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {SENSITIVE_FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {SENSITIVE_FIELD_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Or a profile question (pick exactly one)</span>
          <select name="questionId" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {sensitiveQuestionOptions.map((q) => (
              <option key={q.id} value={q.id}>
                {q.label}
              </option>
            ))}
          </select>
        </label>
        {/* Correct as far as it goes — there are no *sensitive* questions —
            and wrong about what to do about it. The rule is the half that
            goes first: a rule against a plain question is a staged rule,
            restricting nothing today and starting the moment the sensitive
            box is ticked. Telling an admin to do it the other way round
            points at a sequence the write side refuses, which is the one
            order that has no reachable start. */}
        {sensitiveQuestionOptions.length === 0 && (
          <p className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
            No question is marked sensitive yet, so a rule naming one won&rsquo;t restrict anything on
            its own. That&rsquo;s the right order though: name the question here, then tick its{" "}
            <em>sensitive</em> box above, and the rule starts restricting the moment you do.
          </p>
        )}
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Unlock via a Tier</span>
          <select name="unlockedByTierId" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {tiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Or unlock via a permission grant</span>
          <select name="unlockedByGrantModuleKey" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {PERMISSION_MODULE_KEYS.map((k) => (
              <option key={k} value={k}>
                {PERMISSION_MODULE_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <TextField
          label="Or unlock via a Task ID (pick exactly one of Tier/Grant/Task)"
          name="unlockedByTaskId"
          placeholder="paste the task's ID from its /tasks/… URL"
        />
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
          Optionally pin a purpose to one Sensitive-data column or one sensitive profile question:
          once set, that value only populates or shows once the owning member has granted this
          purpose, and stops the moment they withdraw it.
        </p>
        <p className="max-w-[620px] text-[13px] text-[var(--text-muted)]">
          Pinning a purpose is a separate decision from restricting a question&rsquo;s audience — a
          question can be restricted to the kitchen team while the member still has to have agreed
          to the kitchen reading it at all.
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
            {p.gatesSensitiveField && (
              <span className="text-[12px] text-[var(--text-muted)]">
                {" "}
                &mdash; gates {SENSITIVE_FIELD_LABELS[p.gatesSensitiveField]}
              </span>
            )}
            {p.gatesQuestionId && (
              <span className="text-[12px] text-[var(--text-muted)]">
                {" "}
                &mdash; gates &ldquo;{questionLabelById.get(p.gatesQuestionId) ?? "an archived question"}
                &rdquo;
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
        <TextField label="Key" name="key" placeholder="e.g. sensitive_health" required />
        <TextField label="Label" name="label" required />
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>The notice a member reads</span>
          <textarea name="noticeText" required rows={2} className={INPUT} />
        </label>
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Gates a Sensitive-data column (optional)</span>
          <select name="gatesSensitiveField" defaultValue="" className={INPUT}>
            <option value="">— none —</option>
            {SENSITIVE_FIELD_KEYS.map((k) => (
              <option key={k} value={k}>
                {SENSITIVE_FIELD_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex max-w-[420px] flex-col gap-1">
          <span className={LABEL}>Or gates a sensitive profile question (optional)</span>
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
          hint="Required if the purpose gates a field — a member can't be assumed to have agreed to something that gates a value."
        />
      </SettingsCard>
    </SettingsSection>
  );
}

// The "publish this as a community indicator" control for one profile
// question, with the rule that governs it attached.
function IndicatorToggle({ question }: { question: typeof profileQuestionTable.$inferSelect }) {
  const canPublish = canPublishAsIndicator(question);
  const blocker = indicatorBlocker(question);
  const checked = question.publishedAsIndicator;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2 text-[13px] text-[var(--text)]">
        <input type="hidden" name="publishedAsIndicator" value="off" />
        <input
          type="checkbox"
          name="publishedAsIndicator"
          value="on"
          defaultChecked={checked}
          disabled={!canPublish}
          className="disabled:opacity-60"
        />
        Show the answers on the community page
      </span>
      {canPublish ? (
        <span className="text-[12px] text-[var(--text-muted)]">
          {checked
            ? "Published. The answers are counted, never attributed — and consent to publish is a member's own, not a community decision."
            : "Not published. Tick to count these answers in the community's own picture of itself."}
        </span>
      ) : (
        <span className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          {blocker ? `${blocker.reason}. ${blocker.remedy}` : ""}
        </span>
      )}
    </div>
  );
}

// The two privacy-related controls, each with the reasoning attached,
// because both are easy to tick without understanding and hard to
// untick later.
function PrivacyToggles({
  question,
  ruleCount,
}: {
  question: typeof profileQuestionTable.$inferSelect;
  ruleCount: number;
}) {
  const emergencyBlocked = question.emergencyAccess && question.publishedAsIndicator;
  // Only blocks turning it ON. A question that is somehow already
  // emergency-marked without being sensitive must still be tickable-off,
  // or the state would be unescapable except by deleting the question.
  const emergencyNeedsSensitive = !question.sensitive && !question.emergencyAccess;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          <input type="hidden" name="sensitive" value="off" />
          <input
            type="checkbox"
            name="sensitive"
            value="on"
            defaultChecked={question.sensitive}
            disabled={!question.sensitive && ruleCount === 0}
            className="disabled:opacity-60"
          />
          Restricted to whoever an access rule allows
        </span>
        <span className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          {ruleCount === 0
            ? "Add an access rule naming this question first — there has to be somebody the answer is allowed to reach."
            : question.sensitive
              ? `Restricted. ${ruleCount} access rule${ruleCount === 1 ? "" : "s"} decide who reads it; the member always reads their own.`
              : `Anyone can read this. ${ruleCount} access rule${ruleCount === 1 ? "" : "s"} ${ruleCount === 1 ? "is" : "are"} staged for it, restricting nothing until this box is ticked.`}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          <input type="hidden" name="emergencyAccess" value="off" />
          <input
            type="checkbox"
            name="emergencyAccess"
            value="on"
            defaultChecked={question.emergencyAccess}
            disabled={emergencyBlocked || emergencyNeedsSensitive}
            className="disabled:opacity-60"
          />
          Available in an emergency
        </span>
        <span className="max-w-[560px] text-[12px] text-[var(--text-muted)]">
          {emergencyBlocked
            ? "Can't be marked emergency while it's published as an indicator — a published aggregate and an emergency override can't both be true of the same answer."
            : emergencyNeedsSensitive
              ? "Only a restricted question can be made available in an emergency: the point is that ordinary readers can't see it."
              : question.emergencyAccess
                ? "In an emergency, whoever is handling it can read this answer, and every read is logged against them."
                : "Off. Turning it on means an emergency responder can read this answer, and every such read is logged."}
        </span>
      </div>
    </div>
  );
}

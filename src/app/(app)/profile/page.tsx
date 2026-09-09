import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { tier } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { listOnceEverAnswers, listOutstandingQuestions } from "@/lib/profile-questions";
import { getCommunity, getCycleTypeCountProgress } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { SENSITIVE_FIELD_LABELS, SensitiveFieldKey } from "@/lib/sensitive-data";
import { CONTACT_METHOD_VISIBILITIES, listOwnContactMethods } from "@/lib/contact-methods";
import { getGatingPurposesForCommunity, hasActiveConsent, listMyConsentStatus } from "@/lib/consent";
import { listAllDistinctTags } from "@/lib/tags";
import { listOwnMemberLanguages, MEMBER_LANGUAGE_LEVELS, type MemberLanguageLevel } from "@/lib/member-languages";
import { listMemberAxisValues, listTraitAxes } from "@/lib/trait-axes";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL } from "@/components/ui/kit";
import AxisScaleField from "@/components/AxisScaleField";
import ThemeToggle from "./ThemeToggle";
import {
  addMemberLanguageAction,
  createContactMethodAction,
  deleteContactMethodAction,
  deleteMemberLanguageAction,
  grantConsentAction,
  submitProfileAnswerAction,
  updateContactMethodAction,
  updateMemberAxisAction,
  updateProfile,
  updateSensitiveDataAction,
  withdrawConsentAction,
} from "./actions";

const LANGUAGE_LEVEL_LABELS: Record<MemberLanguageLevel, string> = {
  basic: "Basic",
  conversational: "Conversational",
  fluent: "Fluent",
  native: "Native",
};

const CONTACT_VISIBILITY_LABELS: Record<(typeof CONTACT_METHOD_VISIBILITIES)[number], string> = {
  everyone: "Everyone in the community",
  task_or_group_mates: "People I share a task or group with",
  emergency_only: "Emergency only",
};

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// Phase 46: an inline consent prompt shown only when a field has a
// configured gating purpose (src/lib/consent.ts's
// getGatingPurposesForCommunity) and this member hasn't granted it yet
// — "at the point a gated field is first populated, not a separate
// settings screen visited in advance." Renders nothing once consent is
// already active (see the general "Your consent" section further down
// for withdrawing it) or when the field isn't gated at all.
function ConsentCheckbox({
  fieldKey,
  formKey,
  gatingPurposes,
  active,
}: {
  fieldKey: SensitiveFieldKey;
  formKey: string;
  gatingPurposes: Map<SensitiveFieldKey, { id: string; label: string; noticeText: string }>;
  active: boolean;
}) {
  const purpose = gatingPurposes.get(fieldKey);
  if (!purpose || active) return null;
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-2.5 text-[13px]">
      <p className="text-[var(--text)]">{purpose.noticeText}</p>
      <label className="mt-1.5 flex items-center gap-2 text-[var(--text)]">
        <input type="checkbox" name={`consent_${formKey}`} /> I consent to &ldquo;{purpose.label}&rdquo;
      </label>
    </div>
  );
}

function QuestionForm({
  questionId,
  responseType,
  options,
  feedsCapacitySignal,
  defaultValue,
  defaultCapacityVisibility,
}: {
  questionId: string;
  responseType: "free_text" | "single_choice" | "multi_choice" | "date";
  options: string[];
  feedsCapacitySignal: boolean;
  defaultValue?: unknown;
  defaultCapacityVisibility?: "flag_only" | "open";
}) {
  return (
    <form action={submitProfileAnswerAction} className="mt-2 flex flex-col gap-2">
      <input type="hidden" name="questionId" value={questionId} />
      {responseType === "free_text" && (
        <input type="text" name="value" defaultValue={typeof defaultValue === "string" ? defaultValue : ""} className={INPUT} />
      )}
      {responseType === "date" && (
        <input type="date" name="value" defaultValue={typeof defaultValue === "string" ? defaultValue : ""} className={`${INPUT} w-fit`} />
      )}
      {responseType === "single_choice" && (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input type="radio" name="value" value={o} defaultChecked={defaultValue === o} /> {o}
            </label>
          ))}
        </div>
      )}
      {responseType === "multi_choice" && (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input
                type="checkbox"
                name="value_multi"
                value={o}
                defaultChecked={Array.isArray(defaultValue) && defaultValue.includes(o)}
              />{" "}
              {o}
            </label>
          ))}
        </div>
      )}
      {feedsCapacitySignal && (
        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          Visible to coordinators as
          <select name="capacityVisibility" defaultValue={defaultCapacityVisibility ?? "flag_only"} className={`${INPUT} py-1`}>
            <option value="flag_only">a coarse flag only</option>
            <option value="open">the exact number</option>
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" name="status" value="answered" className={BUTTON_PRIMARY}>
          Save
        </button>
        <button type="submit" name="status" value="deferred" className={BUTTON_SECONDARY}>
          I don&rsquo;t know yet
        </button>
      </div>
    </form>
  );
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [
    communityTiers,
    outstanding,
    onceEverAnswers,
    communityRow,
    cycleTypeProgress,
    ownContactMethods,
    gatingPurposes,
    myConsentStatus,
    tagSuggestions,
    ownLanguages,
    traitAxes,
    ownAxisValues,
  ] = await Promise.all([
    db.select().from(tier).where(eq(tier.communityId, viewing.communityId)),
    listOutstandingQuestions(viewing),
    listOnceEverAnswers(viewing),
    getCommunity(viewing),
    getCycleTypeCountProgress(viewing),
    listOwnContactMethods(viewing),
    getGatingPurposesForCommunity(viewing.communityId),
    listMyConsentStatus(viewing),
    listAllDistinctTags(viewing),
    listOwnMemberLanguages(viewing),
    listTraitAxes(viewing),
    listMemberAxisValues(viewing.id),
  ]);
  const sensitiveDataOn = isModuleEnabled(communityRow, "sensitive_data");
  // Only a manual-criterion tier is ever hand-toggled here — a computed
  // one (cycle_type_count, Phase 40) is owned by syncComputedTiers and
  // shown read-only below instead. See actions.ts's updateProfile for
  // why the submitted checkbox set can't just overwrite tierIds wholesale.
  const manualTiers = communityTiers.filter((t) => t.criterionType === "manual");

  // Phase 46: which of the 4 sensitive fields currently need a consent
  // prompt inline (a gating purpose exists, and this member hasn't
  // granted it yet) — computed once for the Sensitive data section
  // below rather than re-querying per field.
  const fieldConsentActive = new Map<SensitiveFieldKey, boolean>();
  for (const [fieldKey, purpose] of gatingPurposes) {
    fieldConsentActive.set(fieldKey, await hasActiveConsent(viewing.id, purpose.id));
  }

  return (
    <main className="mx-auto max-w-[480px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Your profile</h1>
      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <section className="mt-4">
        <p className="mb-2 text-[13px] text-[var(--text-muted)]">
          Theme — yours alone, not a community setting. Defaults to your device.
        </p>
        <ThemeToggle />
      </section>

      <form action={updateProfile} className="mt-6 flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Name</span>
          <input type="text" name="name" defaultValue={viewing.name} required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Tags (comma-separated)</span>
          <input
            type="text"
            name="tags"
            defaultValue={viewing.tags.join(", ")}
            placeholder="carpentry, spanish, night-owl"
            list="tag-suggestions"
            className={INPUT}
          />
          <datalist id="tag-suggestions">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>

        {manualTiers.length > 0 && (
          <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
            <legend className="px-1 text-[12px] text-[var(--text-muted)]">Tiers (manual assignment)</legend>
            <div className="flex flex-col gap-1">
              {manualTiers.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                  <input type="checkbox" name="tierIds" value={t.id} defaultChecked={viewing.tierIds.includes(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <CheckField
          label="Email me targeted messages and announcements"
          name="emailNotificationsEnabled"
          defaultChecked={viewing.emailNotificationsEnabled}
        />

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Save
        </button>
      </form>

      <section className="mt-8">
        <SectionHeading>Languages</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Any you speak, at whatever level — used for a task&rsquo;s language Requirement.
        </p>
        {ownLanguages.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None added yet.</p>}
        <div className="mt-2 flex flex-col gap-2">
          {ownLanguages.map((l) => (
            <div key={l.id} className={`flex items-center gap-2 ${CARD}`}>
              <span className="flex-1 text-[13px] text-[var(--text)]">
                {l.language} — {LANGUAGE_LEVEL_LABELS[l.level]}
              </span>
              <form action={deleteMemberLanguageAction}>
                <input type="hidden" name="id" value={l.id} />
                <button type="submit" className={BUTTON_GHOST}>
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={addMemberLanguageAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="text" name="language" placeholder="language" required className={`${INPUT} min-w-[160px] flex-1`} />
          <select name="level" defaultValue="conversational" className={INPUT}>
            {MEMBER_LANGUAGE_LEVELS.map((level) => (
              <option key={level} value={level}>
                {LANGUAGE_LEVEL_LABELS[level]}
              </option>
            ))}
          </select>
          <button type="submit" className={BUTTON_PRIMARY}>
            Add
          </button>
        </form>
      </section>

      {traitAxes.length > 0 && (
        <section className="mt-8">
          <SectionHeading>How you like to work</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Helps surface tasks that fit you — never shown to anyone else, never used to assign you
            anything.
          </p>
          <div className="mt-2 flex flex-col gap-3">
            {traitAxes.map((axis) => (
              <form key={axis.id} action={updateMemberAxisAction} className={CARD}>
                <input type="hidden" name="axisId" value={axis.id} />
                <AxisScaleField axis={axis} name="value" defaultValue={ownAxisValues.get(axis.id) ?? null} />
                <button type="submit" className={`${BUTTON_SECONDARY} mt-2`}>
                  Save
                </button>
              </form>
            ))}
          </div>
        </section>
      )}

      {cycleTypeProgress.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Cycle-type progress</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Computed live off your declared Participation — see /participation.
          </p>
          <div className="mt-2 flex flex-col gap-0.5">
            {cycleTypeProgress.map((p) => (
              <p key={p.tierId} className={`text-[13px] ${p.held ? "text-[var(--success)]" : "text-[var(--text-muted)]"}`}>
                {p.tierName} ({p.cycleTypeName}): {p.count}/{p.minCount} {p.held ? "— earned" : ""}
              </p>
            ))}
          </div>
        </section>
      )}

      {outstanding.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Questions for you</SectionHeading>
          <div className="mt-2 flex flex-col gap-2">
            {outstanding.map(({ question, existingAnswer }) => (
              <div key={question.id} className={CARD}>
                <p className="text-[14px] font-medium text-[var(--text)]">
                  {question.label}
                  {question.required ? " *" : ""}
                </p>
                {existingAnswer?.status === "deferred" && (
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">You said you didn&rsquo;t know yet.</p>
                )}
                <QuestionForm
                  questionId={question.id}
                  responseType={question.responseType}
                  options={question.options}
                  feedsCapacitySignal={question.feedsCapacitySignal}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {onceEverAnswers.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Your answers</SectionHeading>
          <div className="mt-2 flex flex-col gap-2">
            {onceEverAnswers.map(({ question, answer }) => (
              <div key={question.id} className={CARD}>
                <p className="text-[14px] font-medium text-[var(--text)]">{question.label}</p>
                <QuestionForm
                  questionId={question.id}
                  responseType={question.responseType}
                  options={question.options}
                  feedsCapacitySignal={question.feedsCapacitySignal}
                  defaultValue={answer.value}
                  defaultCapacityVisibility={answer.capacityVisibility}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {sensitiveDataOn && (
        <section className="mt-8">
          <SectionHeading>Sensitive data</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Always yours to see and edit. Only visible to others via a task or tier your Community
            has explicitly set to unlock a given field — see <code className="font-mono">/sensitive-data</code>.
          </p>
          <form action={updateSensitiveDataAction} className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{SENSITIVE_FIELD_LABELS.health_conditions}</span>
              <textarea name="healthConditions" rows={2} defaultValue={viewing.healthConditions ?? ""} className={INPUT} />
            </label>
            <ConsentCheckbox
              fieldKey="health_conditions"
              formKey="healthConditions"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("health_conditions") ?? false}
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{SENSITIVE_FIELD_LABELS.allergies}</span>
              <textarea name="allergies" rows={2} defaultValue={viewing.allergies ?? ""} className={INPUT} />
            </label>
            <ConsentCheckbox
              fieldKey="allergies"
              formKey="allergies"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("allergies") ?? false}
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{SENSITIVE_FIELD_LABELS.emergency_contact}</span>
              <input type="text" name="emergencyContact" defaultValue={viewing.emergencyContact ?? ""} className={INPUT} />
            </label>
            <ConsentCheckbox
              fieldKey="emergency_contact"
              formKey="emergencyContact"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("emergency_contact") ?? false}
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>{SENSITIVE_FIELD_LABELS.orientation}</span>
              <input type="text" name="orientation" defaultValue={viewing.orientation ?? ""} className={INPUT} />
            </label>
            <ConsentCheckbox
              fieldKey="orientation"
              formKey="orientation"
              gatingPurposes={gatingPurposes}
              active={fieldConsentActive.get("orientation") ?? false}
            />
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
        </section>
      )}

      <section className="mt-8">
        <SectionHeading>Contact methods</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          You control who sees each one. &ldquo;Emergency only&rdquo; means any member can activate
          Emergency access to reveal it when needed — both of you get notified, and every activation
          is logged. See <code className="font-mono">/members</code> for other members&rsquo; visible methods.
        </p>
        {ownContactMethods.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No contact methods yet.</p>}
        <div className="mt-2 flex flex-col gap-2">
          {ownContactMethods.map((m) => (
            <div key={m.id} className={`flex flex-wrap items-center gap-2 ${CARD}`}>
              <form action={updateContactMethodAction} className="flex flex-1 flex-wrap items-center gap-2">
                <input type="hidden" name="id" value={m.id} />
                <input type="text" name="type" defaultValue={m.type} className={`${INPUT} w-24`} />
                <input type="text" name="value" defaultValue={m.value} className={`${INPUT} min-w-[160px] flex-1`} />
                <select name="visibility" defaultValue={m.visibility} className={INPUT}>
                  {CONTACT_METHOD_VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {CONTACT_VISIBILITY_LABELS[v]}
                    </option>
                  ))}
                </select>
                <button type="submit" className={BUTTON_SECONDARY}>
                  Save
                </button>
              </form>
              <form action={deleteContactMethodAction}>
                <input type="hidden" name="id" value={m.id} />
                <button type="submit" className={BUTTON_GHOST}>
                  Delete
                </button>
              </form>
            </div>
          ))}
        </div>

        <form action={createContactMethodAction} className="mt-3 flex flex-wrap items-center gap-2">
          <input type="text" name="type" placeholder="email, phone, telegram…" required className={`${INPUT} w-36`} />
          <input type="text" name="value" placeholder="value" required className={`${INPUT} min-w-[160px] flex-1`} />
          <select name="visibility" defaultValue="everyone" className={INPUT}>
            {CONTACT_METHOD_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {CONTACT_VISIBILITY_LABELS[v]}
              </option>
            ))}
          </select>
          <button type="submit" className={BUTTON_PRIMARY}>
            Add
          </button>
        </form>
      </section>

      {myConsentStatus.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Your consent</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Every purpose your Community has defined, and whether you currently have it active.
            Withdrawing takes effect immediately — anything it gates stops showing right away.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {myConsentStatus.map(({ purpose, active, grantedAt }) => (
              <div key={purpose.id} className={CARD}>
                <p className="text-[14px] font-medium text-[var(--text)]">
                  {purpose.label}
                  {purpose.gatesSensitiveField && (
                    <span className="font-normal text-[var(--text-muted)]"> — gates {SENSITIVE_FIELD_LABELS[purpose.gatesSensitiveField]}</span>
                  )}
                </p>
                <p className="mt-1 text-[12px] text-[var(--text-muted)]">{purpose.noticeText}</p>
                {active ? (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[13px] text-[var(--success)]">
                      Active{grantedAt ? ` since ${new Date(grantedAt).toLocaleDateString()}` : ""}
                    </span>
                    <form action={withdrawConsentAction}>
                      <input type="hidden" name="purposeId" value={purpose.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Withdraw
                      </button>
                    </form>
                  </div>
                ) : (
                  <form action={grantConsentAction} className="mt-2">
                    <input type="hidden" name="purposeId" value={purpose.id} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Grant consent
                    </button>
                  </form>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

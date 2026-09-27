import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { profileQuestion, tier } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { listOnceEverAnswers, listOutstandingQuestions } from "@/lib/profile-questions";
import { getCycleTypeCountProgress } from "@/lib/settings";
import { listPendingAudienceConsents } from "@/lib/sensitive-data";
import { CONTACT_METHOD_VISIBILITIES, listOwnContactMethods } from "@/lib/contact-methods";
import { listMyConsentStatus } from "@/lib/consent";
import { listAllDistinctTags } from "@/lib/tags";
import { listOwnMemberLanguages, MEMBER_LANGUAGE_LEVELS, type MemberLanguageLevel } from "@/lib/member-languages";
import { listMemberAxisValues, listTraitAxes } from "@/lib/trait-axes";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL } from "@/components/ui/kit";
import AxisScaleField from "@/components/AxisScaleField";
import ProfileQuestionForm from "@/components/ProfileQuestionForm";
import { toFieldShape } from "@/lib/field-shape";
import ThemeToggle from "./ThemeToggle";
import {
  addMemberLanguageAction,
  agreeToEmergencyRevealAction,
  createContactMethodAction,
  deleteContactMethodAction,
  deleteMemberLanguageAction,
  extendAnswerConsentAction,
  grantConsentAction,
  submitProfileAnswerAction,
  updateContactMethodAction,
  updateMemberAxisAction,
  updateProfile,
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
    cycleTypeProgress,
    ownContactMethods,
    myConsentStatus,
    tagSuggestions,
    ownLanguages,
    traitAxes,
    ownAxisValues,
    pendingAudienceConsents,
  ] = await Promise.all([
    db.select().from(tier).where(eq(tier.communityId, viewing.communityId)),
    listOutstandingQuestions(viewing),
    listOnceEverAnswers(viewing),
    getCycleTypeCountProgress(viewing),
    listOwnContactMethods(viewing),
    listMyConsentStatus(viewing),
    listAllDistinctTags(viewing),
    listOwnMemberLanguages(viewing),
    listTraitAxes(viewing),
    listMemberAxisValues(viewing.id),
    listPendingAudienceConsents(viewing),
  ]);
  // Only a manual-criterion tier is ever hand-toggled here — a computed
  // one (cycle_type_count, Phase 40) is owned by syncComputedTiers and
  // shown read-only below instead. See actions.ts's updateProfile for
  // why the submitted checkbox set can't just overwrite tierIds wholesale.
  const manualTiers = communityTiers.filter((t) => t.criterionType === "manual");

  // The label of whatever question each purpose gates, so "Your consent"
  // can say what a grant is actually for rather than naming a purpose in
  // the abstract. Fetched for just the gated ids rather than the whole
  // question list: this page already loads a lot, and a member's consent
  // rows are few.
  const gatedQuestionIds = [
    ...new Set(myConsentStatus.map((s) => s.purpose.gatesQuestionId).filter((id): id is string => Boolean(id))),
  ];
  const gatedQuestions = gatedQuestionIds.length
    ? await db
        .select({ id: profileQuestion.id, label: profileQuestion.label })
        .from(profileQuestion)
        .where(inArray(profileQuestion.id, gatedQuestionIds))
    : [];
  const questionLabelById = new Map(gatedQuestions.map((q) => [q.id, q.label]));

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
          <span className={LABEL}>Date display</span>
          <select name="dateDisplayMode" defaultValue={viewing.dateDisplayMode ?? "inherit"} className={INPUT}>
            <option value="inherit">Use the Community default</option>
            <option value="exact">Exact calendar dates</option>
            <option value="period">Period name + weekday when available</option>
          </select>
          <span className="text-[12px] text-[var(--text-muted)]">
            Read-only date labels only; date inputs and exact dates remain available.
          </span>
        </label>

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
          <SectionHeading>Event-type progress</SectionHeading>
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
          {/* A pointer, not a second copy of the forms. /questions is
              now the canonical place outstanding questions are answered
              from — it groups them by scope (once-ever vs. this event
              vs. this phase) and is where the Dashboard's and
              Community's declare-joining controls send someone. Two
              divergent renderings of the same list would drift, and this
              one couldn't even reach questions for an event the member
              hasn't declared on. The "Your answers" section below still
              edits already-given answers in place, which /questions
              deliberately doesn't cover. */}
          <div className={`mt-2 ${CARD}`}>
            <p className="text-[13px] text-[var(--text)]">
              {outstanding.length === 1
                ? "You have 1 question still to answer."
                : `You have ${outstanding.length} questions still to answer.`}
            </p>
            <Link href="/questions" className={BUTTON_PRIMARY + " mt-3 inline-block"}>
              Answer {outstanding.length === 1 ? "it" : "them"}
            </Link>
          </div>
        </section>
      )}

      {/* The one place a member is asked about an audience they were NOT
          already asked about. Every other consent here is given at the
          moment of answering, against an audience the form showed them.
          This is the other direction: the Community has since added a
          group to a question these answers were already shared with, and
          nothing reaches them until each of them says so. Without this
          list, the alternative is either never reaching them or reaching
          them without asking, and the whole table exists to avoid the
          second.

          Deliberately one row per *group* rather than per question, so
          agreeing to the kitchen team doesn't also hand over to whoever
          was added last week. */}
      {pendingAudienceConsents.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Extend who can see your answers</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Since you answered, your Community has widened what it can read &mdash; a new group on
            a question, or a question marked so it can be pulled out in a crisis. Neither can reach
            your answer until you say so, and nothing changes if you leave these alone: whoever
            could read your answer before still can.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {pendingAudienceConsents.map((pending) =>
              pending.kind === "emergency" ? (
                /* Emergency access is a *reach*, not an audience, so it gets
                   its own sentence rather than a slot in the audience one:
                   "who can read this" and "this can be pulled out in a
                   crisis" are different promises and merging them into one
                   list would blur which one a button was agreeing to. */
                <form key={`e:${pending.answerId}`} action={agreeToEmergencyRevealAction} className={`${CARD} flex flex-wrap items-center gap-2`}>
                  <input type="hidden" name="answerId" value={pending.answerId} />
                  <span className="flex-1 text-[13px] text-[var(--text)]">
                    {pending.questionLabel} &mdash; your Community has marked this one so it can be
                    read by whoever activates Emergency access on your page, and you weren&rsquo;t
                    asked about that. It isn&rsquo;t readable that way until you say so. Whoever does
                    read it is recorded, and you&rsquo;re told it happened.
                  </span>
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Yes, allow that
                  </button>
                </form>
              ) : (
                <form key={`r:${pending.answerId}:${pending.ruleId}`} action={extendAnswerConsentAction} className={`${CARD} flex flex-wrap items-center gap-2`}>
                  <input type="hidden" name="answerId" value={pending.answerId} />
                  <input type="hidden" name="ruleId" value={pending.ruleId} />
                  <span className="flex-1 text-[13px] text-[var(--text)]">
                    {pending.questionLabel} &mdash; share with{" "}
                    {pending.audienceLabel ?? "another group in this Community"}
                  </span>
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Yes, share it
                  </button>
                </form>
              ),
            )}
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
                {/* A stored deferral or decline needs saying out loud here
                    — the form below is a blank "Save" box otherwise, which
                    reads as though nothing is on record. */}
                {answer.status === "deferred" && (
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    You said you didn&rsquo;t know yet. Save a value below if you&rsquo;ve since worked it out.
                  </p>
                )}
                {answer.status === "declined" && (
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    You chose not to answer this. Save a value below if you&rsquo;d like to change that.
                  </p>
                )}
                <ProfileQuestionForm
                  action={submitProfileAnswerAction}
                  questionId={question.id}
                  shape={toFieldShape(question)}
                  feedsCapacitySignal={question.feedsCapacitySignal}
                  allowDeferral={question.allowDeferral}
                  allowPreferNotToSay={question.allowPreferNotToSay}
                  sensitive={question.sensitive}
                  defaultValue={answer.value}
                  defaultCapacityVisibility={answer.capacityVisibility}
                  defaultShareWithAudience={answer.shareWithAudience}
                />
              </div>
            ))}
          </div>
        </section>
      )}

      {/*
          Its own section rather than tucked into "Your answers", which
          only renders once there's something to show. The whole point of
          a standing opt-out is that it can be set *before* answering
          anything — a member who wants to be in the questions but out of
          the aggregates has to be able to say so first, and a control
          that appears only after you've already answered is a control
          that informed nobody.
      */}
      <section className="mt-8">
        <SectionHeading>Community indicators</SectionHeading>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          Some standing questions can be published as a collective picture on{" "}
          <Link href="/community" className="text-[var(--accent-1)] hover:underline">
            the Community page
          </Link>{" "}
          &mdash; a proportion, a distribution or a range, never anybody&rsquo;s individual answer.
          Only questions the whole Community can already read individually are ever
          published, so a published figure says nothing the underlying answers don&rsquo;t
          already say.
        </p>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Your lever is the <strong>prefer not to say</strong> box on each question, which appears
          on every question that can be published. Answering it keeps your answer on your profile
          and out of the figures; declining outright keeps it out of both.
        </p>      </section>

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
                  {purpose.gatesQuestionId && (
                    <span className="font-normal text-[var(--text-muted)]">
                      {" "}
                      &mdash; gates &ldquo;{questionLabelById.get(purpose.gatesQuestionId) ?? "a question no longer here"}&rdquo;
                    </span>
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

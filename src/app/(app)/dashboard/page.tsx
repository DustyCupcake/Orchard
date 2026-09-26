import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, Tree, Users, ChartLineUp, Warning } from "@phosphor-icons/react/dist/ssr";
import { getViewingContext } from "@/lib/view-as";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { resolveDefaultScopeSegment, resolveViewScopeFromSegment } from "@/lib/cycles";
import {
  listOnceEverAnswers,
  listOutstandingQuestions,
  listOutstandingRequiredQuestions,
} from "@/lib/profile-questions";
import { listTaskFitSuggestions, ONBOARDING_CARDS } from "@/lib/onboarding";
import { toFieldShape } from "@/lib/field-shape";
import { listOutstandingOnboardingAxes } from "@/lib/trait-axes";
import { ATTENTION_STYLES } from "@/lib/format";
import { Tag, type Tone, ATTENTION_TONE, Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
import AxisScaleField from "@/components/AxisScaleField";
import ProfileQuestionForm from "@/components/ProfileQuestionForm";
import { EventComingRibbon, EventParticipationCards } from "@/components/EventParticipation";
import CommunityIndicators from "@/components/CommunityIndicators";
import { listCommunityIndicators } from "@/lib/profile-questions/indicators";
import PrefilledAnswersReview from "./PrefilledAnswersReview";
import {
  completeOnboardingAction,
  declareEventStatusAction,
  submitOnboardingAnswerAction,
  submitOnboardingAxisAction,
  submitOnboardingPrefilledAnswersAction,
} from "./actions";

export const dynamic = "force-dynamic";

const HEALTH_STYLES: Record<string, { label: string; tone: Tone }> = {
  on_track: { label: "on track", tone: "success" },
  attention_needed: { label: "attention needed", tone: "warning" },
  struggling: { label: "struggling", tone: "danger" },
};

// A single feed line — link + optional muted meta line, optional
// right-aligned tag. Reused across every one of the dashboard's ~15
// feed sections instead of repeating the row markup each time (see
// design_handoff_conventions' Table pattern: bottom-rule per row,
// hover tint).
function FeedRow({
  href,
  title,
  meta,
  tag,
}: {
  href: string;
  title: React.ReactNode;
  meta?: React.ReactNode;
  tag?: React.ReactNode;
}) {
  return (
    <li className="border-b border-[var(--border)] last:border-b-0">
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] px-1 py-2.5 hover:bg-[var(--surface-sunken)]">
        <div className="min-w-0">
          <Link href={href} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
            {title}
          </Link>
          {meta && <div className="mt-0.5 text-[13px] text-[var(--text-muted)]">{meta}</div>}
        </div>
        {tag && <div className="shrink-0">{tag}</div>}
      </div>
    </li>
  );
}

function StatRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-1 py-2 text-[13px] last:border-b-0">
      <span className="text-[var(--text)]">{label}</span>
      <span className="text-[var(--text-muted)]">{value}</span>
    </li>
  );
}

// `shared` marks a section whose items are outstanding for the Community
// rather than for this member — which is the case exactly when the module is
// open to everyone and they hold nothing (docs/open-permissions-plan.md D12).
// The two are rendered in separate passes, personal first, so "yours" never
// has to compete with "theirs" for attention; the tag is there so the
// distinction survives the reordering rather than being merely implied by
// position.
function FeedSection({
  title,
  shared = false,
  children,
}: {
  title: string;
  shared?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h3 className="mb-1 flex flex-wrap items-center gap-2 text-[15px] font-medium text-[var(--text)]">
        {title}
        {shared && <Tag tone="neutral">open to everyone</Tag>}
      </h3>
      <ul>{children}</ul>
    </div>
  );
}

// Hoisted to module scope so ModuleNeedsActionSections can read them — the
// six module sections moved out of the page body for D12's two-pass render,
// and these three label maps are the only thing they needed from in there.
const NEEDS_ACTION_LABEL: Record<string, string> = {
  call_pending: "evaluated, call not scheduled yet",
  decision_pending: "call happened, decision still pending",
};

const BUDGET_LABEL: Record<string, string> = {
  close_to_voting: "proposal deadline passed — close to voting",
  confirm_funded_set: "voting is in, confirm the funded set",
  cast_vote: "voting is open — cast your vote",
};

const EVENT_STATUS_LABEL: Record<string, string> = {
  conflict: "flagged conflicting",
  proposed: "awaiting your review",
};

// The six module needs-action sections, defined once and rendered twice: the
// `personal` pass first, then the `shared` pass
// (docs/open-permissions-plan.md D12). They were previously six inline
// blocks interleaved with the task-side sections; hoisting them here is what
// makes "personal above shared" expressible at all, and it means the row
// rendering for each module is written once rather than duplicated per pass.
//
// A `shared` section is one whose module is open to everyone and which this
// member holds nothing of. Its rows are rendered exactly as before — the
// items themselves are unchanged, and the data is the same; only the framing
// differs, so an outstanding item is never merely hidden. The titles keep
// their second-person phrasing because with an open module the person who
// ends up doing it *is* whoever reads this ("open to everyone" says the
// standing invitation, and the tag distinguishes it from an obligation).
function ModuleNeedsActionSections({
  feed,
  shared,
}: {
  feed: Awaited<ReturnType<typeof getPersonalFeed>>;
  shared: boolean;
}) {
  const pick = <T,>(list: { personal: T[]; shared: T[] }) => (shared ? list.shared : list.personal);
  return (
    <>
      {pick(feed.recruitmentNeedsAction).length > 0 && (
        <FeedSection title="Recruitment candidates stuck waiting on you" shared={shared}>
          {pick(feed.recruitmentNeedsAction).map((c) => (
            <FeedRow
              key={c.id}
              href="/recruitment"
              title={`Application from ${new Date(c.submittedAt).toLocaleDateString()}`}
              tag={<Tag tone="warning">{NEEDS_ACTION_LABEL[c.stage] ?? c.stage}</Tag>}
            />
          ))}
        </FeedSection>
      )}

      {pick(feed.budgetNeedsAction).length > 0 && (
        <FeedSection title="Budget needs your attention" shared={shared}>
          {pick(feed.budgetNeedsAction).map((b, i) => (
            <FeedRow
              key={`${b.cycleId}-${b.kind}-${i}`}
              href="/budget"
              title={b.cycleTitle}
              tag={<Tag tone="warning">{BUDGET_LABEL[b.kind] ?? b.kind}</Tag>}
            />
          ))}
        </FeedSection>
      )}

      {pick(feed.eventSchedulingNeedsAction).length > 0 && (
        <FeedSection title="Programme proposals awaiting review" shared={shared}>
          {pick(feed.eventSchedulingNeedsAction).map((p) => (
            <FeedRow
              key={p.proposalId}
              href="/schedule"
              title={p.title}
              tag={
                <Tag tone={p.status === "conflict" ? "danger" : "warning"}>
                  {EVENT_STATUS_LABEL[p.status] ?? p.status}
                </Tag>
              }
            />
          ))}
        </FeedSection>
      )}

      {pick(feed.shiftCoordinatorNeedsAction).length > 0 && (
        <FeedSection title="Shift occurrences needing completion marks" shared={shared}>
          {pick(feed.shiftCoordinatorNeedsAction).map((o) => (
            <FeedRow
              key={o.occurrenceId}
              href="/shifts"
              title={o.seriesTitle}
              meta={`${new Date(o.startsAt).toLocaleDateString()}, ${o.unresolvedCount} signup${o.unresolvedCount === 1 ? "" : "s"} still unresolved`}
            />
          ))}
        </FeedSection>
      )}

      {pick(feed.conflictNeedsAction).length > 0 && (
        <FeedSection title="Conflict reports needing acknowledgment" shared={shared}>
          {pick(feed.conflictNeedsAction).map((r) => (
            <FeedRow
              key={r.reportId}
              href="/conflict-reports"
              title={`Report from ${new Date(r.createdAt).toLocaleDateString()}`}
              tag={<Tag tone="danger">past the acknowledgment window</Tag>}
            />
          ))}
        </FeedSection>
      )}

      {pick(feed.kitchenNeedsAction).length > 0 && (
        <FeedSection title="Kitchen needs your attention" shared={shared}>
          {pick(feed.kitchenNeedsAction).map((k) =>
            k.kind === "draft_unpublished" ? (
              <FeedRow
                key={`draft-${k.menuPlanId}`}
                href="/kitchen"
                title={`Draft menu “${k.title}” isn’t published yet`}
                tag={<Tag tone="warning">draft awaiting publish</Tag>}
              />
            ) : (
              <FeedRow
                key={`ideas-${k.menuPlanId}`}
                href="/kitchen"
                title={`${k.openCount} food ${k.openCount === 1 ? "idea" : "ideas"} awaiting review on “${k.title}”`}
                tag={<Tag tone="warning">ideas awaiting review</Tag>}
              />
            ),
          )}
        </FeedSection>
      )}
    </>
  );
}

function SnapshotSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-[15px] font-medium text-[var(--text)]">
        {icon}
        {title}
      </h3>
      <ul>{children}</ul>
    </div>
  );
}

// The shared ProfileQuestionForm, wrapped in this panel's own boxed
// chrome. The wrapper stays here rather than moving into the shared
// component because /profile and /questions both render that form
// directly on a CARD and would get a second, redundant box.
function OnboardingQuestionForm({
  questionId,
  question,
  allowDeferral,
  allowPreferNotToSay,
}: {
  questionId: string;
  // The whole question rather than loose shape props, so this wrapper
  // stays a wrapper — FieldShapeEditor-shaped props here would be a
  // second place to forget a new type.
  question: Parameters<typeof toFieldShape>[0] & {
    allowDeferral: boolean;
    allowPreferNotToSay: boolean;
    sensitive: boolean;
  };
  allowDeferral: boolean;
  allowPreferNotToSay: boolean;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
      <ProfileQuestionForm
        action={submitOnboardingAnswerAction}
        questionId={questionId}
        shape={toFieldShape(question)}
        allowDeferral={allowDeferral}
        allowPreferNotToSay={allowPreferNotToSay}
        sensitive={question.sensitive}
      />
    </div>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ memberCount?: string; error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { memberCount, error } = await searchParams;

  // The same off-URL nav-switcher resolution the Board (Phase 67) and
  // Spatial planning/Schedule (Phase 68) already read, since Dashboard
  // isn't itself under /[cycleScope]/. Drives Branch health's cycle
  // scoping and the "this cycle" option of the community-overview
  // toggle below — see docs/development-plan.md's Phase 69.
  const activeScopeSegment = await resolveDefaultScopeSegment(viewing);
  const activeScope = await resolveViewScopeFromSegment(viewing, activeScopeSegment);
  const scopeCycleIds = activeScope
    ? activeScope.kind === "aggregate"
      ? activeScope.cycles.map((c) => c.id)
      : [activeScope.cycle.id]
    : [];
  const singleScopeCycle = activeScope?.kind === "single" ? activeScope.cycle : null;

  // "This event" is only ever a real option once the switcher actually
  // resolves to one specific cycle — default to it then (closest to
  // this page's old single-cycle-only behavior), otherwise there's
  // nothing to default to but "general". Resolved *above* the queries
  // below because the indicators read it too, and they must land on the
  // same answer as the member count they sit under.
  const memberCountView: "general" | "cycle" =
    memberCount === "general" || memberCount === "cycle"
      ? memberCount
      : singleScopeCycle
        ? "cycle"
        : "general";

  const [feed, snapshot, indicatorResult] = await Promise.all([
    getPersonalFeed(viewing),
    getCommunitySnapshot(viewing, { cycleIds: scopeCycleIds, singleCycleId: singleScopeCycle?.id ?? null }),
    // The indicators follow the *same* "This event / All open events"
    // choice as the member count, rather than getting a second control.
    // Two controls for one underlying question ("who are we talking
    // about?") is two things that can disagree, and a reader would have
    // no way to tell which population a proportion described.
    listCommunityIndicators(viewing, {
      // Not narrowed without a single selected event: there'd be no
      // event to be about, and the widest population is the honest
      // answer rather than a guess at which one was meant.
      requested:
        memberCountView === "cycle" && singleScopeCycle
          ? { kind: "event", cycleId: singleScopeCycle.id, cycleName: singleScopeCycle.name }
          : { kind: "community" },
      // The Community's own policy on breaking indicators out per event
      // is read inside listCommunityIndicators — it already knows which
      // Community it's reading. It resolves the request and reports back
      // if it narrows it, so the section can say so rather than quietly
      // showing all-member figures under a toggle that reads "This event".
    }),
  ]);
  const showingThisCycle = memberCountView === "cycle" && snapshot.activeMemberCount.thisCycle !== null;
  const displayedMemberCount = showingThisCycle
    ? snapshot.activeMemberCount.thisCycle
    : snapshot.activeMemberCount.general;

  // Member onboarding & first session (docs/development-plan.md's
  // Phase 56) — a nudge, never a gate, so this panel only ever renders
  // until hasCompletedOnboarding is set (finished or skipped) and never
  // blocks anything else on this page.
  const [onboardingQuestions, onboardingSuggestions, onboardingAxes, prefilledAnswers] = viewing.hasCompletedOnboarding
    ? [[], [], [], []]
    : await Promise.all([
        listOutstandingQuestions(viewing, { surface: "onboarding" }),
        listTaskFitSuggestions(viewing, { limit: 3 }),
        listOutstandingOnboardingAxes(viewing),
        listOnceEverAnswers(viewing, { surface: "onboarding" }),
      ]);

  // Required questions this member still owes a real answer to. Lives
  // here rather than on a nav item or a shell-wide banner: every other
  // outstanding thing in this app already surfaces on this page, and
  // /questions is a supporting page, not a destination in its own right.
  // Same source as the count folded into the Dashboard's nav badge
  // (src/lib/nav.ts's taskBadgeCount), so the two can't disagree.
  const outstandingRequiredQuestions = await listOutstandingRequiredQuestions(viewing);

  // The held-tasks count the one-liner below reports, narrowed to what
  // the nav switcher is actually pointed at. Same rule as Board's own
  // cycleScope filter (src/lib/tasks/crud.ts's CycleScopeFilter): a task
  // that isn't scoped to any event is always in view, plus anything in
  // the scope's own cycle(s) — so with no resolved cycle in scope this
  // is the cycleless tasks alone, exactly as the board reads it.
  const heldTasksInView = feed.heldTasks.filter(
    (t) => t.cycleId === null || scopeCycleIds.includes(t.cycleId),
  );

  // The six module lists are split (D12), so "does this feed have anything"
  // asks both halves, and the shared half gets its own flag so the whole
  // section can be suppressed when there is nothing at all.
  const hasSharedModuleNeedsAction =
    feed.recruitmentNeedsAction.shared.length > 0 ||
    feed.budgetNeedsAction.shared.length > 0 ||
    feed.eventSchedulingNeedsAction.shared.length > 0 ||
    feed.shiftCoordinatorNeedsAction.shared.length > 0 ||
    feed.conflictNeedsAction.shared.length > 0 ||
    feed.kitchenNeedsAction.shared.length > 0;

  const hasFeedItems =
    feed.pendingJoinRequests.length > 0 ||
    feed.upcomingCheckins.length > 0 ||
    feed.flaggedHeldTasks.length > 0 ||
    feed.emergencyAccessActivity.length > 0 ||
    feed.recruitmentNeedsAction.personal.length > 0 ||
    feed.placementInvites.length > 0 ||
    feed.myLinkedPendingPlacements.length > 0 ||
    feed.placementRevertNotices.length > 0 ||
    feed.placementPendingReviews.length > 0 ||
    feed.budgetNeedsAction.personal.length > 0 ||
    feed.eventSchedulingNeedsAction.personal.length > 0 ||
    feed.shiftCoordinatorNeedsAction.personal.length > 0 ||
    feed.myShiftsNeedingCompletion.length > 0 ||
    feed.conflictNeedsAction.personal.length > 0 ||
    feed.kitchenNeedsAction.personal.length > 0 ||
    feed.expiredNominations.length > 0 ||
    hasSharedModuleNeedsAction;
  const now = Date.now();

  return (
    <main className="mx-auto max-w-[820px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Dashboard</h1>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {outstandingRequiredQuestions.length > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-3">
          <p className="text-[14px] text-[var(--warning)]">
            {outstandingRequiredQuestions.length === 1
              ? "You have a question you still need to answer."
              : `You have ${outstandingRequiredQuestions.length} questions you still need to answer.`}{" "}
            <span className="text-[13px]">
              Your community needs these to run the event.
            </span>
          </p>
          <Link href="/questions" className={BUTTON_PRIMARY}>
            Answer {outstandingRequiredQuestions.length === 1 ? "it" : "them"}
          </Link>
        </div>
      )}

      {/* The one place a member says whether they're coming, at the top
          of their home view. Which of the two renders is decided by
          whether the nav switcher is already narrowed to a single event
          (singleScopeCycle above): inside an event's own view, the
          one-event ribbon is the honest prompt and repeating every open
          event above it would be noise; outside one, the cards strip is
          what makes the other open events — the ones not yet declared on
          — visible at all. */}
      {singleScopeCycle ? (
        <EventComingRibbon viewing={viewing} cycle={singleScopeCycle} action={declareEventStatusAction} />
      ) : (
        <EventParticipationCards viewing={viewing} action={declareEventStatusAction} />
      )}

      {!viewing.hasCompletedOnboarding && (
        <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
          <h2 className="mb-1 text-[20px] font-semibold text-[var(--text)]">
            Welcome — a few things to get you oriented
          </h2>
          <p className="mb-4 text-[13px] text-[var(--text-muted)]">
            Nothing here is required — skip it any time and it won&rsquo;t come back.
          </p>

          <div className="mb-5 grid gap-3 sm:grid-cols-2">
            {ONBOARDING_CARDS.map((card) => (
              <div key={card.title} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <h3 className="mb-1 text-[14px] font-medium text-[var(--text)]">{card.title}</h3>
                <p className="text-[13px] text-[var(--text-muted)]">{card.body}</p>
              </div>
            ))}
          </div>

          {prefilledAnswers.length > 0 && (
            <PrefilledAnswersReview answers={prefilledAnswers} action={submitOnboardingPrefilledAnswersAction} />
          )}

          {onboardingQuestions.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-[15px] font-medium text-[var(--text)]">A couple of quick questions</h3>
              <div className="flex flex-col gap-2">
                {onboardingQuestions.map(({ question }) => (
                  <div key={question.id}>
                    <p className="mb-1 text-[13px] text-[var(--text)]">
                      {question.label}
                      {question.required && <span className="text-[var(--danger)]"> *</span>}
                    </p>
                    <OnboardingQuestionForm
                      questionId={question.id}
                      question={question}
                      allowDeferral={question.allowDeferral}
                      allowPreferNotToSay={question.allowPreferNotToSay}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {onboardingAxes.length > 0 && (
            <div className="mb-5">
              <h3 className="mb-2 text-[15px] font-medium text-[var(--text)]">How do you like to work?</h3>
              <p className="-mt-1 mb-2 text-[13px] text-[var(--text-muted)]">
                Helps surface tasks that fit you — never shown to anyone else, never used to assign you
                anything. A few more of these are settable any time at /profile.
              </p>
              <div className="flex flex-col gap-3">
                {onboardingAxes.map((axis) => (
                  <form
                    key={axis.id}
                    action={submitOnboardingAxisAction}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] p-3"
                  >
                    <input type="hidden" name="axisId" value={axis.id} />
                    <AxisScaleField axis={axis} name="value" />
                    <button
                      type="submit"
                      className="mt-2 rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)]"
                    >
                      Save
                    </button>
                  </form>
                ))}
              </div>
            </div>
          )}

          <div className="mb-5">
            <h3 className="mb-2 text-[15px] font-medium text-[var(--text)]">Open tasks that might fit you</h3>
            {onboardingSuggestions.length === 0 ? (
              <p className="text-[13px] text-[var(--text-muted)]">
                Nothing obviously matching yet —{" "}
                <Link href="/board" className="text-[var(--accent-1)] hover:underline">
                  browse the full board
                </Link>{" "}
                instead.
              </p>
            ) : (
              <>
                <ul>
                  {onboardingSuggestions.map((t) => (
                    <FeedRow key={t.id} href={`/tasks/${t.id}`} title={t.title} meta={t.branchName} />
                  ))}
                </ul>
                <Link href="/board" className="mt-1 inline-block text-[12px] font-medium text-[var(--accent-1)] hover:underline">
                  See everything else on the board →
                </Link>
              </>
            )}
          </div>

          <form action={completeOnboardingAction}>
            <button
              type="submit"
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)]"
            >
              I&rsquo;m all set — don&rsquo;t show this again
            </button>
          </form>
        </section>
      )}

      {/* How much you're carrying, and the two ways in — deliberately one
          line, not a list. This page is the app's attention surface (the
          sidebar's Dashboard badge counts obligations, not held tasks,
          see src/lib/nav.ts's taskBadgeCount), and four of the feed
          sections below are already slices of these same tasks with the
          urgency and the reason attached. A full list here would push
          those down and repeat them without either. */}
      {heldTasksInView.length > 0 ? (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          You hold {heldTasksInView.length} task{heldTasksInView.length === 1 ? "" : "s"} —{" "}
          <Link href="/board?assignedToMe=1&view=kanban" className="font-medium text-[var(--accent-1)] hover:underline">
            see them on the board
          </Link>{" "}
          or{" "}
          <Link href="/contribution" className="font-medium text-[var(--accent-1)] hover:underline">
            your contribution picture
          </Link>
          .
        </p>
      ) : feed.heldTasks.length > 0 ? (
        /* Holding work that simply isn't in the event the switcher is
           pointed at reads very differently from holding nothing — say
           so, or the "not holding any tasks" line would be a lie and
           would send someone off to claim more work they already have. */
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          You hold {feed.heldTasks.length} task{feed.heldTasks.length === 1 ? "" : "s"}, none of them in the
          event you&rsquo;ve got in view —{" "}
          <Link href="/board?assignedToMe=1&view=kanban" className="font-medium text-[var(--accent-1)] hover:underline">
            see them all on the board
          </Link>
          .
        </p>
      ) : (
        /* Holding nothing is the state where this line earns its keep
           most: a plain /board link is the unclaimed queue, which is
           exactly the "go pick something up" surface. Rendered even
           during onboarding, so the page has one obvious next step
           rather than an empty corner. */
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">
          You&rsquo;re not holding any tasks right now —{" "}
          <Link href="/board" className="font-medium text-[var(--accent-1)] hover:underline">
            see what&rsquo;s unclaimed
          </Link>{" "}
          and pick one up.
        </p>
      )}

      <section className="mt-8">
        <h2 className="mb-4 text-[22px] font-semibold text-[var(--text)]">What&rsquo;s next for you</h2>

        {!hasFeedItems && (
          <div className="flex flex-col items-center gap-2 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] px-7 py-8 text-center">
            <CheckCircle size={22} className="text-[var(--text-muted)]" />
            <p className="text-[13px] text-[var(--text-muted)]">
              Nothing pending on what you&rsquo;re holding right now.
            </p>
            <Link href="/board" className="text-[12px] font-medium text-[var(--accent-1)] hover:underline">
              Browse the board
            </Link>
          </div>
        )}

        {feed.expiredNominations.length > 0 && (
          <FeedSection title="Nominations that went unanswered">
            {feed.expiredNominations.map(({ nomination, taskTitle, nomineeName }) => (
              <FeedRow
                key={nomination.id}
                href={`/tasks/${nomination.taskId}`}
                title={taskTitle}
                meta={`${nomineeName} didn't respond, released back to Unclaimed`}
              />
            ))}
          </FeedSection>
        )}

        {feed.pendingJoinRequests.length > 0 && (
          <FeedSection title="Join requests waiting on you">
            {feed.pendingJoinRequests.map((r) => (
              <FeedRow
                key={r.id}
                href={`/tasks/${r.taskId}`}
                title={r.taskTitle}
                meta={`${r.requestedByName} asked to join, ${new Date(r.requestedAt).toLocaleDateString()}`}
              />
            ))}
          </FeedSection>
        )}

        {feed.emergencyAccessActivity.length > 0 && (
          <FeedSection title="Emergency access activity">
            {feed.emergencyAccessActivity.map((a) => (
              <FeedRow
                key={a.id}
                href={`/members/${a.role === "activator" ? a.targetMemberId : a.activatedBy}`}
                title={a.counterpartName}
                meta={
                  <>
                    {a.role === "activator" ? "you activated on them" : "activated on you"},{" "}
                    {new Date(a.activatedAt).toLocaleString()}
                    {a.explanation ? `: "${a.explanation}"` : ""}
                  </>
                }
              />
            ))}
          </FeedSection>
        )}

        {feed.upcomingCheckins.length > 0 && (
          <FeedSection title="Check-ins">
            {feed.upcomingCheckins.map((t) => {
              const overdue = t.nextCheckinAt.getTime() < now;
              return (
                <FeedRow
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  title={t.title}
                  meta={
                    <span className={`inline-flex items-center gap-1 ${overdue ? "font-medium text-[var(--danger)]" : ""}`}>
                      {overdue && <Warning size={12} />}
                      {overdue ? "was due" : "due"} {new Date(t.nextCheckinAt).toLocaleDateString()}
                      {overdue ? " (overdue)" : ""}
                    </span>
                  }
                />
              );
            })}
          </FeedSection>
        )}

        {feed.flaggedHeldTasks.length > 0 && (
          <FeedSection title="Flagged tasks you hold">
            {feed.flaggedHeldTasks.map((t) => (
              <FeedRow
                key={t.id}
                href={`/tasks/${t.id}`}
                title={t.title}
                meta={t.branchName}
                tag={
                  ATTENTION_STYLES[t.attentionLevel] && (
                    <Tag tone={ATTENTION_TONE[t.attentionLevel] ?? "neutral"}>
                      {ATTENTION_STYLES[t.attentionLevel].label}
                    </Tag>
                  )
                }
              />
            ))}
          </FeedSection>
        )}

        

        {feed.placementInvites.length > 0 && (
          <FeedSection title="Spatial planning invites waiting on you">
            {feed.placementInvites.map((i) => (
              <FeedRow
                key={i.placementId}
                href="/spatial-planning"
                title={i.placementLabel}
                meta={`invited by ${i.invitedByName}, ${new Date(i.invitedAt).toLocaleDateString()}`}
              />
            ))}
          </FeedSection>
        )}

        {feed.myLinkedPendingPlacements.length > 0 && (
          <FeedSection title="Placements you&rsquo;re linked to, pending review">
            {feed.myLinkedPendingPlacements.map((p) => (
              <FeedRow key={p.id} href="/spatial-planning" title={p.label} meta="pending the holder's review" />
            ))}
          </FeedSection>
        )}

        {feed.placementRevertNotices.length > 0 && (
          <FeedSection title="Placement edits reverted">
            {feed.placementRevertNotices.map((n) => (
              <FeedRow
                key={n.notice.id}
                href="/spatial-planning"
                title={n.placementLabel}
                meta={`reverted by ${n.revertedByName}${n.notice.note ? `: "${n.notice.note}"` : ""}`}
              />
            ))}
          </FeedSection>
        )}

        {feed.placementPendingReviews.length > 0 && (
          <FeedSection title="Placement changes awaiting your review">
            {feed.placementPendingReviews.map((r) => (
              <FeedRow
                key={r.placement.id}
                href="/spatial-planning"
                title={r.placement.label}
                meta={`moved by ${r.movedByName}`}
              />
            ))}
          </FeedSection>
        )}

        

        

        

        {feed.myShiftsNeedingCompletion.length > 0 && (
          <FeedSection title="Your own past shifts">
            {feed.myShiftsNeedingCompletion.map((s) => (
              <FeedRow
                key={s.signupId}
                href="/shifts"
                title={s.seriesTitle}
                meta={`ended ${new Date(s.endsAt).toLocaleDateString()}, mark it complete`}
              />
            ))}
          </FeedSection>
        )}

        {/* The six module sections, personal pass. Anything `shared` renders
            after every task-side section instead — see the note on
            ModuleNeedsActionSections. */}
        <ModuleNeedsActionSections feed={feed} shared={false} />

        {/* The shared pass. Deliberately last in the feed and deliberately
            not conditional on there being a personal section at all: an open
            module with nothing personal for this member is exactly the case
            where the Community's outstanding work still needs saying. */}
        {hasSharedModuleNeedsAction && (
          <>
            <p className="mb-3 mt-6 text-[13px] text-[var(--text-muted)]">
              Open to everyone — nobody in particular is on the hook for these, so they&rsquo;re
              here rather than in your count.
            </p>
            <ModuleNeedsActionSections feed={feed} shared />
          </>
        )}

        

        
      </section>

      <div className="my-9 h-px bg-[var(--border)]" />

      <section>
        <h2 className="mb-1 text-[22px] font-semibold text-[var(--text)]">Community snapshot</h2>
        <p className="mb-4 text-[13px] text-[var(--text-muted)]">
          Aggregate only — nothing here is broken out by individual. See{" "}
          <Link href="/contribution" className="text-[var(--accent-1)] hover:underline">
            your own contribution picture
          </Link>{" "}
          for what you&rsquo;ve done, or opt in to share it.
        </p>

        {displayedMemberCount !== null && (
          <div className="mb-4">
            <p className="text-[14px] text-[var(--text)]">
              <strong className="font-semibold">{displayedMemberCount}</strong> member
              {displayedMemberCount === 1 ? "" : "s"} coming
              {showingThisCycle
                ? ` this event${singleScopeCycle ? ` (${singleScopeCycle.name})` : ""}`
                : " across every open event"}
            </p>
            {snapshot.activeMemberCount.thisCycle !== null && (
              <div className="mt-1 flex gap-3">
                <Link
                  href="/dashboard?memberCount=cycle"
                  className={
                    showingThisCycle
                      ? "text-[13px] font-medium text-[var(--accent-1)]"
                      : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }
                >
                  This event
                </Link>
                <Link
                  href="/dashboard?memberCount=general"
                  className={
                    !showingThisCycle
                      ? "text-[13px] font-medium text-[var(--accent-1)]"
                      : "text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
                  }
                >
                  All open events
                </Link>
              </div>
            )}
          </div>
        )}

        {indicatorResult.indicators.length > 0 && (
          <div className="mb-5">
            <CommunityIndicators
              scope={indicatorResult.scope}
              indicators={indicatorResult.indicators}
              scopeFallback={indicatorResult.scopeFallback}
            />
          </div>
        )}

        {snapshot.tierCounts.length > 0 && (
          <SnapshotSection title="Tiers" icon={<Users size={16} className="text-[var(--text-muted)]" />}>
            {snapshot.tierCounts.map((t) => (
              <StatRow key={t.id} label={t.name} value={`${t.count} member${t.count === 1 ? "" : "s"}`} />
            ))}
          </SnapshotSection>
        )}

        {snapshot.branchSpread.length > 0 && (
          <SnapshotSection title="Branch spread" icon={<Tree size={16} className="text-[var(--text-muted)]" />}>
            {snapshot.branchSpread.map((b) => (
              <StatRow
                key={b.id}
                label={b.name}
                value={`${b.memberCount} member${b.memberCount === 1 ? "" : "s"} holding a task`}
              />
            ))}
          </SnapshotSection>
        )}

        {snapshot.branchHealth.length > 0 && (
          <SnapshotSection title="Branch health" icon={<ChartLineUp size={16} className="text-[var(--text-muted)]" />}>
            {snapshot.branchHealth.map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-1 py-2 text-[13px] last:border-b-0">
                <span className="text-[var(--text)]">{b.name}</span>
                <span className="flex items-center gap-2">
                  {b.counts && (
                    <span className="text-[var(--text-muted)]">
                      {b.counts.soft} soft · {b.counts.hard} hard · {b.counts.escalated} escalated
                    </span>
                  )}
                  <Tag tone={HEALTH_STYLES[b.status].tone}>{HEALTH_STYLES[b.status].label}</Tag>
                </span>
              </li>
            ))}
          </SnapshotSection>
        )}
      </section>
    </main>
  );
}

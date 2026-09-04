import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle, Tree, Users, ChartLineUp, Warning } from "@phosphor-icons/react/dist/ssr";
import { getViewingContext } from "@/lib/view-as";
import { getCommunitySnapshot, getPersonalFeed } from "@/lib/dashboard";
import { listOutstandingQuestions } from "@/lib/profile-questions";
import { listTaskFitSuggestions, ONBOARDING_CARDS } from "@/lib/onboarding";
import { ATTENTION_STYLES } from "@/lib/format";
import { Tag, type Tone, ATTENTION_TONE } from "@/components/ui/kit";
import {
  completeOnboardingAction,
  respondToNominationAction,
  submitOnboardingAnswerAction,
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

function FeedSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="mb-1 text-[15px] font-medium text-[var(--text)]">{title}</h3>
      <ul>{children}</ul>
    </div>
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

function OnboardingQuestionForm({
  questionId,
  responseType,
  options,
}: {
  questionId: string;
  responseType: "free_text" | "single_choice" | "multi_choice" | "date";
  options: string[];
}) {
  return (
    <form
      action={submitOnboardingAnswerAction}
      className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
    >
      <input type="hidden" name="questionId" value={questionId} />
      {responseType === "free_text" && (
        <input type="text" name="value" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-[13px]" />
      )}
      {responseType === "date" && (
        <input type="date" name="value" className="rounded-[var(--radius-sm)] border border-[var(--border)] px-2 py-1.5 text-[13px]" />
      )}
      {responseType === "single_choice" && (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-[13px]">
              <input type="radio" name="value" value={o} /> {o}
            </label>
          ))}
        </div>
      )}
      {responseType === "multi_choice" && (
        <div className="flex flex-col gap-1">
          {options.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" name="value_multi" value={o} /> {o}
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          name="status"
          value="answered"
          className="rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)]"
        >
          Save
        </button>
        <button
          type="submit"
          name="status"
          value="deferred"
          className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent-1)] hover:bg-[var(--accent-1-softer)]"
        >
          I don&rsquo;t know yet
        </button>
      </div>
    </form>
  );
}

export default async function DashboardPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [feed, snapshot] = await Promise.all([
    getPersonalFeed(viewing),
    getCommunitySnapshot(viewing),
  ]);

  // Member onboarding & first session (docs/development-plan.md's
  // Phase 56) — a nudge, never a gate, so this panel only ever renders
  // until hasCompletedOnboarding is set (finished or skipped) and never
  // blocks anything else on this page.
  const [onboardingQuestions, onboardingSuggestions] = viewing.hasCompletedOnboarding
    ? [[], []]
    : await Promise.all([
        listOutstandingQuestions(viewing, { surface: "onboarding" }),
        listTaskFitSuggestions(viewing, { limit: 3 }),
      ]);

  const hasFeedItems =
    feed.pendingJoinRequests.length > 0 ||
    feed.upcomingCheckins.length > 0 ||
    feed.flaggedHeldTasks.length > 0 ||
    feed.emergencyAccessActivity.length > 0 ||
    feed.recruitmentNeedsAction.length > 0 ||
    feed.placementInvites.length > 0 ||
    feed.myLinkedPendingPlacements.length > 0 ||
    feed.placementRevertNotices.length > 0 ||
    feed.placementPendingReviews.length > 0 ||
    feed.calendarEventInvites.length > 0 ||
    feed.budgetNeedsAction.length > 0 ||
    feed.eventSchedulingNeedsAction.length > 0 ||
    feed.shiftCoordinatorNeedsAction.length > 0 ||
    feed.myShiftsNeedingCompletion.length > 0 ||
    feed.conflictNeedsAction.length > 0 ||
    feed.pendingNominations.length > 0 ||
    feed.expiredNominations.length > 0;
  const now = Date.now();

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

  return (
    <main className="mx-auto max-w-[820px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Dashboard</h1>

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
                      responseType={question.responseType}
                      options={question.options}
                    />
                  </div>
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

        {feed.pendingNominations.length > 0 && (
          <FeedSection title="Tasks someone thinks fit you">
            <p className="-mt-0.5 mb-2 text-[13px] text-[var(--text-muted)]">
              You&rsquo;re already holding these — a yes, no, or not-now are all fine. No response
              by the deadline releases it back automatically.
            </p>
            {feed.pendingNominations.map(({ nomination, taskTitle, nominatorName }) => (
              <li key={nomination.id} className="border-b border-[var(--border)] px-1 py-2.5 last:border-b-0">
                <Link href={`/tasks/${nomination.taskId}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {taskTitle}
                </Link>{" "}
                <span className="text-[13px] text-[var(--text-muted)]">
                  — {nominatorName} thinks this is a fit, respond by{" "}
                  {new Date(nomination.respondByDeadline).toLocaleString()}
                  {nomination.message && <>: &ldquo;{nomination.message}&rdquo;</>}
                </span>
                <form action={respondToNominationAction} className="mt-2 flex gap-2">
                  <input type="hidden" name="nominationId" value={nomination.id} />
                  <button
                    type="submit"
                    name="response"
                    value="accepted"
                    className="rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3 py-1.5 text-[12px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)]"
                  >
                    Accept
                  </button>
                  <button
                    type="submit"
                    name="response"
                    value="declined"
                    className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)]"
                  >
                    Not for me
                  </button>
                  <button
                    type="submit"
                    name="response"
                    value="not_now"
                    className="rounded-[var(--radius-md)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--accent-1)] hover:bg-[var(--accent-1-softer)]"
                  >
                    Not right now
                  </button>
                </form>
              </li>
            ))}
          </FeedSection>
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

        {feed.recruitmentNeedsAction.length > 0 && (
          <FeedSection title="Recruitment candidates stuck waiting on you">
            {feed.recruitmentNeedsAction.map((c) => (
              <FeedRow
                key={c.id}
                href="/recruitment"
                title={`Application from ${new Date(c.submittedAt).toLocaleDateString()}`}
                tag={<Tag tone="warning">{NEEDS_ACTION_LABEL[c.stage] ?? c.stage}</Tag>}
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

        {feed.budgetNeedsAction.length > 0 && (
          <FeedSection title="Budget needs your attention">
            {feed.budgetNeedsAction.map((b, i) => (
              <FeedRow
                key={`${b.cycleId}-${b.kind}-${i}`}
                href="/budget"
                title={b.cycleTitle}
                tag={<Tag tone="warning">{BUDGET_LABEL[b.kind] ?? b.kind}</Tag>}
              />
            ))}
          </FeedSection>
        )}

        {feed.eventSchedulingNeedsAction.length > 0 && (
          <FeedSection title="Event proposals awaiting review">
            {feed.eventSchedulingNeedsAction.map((p) => (
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

        {feed.shiftCoordinatorNeedsAction.length > 0 && (
          <FeedSection title="Shift occurrences needing completion marks">
            {feed.shiftCoordinatorNeedsAction.map((o) => (
              <FeedRow
                key={o.occurrenceId}
                href="/shifts"
                title={o.seriesTitle}
                meta={`${new Date(o.startsAt).toLocaleDateString()}, ${o.unresolvedCount} signup${o.unresolvedCount === 1 ? "" : "s"} still unresolved`}
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

        {feed.conflictNeedsAction.length > 0 && (
          <FeedSection title="Conflict reports needing acknowledgment">
            {feed.conflictNeedsAction.map((r) => (
              <FeedRow
                key={r.reportId}
                href="/conflict-reports"
                title={`Report from ${new Date(r.createdAt).toLocaleDateString()}`}
                tag={<Tag tone="danger">past the acknowledgment window</Tag>}
              />
            ))}
          </FeedSection>
        )}

        {feed.calendarEventInvites.length > 0 && (
          <FeedSection title="Event invites waiting on you">
            {feed.calendarEventInvites.map((i) => (
              <FeedRow
                key={i.eventId}
                href="/calendar"
                title={i.eventTitle}
                meta={`invited by ${i.invitedByName}, ${new Date(i.invitedAt).toLocaleDateString()}`}
              />
            ))}
          </FeedSection>
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

        {snapshot.activeMemberCount !== null && (
          <p className="mb-4 text-[14px] text-[var(--text)]">
            <strong className="font-semibold">{snapshot.activeMemberCount}</strong> member
            {snapshot.activeMemberCount === 1 ? "" : "s"} coming this cycle
          </p>
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

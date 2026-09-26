import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isAdmin } from "@/lib/settings/admins";
import { isModuleEnabled } from "@/lib/modules";
import {
  describeRecruitmentAuthority,
  getCycleJoiningState,
  getMyRecruitmentSubscription,
  getRecruitmentApplicationForm,
  isRecruitmentTaskHolder,
  listApplicationAlerts,
  listOpenIntroCallsForSubscriber,
  getRecruitmentPipeline,
} from "@/lib/recruitment";
import { ForbiddenError } from "@/lib/errors";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import { Banner, BUTTON_SECONDARY, CARD, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  evaluation_in_progress: "Evaluation in progress",
  call_pending: "Call pending",
  call_scheduled: "Call scheduled",
  decision_pending: "Decision pending",
  accepted: "Accepted",
  declined: "Declined",
  accompaniment_assigned: "Accompaniment assigned",
};

// "Evaluated-but-uncalled, called-but-undecided" — docs/development-
// plan.md's Phase 35. The same subset src/lib/recruitment/pipeline.ts's
// listRecruitmentActionItems surfaces on /dashboard, flagged here too
// so the pipeline view itself makes the same cases legible in place.
const NEEDS_ACTION_STAGES = new Set(["call_pending", "decision_pending"]);

const OUTCOME_LABEL: Record<string, string> = {
  proceed: "Proceed",
  wider_discussion: "Wider discussion",
  decline: "Decline",
};

function timeSince(date: Date): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

const TH = "border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
const TD = "border-b border-[var(--border)] px-2 py-2 text-[var(--text)]";

// How many per-event door rows to resolve on this page. The hub is a
// summary, not an index of every event the community has ever run — an
// old closed event still in `cycle` is not news, and getCycleJoiningState
// costs a few queries apiece, so the list is deliberately truncated with
// a "and N more" line rather than resolved in full.
const MAX_EVENT_ROWS = 6;

// "Not a community-wide view" is the right rule for the *pipeline* — it
// is one person's working queue of other people's applicants. It was the
// wrong rule for the *page*: this route is the Recruitment nav entry for
// every member, so a member without the task used to arrive, read a title
// saying "Recruitment pipeline", and then be told the view wasn't visible
// to them. Every link out of the sidebar's Recruitment item that the nav
// config claims is "reachable from within Recruitment itself" also wasn't
// (/invites had no route in from here at all), and the one state that
// actually needed reporting — nobody is staffing Recruitment — was
// invisible to everyone including whoever could fix it.
//
// So this is now a hub: the shared "how do people get in" facts every
// member can act on, the authority state (staffed / unstaffed / ungranted),
// and the pipeline only for whoever can actually work it. Ordering is
// deliberate — a member who can't hold the task is the common case and
// gets the most useful content; the pipeline is the last section, not the
// page's premise.
export default async function RecruitmentHubPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");

  if (!moduleOn) {
    return (
      <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader title="Recruitment" />
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      </main>
    );
  }

  const [isHolder, admin, authority, form, subscription, openIntroCalls, appUrl, openCycles] = await Promise.all([
    isRecruitmentTaskHolder(viewing),
    isAdmin(viewing),
    describeRecruitmentAuthority(viewing.communityId),
    getRecruitmentApplicationForm(viewing),
    getMyRecruitmentSubscription(viewing),
    listOpenIntroCallsForSubscriber(viewing),
    resolveAppUrlFromHeaders(),
    // Open (not closed) events only, newest first — a closed event admits
    // nobody, so its doors are not worth a row here.
    db
      .select({ id: cycle.id, name: cycle.name })
      .from(cycle)
      .where(and(eq(cycle.communityId, viewing.communityId), isNull(cycle.closedAt)))
      .orderBy(cycle.startedAt),
  ]);

  const shownCycles = openCycles.slice(0, MAX_EVENT_ROWS);
  const hiddenCycleCount = openCycles.length - shownCycles.length;
  const eventRows = await Promise.all(
    shownCycles.map(async (c) => ({ cycle: c, state: await getCycleJoiningState(viewing.communityId, c.id) })),
  );

  let pipeline = null;
  if (isHolder) {
    pipeline = await getRecruitmentPipeline(viewing);
  }

  // A non-holder's own view: "something is pending", never the answers.
  // listApplicationAlerts enforces holder-or-subscriber and throws for
  // anyone else, which is the correct rule for the list itself — the hub
  // just doesn't treat "not subscribed" as an error worth surfacing.
  let alerts: Awaited<ReturnType<typeof listApplicationAlerts>> = [];
  if (!isHolder) {
    try {
      alerts = await listApplicationAlerts(viewing);
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
    }
  }

  const canAct = isHolder || admin;
  const { open, grants, holders, evaluatorCount, needsTaskToFileUnder } = authority;
  const hasForm = Boolean(form);
  // The contradiction this hub exists partly to surface: a decision needs
  // `recruitmentEvaluatorCount` *distinct* filed evaluations, but only a
  // current holder of a recruitment-granted task can file one, and
  // `recruitment` is single-cardinality per scope
  // (src/lib/permissions.ts's MULTI_CARDINALITY_MODULES). So on the
  // default count of 2 with one holder, no rule above the unconditional
  // fallback can ever match, and every application parks at
  // decision_pending forever. Held back rather than auto-widened: opening
  // evaluation to everyone is a real policy decision for the community, so
  // the interface reports the gap instead of resolving it. An open module
  // makes evaluatorCount infinite and so never trips this — which is correct,
  // because open *is* the resolution.
  const evaluationUnreachable =
    !open && evaluatorCount > 0 && evaluatorCount < communityRow.recruitmentEvaluatorCount;

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Recruitment"
        description="How people get into this Community — the doors that are open, and who is looking after the applications that come through them."
      />

      {/* 1. The shared, always-true part. Every member can act on all of
          this, which is the point: the old page had nothing here. */}
      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Bringing someone in</h2>
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">
          {hasForm
            ? "Anyone can apply, and any member can create a single-use invite link."
            : "Any member can still create a single-use invite link — an Admins holder picks an application form under Recruitment on the Settings screen."}
        </p>

        <div className="mt-3 space-y-3">
          <div className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <strong className="text-[var(--text)]">Public applications</strong>
              <Tag tone={communityRow.recruitmentApplicationsOpen ? "success" : "warning"}>
                {communityRow.recruitmentApplicationsOpen ? "open" : "closed"}
              </Tag>
            </div>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {hasForm
                ? "Anyone with the link can fill in the form and become an applicant — no account needed to start."
                : "No application form is configured, so there is nothing to apply with yet."}
            </p>
            {hasForm && (
              <p className="mt-1 text-[13px] text-[var(--text)]">
                Share <span className="break-all">{appUrl}/apply</span>
              </p>
            )}
            <Link href="/invites" className={`${BUTTON_SECONDARY} mt-2 inline-block`}>
              Create an invite link
            </Link>
          </div>
        </div>
      </section>

      {/* 2. Per-event doors. The community-level toggle only says the
          community hasn't closed its doors; an event can still be full or
          explicitly shut, and that used to only be discoverable on the
          event's own participation page. */}
      {eventRows.length > 0 && (
        <section className="mt-6">
          <h2 className="text-[22px] font-semibold text-[var(--text)]">Events accepting people</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {eventRows.map(({ cycle: c, state }) => {
              const admitting = state.applicationsOpen || state.invitesOpen;
              return (
                <li key={c.id} className={CARD}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/${c.id}/participation`}
                      className="text-[15px] font-medium text-[var(--text)] hover:underline"
                    >
                      {c.name}
                    </Link>
                    <Tag tone={admitting ? "success" : "neutral"}>{admitting ? "admitting" : "closed"}</Tag>
                    {state.applicationsOpen && <Tag tone="accent">applications</Tag>}
                    {state.invitesOpen && <Tag tone="accent">invites</Tag>}
                  </div>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    {state.capacity === null
                      ? "No capacity limit"
                      : state.remainingCapacity !== null && state.remainingCapacity > 0
                        ? `${state.remainingCapacity} of ${state.capacity} places left`
                        : "Full"}
                    {state.holds > 0 && ` · ${state.holds} place${state.holds === 1 ? "" : "s"} held by an outstanding invite`}
                    {!admitting && state.atCapacity && " · at capacity"}
                  </p>
                </li>
              );
            })}
          </ul>
          {hiddenCycleCount > 0 && (
            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
              And {hiddenCycleCount} more open event{hiddenCycleCount === 1 ? "" : "s"} — see{" "}
              <Link href="/participation" className="text-[var(--accent-1)] hover:underline">
                Events
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {/* 3. The authority state — the thing the old page could not report.
          Three distinct stuck states, and they need different fixes, so
          they get different copy. */}
      {/* The "no task grants this" warning is only true when the module is
          also not open. An open Community is staffed by definition, so
          showing it here would say "nobody can evaluate applications" about
          a Community where everyone can — the exact self-contradiction this
          hub exists to end. */}
      {grants.length === 0 && !open && (
        <section className="mt-6">
          <Banner tone="warning">
            No task grants Recruitment, so nobody can evaluate applications or answer the inquiry inbox.
            {admin ? (
              <>
                {" "}
                Grant one under{" "}
                <Link href="/settings?tab=permissions" className="underline">
                  Access &amp; permissions
                </Link>
                , or turn on{" "}
                <Link href="/settings?tab=permissions" className="underline">
                  everyone has this permission
                </Link>
                .
              </>
            ) : (
              <> A current Admins holder can grant one, or open it to everyone, under Access &amp; permissions.</>
            )}
          </Banner>
        </section>
      )}

      {/* The other half of the open story, and the one that is genuinely a
          gap: an open module has no granting task, and both decision
          side-effects take their branchId from that task. There is no
          member- or cycle-scoped branch to fall back on, so a real intro-call
          poll and a real accompaniment task are not created. Reported rather
          than filed under an arbitrary branch. */}
      {open && needsTaskToFileUnder && canAct && (
        <section className="mt-6">
          <Banner tone="warning">
            Recruitment is open to everyone, so applications can be evaluated and decided — but no
            task grants Recruitment, and the intro call and the accompaniment task that follow a
            decision are filed under that task&rsquo;s branch. Without one, those two are not created.
            {admin ? (
              <>
                {" "}
                Grant one under{" "}
                <Link href="/settings?tab=permissions" className="underline">
                  Access &amp; permissions
                </Link>
                .
              </>
            ) : (
              <> A current Admins holder can grant one under Access &amp; permissions.</>
            )}
          </Banner>
        </section>
      )}

      {grants.length > 0 && holders.length === 0 && !open && (
        <section className="mt-6">
          <Banner tone="warning">
            {grants.length === 1 ? (
              <>
                <Link href={`/tasks/${grants[0].taskId}`} className="underline">
                  {grants[0].taskTitle}
                </Link>{" "}
                grants Recruitment, but nobody is holding it right now — so applications aren&rsquo;t
                being evaluated.
              </>
            ) : (
              <>
                {grants.length} tasks grant Recruitment, but none of them is held right now — so
                applications aren&rsquo;t being evaluated.
              </>
            )}{" "}
            {canAct ? "Open the task to see how to put yourself forward." : "A member can put themselves forward for it."}
          </Banner>
        </section>
      )}

      {/* 4. The evaluator-count contradiction, reported rather than
          resolved. Only worth saying to someone who can act on it — for a
          plain member it's a settings problem, not their problem. */}
      {evaluationUnreachable && canAct && (
        <section className="mt-6">
          <Banner tone="warning">
            A decision needs {communityRow.recruitmentEvaluatorCount} separate evaluations filed, but
            only {evaluatorCount} {evaluatorCount === 1 ? "person is" : "people are"} currently able to
            file one — so no decision rule can ever be reached and applications sit at &ldquo;decision
            pending&rdquo; indefinitely. Either lower &ldquo;Evaluators needed per application&rdquo;, or
            widen who may evaluate — see{" "}
            <Link href="/settings?tab=recruitment" className="underline">
              Recruitment settings
            </Link>
            .
          </Banner>
        </section>
      )}

      {/* 5. Where to actually do things. This is the routing the nav
          config assumed existed ("reachable from within Recruitment
          itself") and /invites in particular had none of. */}
      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Your part in it</h2>
        <ul className="mt-3 flex flex-col gap-2">
          <li className={CARD}>
            <Link href="/applications" className="text-[15px] font-medium text-[var(--text)] hover:underline">
              Applications
            </Link>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {isHolder
                ? "Full applicant answers, your recommendations, decisions and the wider-discussion window."
                : "Subscribe to see that something is pending, raise an objection while wider discussion is open, and submit your availability for intro calls."}
            </p>
          </li>
          <li className={CARD}>
            <Link href="/invites" className="text-[15px] font-medium text-[var(--text)] hover:underline">
              Invites
            </Link>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {isHolder
                ? "Your invite links, plus the inquiry inbox."
                : "Create invite links and see the ones you've made."}
            </p>
          </li>
        </ul>

        {!isHolder && (
          <p className="mt-3 text-[13px] text-[var(--text-muted)]">
            {subscription?.active ? (
              <>
                You&rsquo;re subscribed to application alerts
                {openIntroCalls.length > 0 && (
                  <>
                    {" "}and have{" "}
                    {openIntroCalls.length === 1 ? "an intro call" : `${openIntroCalls.length} intro calls`} still
                    gathering availability —{" "}
                    <Link
                      href={`/scheduling-polls/${openIntroCalls[0].pollId}`}
                      className="text-[var(--accent-1)] hover:underline"
                    >
                      submit yours
                    </Link>
                    .
                  </>
                )}
              </>
            ) : (
              <>
                Subscribing on{" "}
                <Link href="/applications" className="text-[var(--accent-1)] hover:underline">
                  Applications
                </Link>{" "}
                gets you a say: alerts when something is pending, and the ability to object while wider
                discussion is open. You can&rsquo;t see applicants&rsquo; own answers without the task.
              </>
            )}
          </p>
        )}
      </section>

      {/* 6. What a subscriber can see, if they asked to see it. The same
          "pending, not answers" rule /applications renders — the hub
          summarises rather than duplicating the objection forms, which
          live on /applications. */}
      {!isHolder && subscription?.active && (
        <section className="mt-6">
          <h2 className="text-[22px] font-semibold text-[var(--text)]">
            Pending applications ({alerts.length})
          </h2>
          {alerts.length === 0 && (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing pending.</p>
          )}
          {alerts.length > 0 && (
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Stage only — you&rsquo;re not a current recruitment-task holder, so not the
              applicant&rsquo;s own answers.
            </p>
          )}
          {alerts.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {alerts.map((a) => (
                <li key={a.id} className={CARD}>
                  <p className="text-[13px] text-[var(--text)]">
                    Submitted {new Date(a.submittedAt).toLocaleDateString()} ·{" "}
                    {a.evaluationsFiled}/{a.evaluatorsNeeded} evaluations filed
                    {a.outcome && (
                      <>
                        {" "}· <strong>{OUTCOME_LABEL[a.outcome] ?? a.outcome}</strong>
                      </>
                    )}
                    {a.widerDiscussionStatus && <> · window {a.widerDiscussionStatus}</>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {alerts.some((a) => a.widerDiscussionStatus === "open") && (
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              A wider-discussion window is open — you can object to one of these on{" "}
              <Link href="/applications" className="text-[var(--accent-1)] hover:underline">
                Applications
              </Link>
              .
            </p>
          )}
        </section>
      )}

      {/* 7. Holder-only, and last: the working queue. */}
      {isHolder && (
        <>
          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">Context</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Informational only — never a scoring formula. What &ldquo;balanced&rdquo; means for
              this group is a human call.
            </p>
            {pipeline?.capacity ? (
              <p className="mt-2 text-[13px] text-[var(--text)]">
                Capacity {pipeline.capacity.capacity ?? "unset"} · {pipeline.capacity.comingCount} coming
                this event
                {pipeline.capacity.holds > 0 && ` · ${pipeline.capacity.holds} held`}
                {pipeline.capacity.remainingCapacity !== null && (
                  <>
                    {" · "}
                    {pipeline.capacity.remainingCapacity < 0
                      ? `${-pipeline.capacity.remainingCapacity} over capacity`
                      : `${pipeline.capacity.remainingCapacity} remaining`}
                  </>
                )}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                No current event — remaining capacity isn&rsquo;t tracked.
              </p>
            )}

            {pipeline && pipeline.composition.tierCounts.length > 0 && (
              <p className="mt-1 text-[13px] text-[var(--text)]">
                Tiers: {pipeline.composition.tierCounts.map((t) => `${t.name} ${t.count}`).join(" · ")}
              </p>
            )}
            {pipeline && pipeline.composition.branchSpread.length > 0 && (
              <p className="mt-1 text-[13px] text-[var(--text)]">
                Branches:{" "}
                {pipeline.composition.branchSpread.map((b) => `${b.name} ${b.memberCount}`).join(" · ")}
              </p>
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">
              Candidates ({pipeline?.candidates.length ?? 0})
            </h2>
            {pipeline?.candidates.length === 0 && (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nobody in flight right now.</p>
            )}
            {pipeline && pipeline.candidates.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Submitted</th>
                      <th className={TH}>Stage</th>
                      <th className={TH}>Time in stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.candidates.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--surface-sunken)]">
                        <td className={TD}>{new Date(c.submittedAt).toLocaleDateString()}</td>
                        <td className={TD}>
                          <span className="flex items-center gap-2">
                            {STAGE_LABEL[c.stage] ?? c.stage}
                            {NEEDS_ACTION_STAGES.has(c.stage) && <Tag tone="warning">needs action</Tag>}
                          </span>
                        </td>
                        <td className={TD}>{timeSince(c.stageSince)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">
              Evaluate recommendations, manage the wider-discussion window, or view an
              applicant&rsquo;s own answers on{" "}
              <Link href="/applications" className="text-[var(--accent-1)] hover:underline">
                Applications
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </main>
  );
}

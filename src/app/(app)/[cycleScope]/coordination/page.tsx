import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveViewScopeFromSegment } from "@/lib/cycles";
import { getCommunity } from "@/lib/settings";
import { listCapacitySignal } from "@/lib/profile-questions";
import { listCoordinationScopeIds } from "@/lib/coordination";
import { listEngagementPatternsForCoordinator } from "@/lib/engagement";
import {
  flaggedTasks,
  listCoordinationCoverage,
  listCoordinationResponseQueue,
  listCoordinationScopeTasks,
  listOverdueCheckins,
  listPendingSuggestions,
  needsAnOwner,
  type CoordinationScopeTask,
} from "@/lib/tasks/coordination-dashboard";
import { Tag, type Tone, Banner } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";

export const dynamic = "force-dynamic";

// Local, like conflict-reports/page.tsx and documentation/page.tsx —
// two call sites of an identical four-line h2 isn't a third.
function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

const FLAG_LABEL: Record<string, string> = {
  has_room: "has room",
  about_right: "about right",
  over: "over",
};

const PATTERN_TONE: Record<string, Tone> = {
  noted: "neutral",
  soft_flag: "warning",
  pattern: "danger",
};
const PATTERN_LABEL: Record<string, string> = {
  noted: "noted",
  soft_flag: "soft flag",
  pattern: "pattern — worth a conversation",
};

const STATUS_TONE: Record<string, Tone> = {
  unclaimed: "warning",
  claimed: "accent",
  waiting: "neutral",
  done: "success",
};

// The real Coordination page (docs/cycle-scope-remediation-plan.md
// §5.3): it lives under /[cycleScope] and gates on the view-scope cycle
// when the community runs cycles, staying community-wide for cycle-less
// ones — the same movement /participation and /budget made (Phase 65).
//
// What it renders is a dashboard of the coordinator's own scope rather
// than the two flat lists it started as: every module below answers one
// question a coordinator opens this page to ask, and all of them are
// scoped to the same authority (their branch column union their cycle
// row, intersected with the view scope) so no two modules can disagree
// about which tasks are theirs.
export default async function CycleScopeCoordinationPage({
  params,
}: {
  params: Promise<{ cycleScope: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const scope = await resolveViewScopeFromSegment(viewing, cycleScope);
  // The [cycleScope] layout above already 404s an unresolvable segment
  // before this page ever renders — this is just satisfying the type.
  if (!scope) redirect("/active/coordination");

  const { communityWide, branchIds, cycleIds } = await listCoordinationScopeIds(viewing);
  const scopeCycleIds = scope.kind === "single" ? [scope.cycle.id] : scope.cycles.map((c) => c.id);
  const isCommunityWide = communityWide || branchIds.size > 0;
  const authorized =
    scope.kind === "single"
      ? isCommunityWide || cycleIds.has(scope.cycle.id)
      : isCommunityWide || scopeCycleIds.some((cid) => cycleIds.has(cid));

  if (!authorized) {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Coordination</h1>
        <div className="mt-4">
          <Banner tone="danger">
            Only a current coordination holder can see this — event-independent coordination covers the
            whole community, while a task placed in an event coordinates that event only. Ask a
            coordinator of this scope.
          </Banner>
        </div>
      </main>
    );
  }

  const { phaseName, questionLabel, entries } = await listCapacitySignal(viewing);
  // stalenessHardDays doubles as the check-in grace period — see
  // community.ts's own comment on why there's no third column for it.
  const { stalenessHardDays } = await getCommunity(viewing);
  const [
    coverage,
    { tasks, counts },
    overdueCheckins,
    suggestions,
    responseQueue,
    engagementPatterns,
  ] = await Promise.all([
    listCoordinationCoverage(viewing),
    listCoordinationScopeTasks(viewing, scopeCycleIds),
    listOverdueCheckins(viewing, scopeCycleIds, stalenessHardDays),
    listPendingSuggestions(viewing, scopeCycleIds),
    listCoordinationResponseQueue(viewing, scopeCycleIds),
    listEngagementPatternsForCoordinator(viewing),
  ]);

  const unowned = needsAnOwner(tasks);
  const flagged = flaggedTasks(tasks);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Coordination"
        description="Everything below is the tasks your coordination covers, in the event you're viewing."
      />

      <ScopeLine coverage={coverage} />

      {/* The headline the page exists for: what state your tasks are in.
          Each figure is a link to the module that acts on it, so the
          count is a door rather than a readout. */}
      <section className="mt-6">
        <h2 className="text-[22px] font-semibold text-[var(--text)]">Tasks in your scope</h2>
        {counts.total === 0 ? (
          <div className="mt-3">
            <Banner tone="success">No tasks in this scope yet.</Banner>
          </div>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Only the two counts that have a section of their own are
                  links. The rest are deliberately not clickable: a chip
                  labelled "Waiting 3" that scrolls to the unanswered
                  check-ins is a different set of tasks entirely, and
                  sending someone to the full list under a label that
                  promises a filtered one is the same mistake quieter.
                  Add a section before adding an anchor. */}
              <CountChip href="#needs-an-owner" label="Needs an owner" value={counts.unclaimed} tone="warning" />
              <CountChip href="#flagged" label="Flagged" value={counts.flagged} tone="danger" />
              <CountChip label="Waiting" value={counts.waiting} tone="neutral" />
              <CountChip label="Claimed" value={counts.claimed} tone="accent" />
              <CountChip label="Done" value={counts.done} tone="success" />
            </div>
            <p className="mt-2 text-[13px] text-[var(--text-muted)]">
              {counts.total} task{counts.total === 1 ? "" : "s"} in total
              {counts.stuck > 0 && `, ${counts.stuck} of them unclaimed and flagged`}.
            </p>
          </>
        )}
      </section>

      {responseQueue.total > 0 && (
        <section className="mt-8" id="waiting-on-you">
          <SectionHeading>Waiting on you</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            {responseQueue.total} thing{responseQueue.total === 1 ? "" : "s"} someone raised or is holding on
            for you in this scope.
          </p>
          <div className="mt-3 flex flex-col gap-4">
            <ResponseGroup title="Anonymous signals" items={responseQueue.signals} />
            <ResponseGroup title="Would like to talk" items={responseQueue.pings} />
            <ResponseGroup title="Declined to join" items={responseQueue.declinedRequests} />
            <ResponseGroup title="Nominations nobody answered" items={responseQueue.expiredNominations} />
          </div>
        </section>
      )}

      {suggestions.length > 0 && (
        <section className="mt-8" id="suggestions">
          <SectionHeading>Someone suggested a person</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            A proposer named someone for these. Open the task to ask them, if it looks right.
          </p>
          <ul className="mt-3">
            {suggestions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
                <Link href={`/tasks/${s.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {s.title}
                </Link>
                <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
                  suggested {s.suggestedMemberName} · {s.branchName}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {unowned.length > 0 && (
        <section className="mt-8" id="needs-an-owner">
          <SectionHeading>Needs an owner</SectionHeading>
          <TaskRows tasks={unowned} />
        </section>
      )}

      {flagged.length > 0 && (
        <section className="mt-8" id="flagged">
          <SectionHeading>Flagged</SectionHeading>
          <TaskRows tasks={flagged} />
        </section>
      )}

      {overdueCheckins.length > 0 && (
        <section className="mt-8" id="checkins">
          <SectionHeading>Check-ins nobody answered</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            A task was parked with a check-in date, and the nudge went out without a reply.
          </p>
          <ul className="mt-3">
            {overdueCheckins.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
                <Link href={`/tasks/${c.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {c.title}
                </Link>
                <span className="shrink-0 text-[12px] text-[var(--text-muted)]">
                  {c.holderName} · due {c.nextCheckinAt?.toLocaleDateString()}
                  {c.waitingNote && ` · ${c.waitingNote}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tasks.length > 0 && (
        <section className="mt-8" id="task-status">
          <SectionHeading>All tasks in your scope</SectionHeading>
          <TaskRows tasks={tasks} />
        </section>
      )}

      {engagementPatterns.length > 0 && (
        <section className="mt-8">
          <SectionHeading>Engagement patterns</SectionHeading>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Members on tasks you coordinate with open non-responses — never an automatic
            consequence, just a real signal worth a human conversation.
          </p>
          <ul className="mt-3">
            {engagementPatterns.map((p) => (
              <li key={p.memberId} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
                <span className="text-[var(--text)]">{p.memberName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[var(--text-muted)]">
                    {p.openCount} open non-response{p.openCount === 1 ? "" : "s"}
                  </span>
                  <Tag tone={PATTERN_TONE[p.level] ?? "neutral"}>{PATTERN_LABEL[p.level] ?? p.level}</Tag>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        <SectionHeading>Availability</SectionHeading>
        {!phaseName && (
          <p className="text-[13px] text-[var(--text-muted)]">
            No current phase to show Availability for — a phase needs an end date in the future (or
            none set) on the most recently started event.
          </p>
        )}
        {phaseName && !questionLabel && (
          <p className="text-[13px] text-[var(--text-muted)]">
            Current phase is &ldquo;{phaseName}&rdquo;, but no Profile question feeds the capacity
            signal for it yet — add one on the settings screen (scope &ldquo;phase&rdquo;, phase name
            &ldquo;{phaseName}&rdquo;, feeds capacity signal on).
          </p>
        )}
        {phaseName && questionLabel && (
          <>
            <p className="text-[13px] text-[var(--text-muted)]">
              &ldquo;{questionLabel}&rdquo; for the current phase (&ldquo;{phaseName}&rdquo;).
            </p>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Member
                  </th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Availability
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.memberId} className="hover:bg-[var(--surface-sunken)]">
                    <td className="border-b border-[var(--border)] px-2 py-2 text-[var(--text)]">{e.memberName}</td>
                    <td className="border-b border-[var(--border)] px-2 py-2">
                      {!e.hasAnswer && <span className="text-[var(--danger)]">no answer</span>}
                      {e.hasAnswer && e.deferred && <span className="text-[var(--warning)]">doesn&rsquo;t know yet</span>}
                      {e.hasAnswer && e.declined && <span className="text-[var(--text-muted)]">declined to say</span>}
                      {e.hasAnswer && !e.deferred && !e.declined && e.capacityVisibility === "open" && (
                        <span className="text-[var(--text)]">
                          {e.declaredHours ?? "—"} hrs/wk declared
                          {e.loadHours !== null ? ` (${e.loadHours} hrs/wk currently held)` : ""}
                        </span>
                      )}
                      {e.hasAnswer && !e.deferred && !e.declined && e.capacityVisibility === "flag_only" && (
                        <span className="text-[var(--text)]">{e.flag ? FLAG_LABEL[e.flag] : "declared, not comparable"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}

// Which authority every number above was computed over. A coordinator's
// coverage can be a branch column, an event row, both, or the whole
// community — and a page of numbers that doesn't say which is the kind of
// thing a coordinator learns to distrust rather than read.
function ScopeLine({ coverage }: { coverage: { communityWide: boolean; branches: { name: string }[]; cycles: { name: string }[] } }) {
  if (coverage.communityWide) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        You coordinate the whole community.
      </p>
    );
  }
  const parts = [
    ...coverage.branches.map((b) => b.name),
    ...coverage.cycles.map((c) => c.name),
  ];
  if (parts.length === 0) {
    return (
      <p className="text-[13px] text-[var(--text-muted)]">
        You coordinate no branches or events right now.
      </p>
    );
  }
  return (
    <p className="text-[13px] text-[var(--text-muted)]">
      You coordinate {parts.join(", ")}.
    </p>
  );
}

function CountChip({
  href,
  label,
  value,
  tone,
}: {
  href?: string;
  label: string;
  value: number;
  tone: Tone;
}) {
  const className = `inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[13px] font-medium ${TONE_TEXT[tone]}`;
  if (!href) {
    return (
      <span className={className}>
        <span className="text-[var(--text-muted)]">{label}</span>
        <span>{value}</span>
      </span>
    );
  }
  return (
    <Link href={href} className={className}>
      <span className="text-[var(--text-muted)]">{label}</span>
      <span>{value}</span>
    </Link>
  );
}

// Reusing Tag's own tone map for the count chips rather than inventing a
// second set of tone classes — the chips are a Tag with a number in it.
const TONE_TEXT: Record<Tone, string> = {
  neutral: "bg-[var(--neutral-100)] text-[var(--text-muted)]",
  accent: "bg-[var(--accent-1-soft)] text-[var(--accent-1)]",
  accent2: "bg-[var(--accent-2-soft)] text-[var(--accent-2)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-border)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger-border)]",
  success: "bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success-border)]",
};

function TaskRows({ tasks }: { tasks: CoordinationScopeTask[] }) {
  return (
    <ul className="mt-3">
      {tasks.map((t) => (
        <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-2.5 last:border-b-0">
          <Link href={`/tasks/${t.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
            {t.title}
          </Link>
          <span className="flex shrink-0 flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <Tag tone={STATUS_TONE[t.status] ?? "neutral"}>{t.status}</Tag>
            {t.attentionLevel !== "ok" && <Tag tone="danger">{t.attentionLevel}</Tag>}
            {t.critical && <Tag tone="danger">critical</Tag>}
            {t.branchName}
            {t.holderNames.length > 0 && ` · ${t.holderNames.join(", ")}`}
            {t.status === "unclaimed" && t.suggestedMemberName && ` · suggested ${t.suggestedMemberName}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ResponseGroup({
  title,
  items,
}: {
  title: string;
  items: { id: string; taskId: string; taskTitle: string; detail: string; who: string | null; createdAt: Date }[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="text-[13px] font-medium text-[var(--text)]">
        {title} <span className="text-[var(--text-muted)]">({items.length})</span>
      </h3>
      <ul className="mt-1">
        {items.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] py-1.5 text-[13px] last:border-b-0">
            <span className="text-[var(--text)]">
              <Link href={`/tasks/${i.taskId}`} className="font-medium hover:text-[var(--accent-1)]">
                {i.taskTitle}
              </Link>
              <span className="text-[var(--text-muted)]">
                {" — "}
                {i.detail}
                {i.who && ` (${i.who})`}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

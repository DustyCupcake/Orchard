import Link from "next/link";
import { getViewerClock } from "@/lib/view-clock";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import {
  canInitiateCycle,
  listCycles,
  resolveViewScopeFromSegment,
} from "@/lib/cycles";
import {
  getCycleParticipationSummary,
  getMyParticipation,
  listOpenEventParticipationCards,
} from "@/lib/participation";
import { isAdmin } from "@/lib/settings";
import { listOutstandingQuestions } from "@/lib/profile-questions";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import type { member as memberTable } from "@/db/schema";
import { closeCycleAction, declareParticipationAction } from "./actions";
import SelectField from "@/components/ui/SelectField";
import ActionMenu from "@/components/ui/ActionMenu";
import PageHeader from "@/components/ui/PageHeader";

type Member = typeof memberTable.$inferSelect;
type Cycle = Awaited<ReturnType<typeof listCycles>>[number];

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  unknown: "Haven't said",
  coming: "Coming",
  maybe: "Maybe",
  not_coming: "Not coming",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// "Who's actually planning to be there, and how much room is left" —
// see docs/spec.md's "Participation & capacity" under Cycle and
// docs/plans/development-plan.md's Phase 31. Core, not gated behind
// Recruitment — a Community with cycles on always has this page,
// whether or not Recruitment ever gets turned on. Moved under
// /[cycleScope]/ in Phase 65 — see ../layout.tsx for how the segment
// resolves, and view-scope.ts's own comment on why this page's
// "active" aggregate is every *open* cycle, not the nav's own
// "coming to" definition (a member needs to see cycles they haven't
// declared on yet in order to declare on them at all).
export default async function ParticipationPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<{
    error?: string;
    declared?: string;
    cycleClosed?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const { error, declared, cycleClosed } = await searchParams;

  const [scope, allCycles, isAdminNow] = await Promise.all([
    resolveViewScopeFromSegment(viewing, cycleScope),
    listCycles(viewing),
    isAdmin(viewing),
  ]);
  // The [cycleScope] layout above already 404s an unresolvable segment
  // before this page ever renders — this is just satisfying the type.
  if (!scope) redirect("/active/participation");

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      {scope.kind === "aggregate" && (
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Events</h1>
      )}

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      {declared && (
        <div className="mt-4">
          <Banner tone="success">Your participation is saved.</Banner>
        </div>
      )}
      {cycleClosed && (
        <div className="mt-4">
          <Banner tone="success">Event closed.</Banner>
        </div>
      )}

      {scope.kind === "aggregate" ? (
        <EventIndex viewing={viewing} allCycles={allCycles} />
      ) : (
        <ParticipationForCycle
          viewing={viewing}
          cycleId={scope.cycle.id}
          cycleName={scope.cycle.name}
          cycleScope={cycleScope}
          closed={Boolean(scope.cycle.closedAt)}
          isAdminNow={isAdminNow}
        />
      )}
    </main>
  );
}

/**
 * The index, for the aggregate scope: one card per event, open ones first,
 * and a card linking into each event's own page.
 *
 * **This replaces rendering `ParticipationForCycle` once per open cycle.**
 * That was the mixing: a community with three open events got three complete
 * configuration blocks stacked on one page — three sets of capacity controls,
 * joining config, lane rules, phase dates and pack export, each with no
 * indication which event it belonged to beyond an `<h2>`. It also meant the
 * per-event page and the index were the same page, so there was nowhere to
 * *go* to configure one event. An event's own settings now live at
 * `/{id}/participation`, which is also where the nav switcher's gear points,
 * so the card and the switcher agree on where an event is configured.
 *
 * **Visible to every member, not just whoever can start an event.** It used
 * to be gated on `canInitiateCycle`, which made this page nearly empty for
 * everyone else — but "what events does this community have, and when are
 * they" is not an administrative question, and a member declaring
 * participation needs to find the event to declare against.
 */
async function EventIndex({ viewing, allCycles }: { viewing: Member; allCycles: Cycle[] }) {
  // The same call /community's event cards use, so the numbers here and
  // there cannot disagree. It only covers open events; closed ones need
  // nothing but a name and dates, which allCycles already has.
  const openCards = await listOpenEventParticipationCards(viewing);
  const closedCycles = allCycles
    .filter((c) => c.closedAt)
    .sort((a, b) => (b.closedAt!.getTime() - a.closedAt!.getTime()));

  if (allCycles.length === 0) {
    return (
      <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
        No events yet. Until one exists there&rsquo;s nothing to declare participation against.
      </p>
    );
  }

  return (
    <section className="mt-6 flex flex-col gap-2">
      {openCards.map((c) => (
        <Link
          key={c.id}
          href={`/${c.id}/participation`}
          className={`${CARD} block transition-colors hover:border-[var(--accent-1)]`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{c.name}</span>
            {c.myStatus !== "unknown" && (
              <Tag tone={c.myStatus === "coming" ? "success" : c.myStatus === "maybe" ? "warning" : undefined}>
                {PARTICIPATION_LABEL[c.myStatus]}
              </Tag>
            )}
          </div>
          <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {dateRange(c.startDate, c.endDate)}
            {c.capacity !== null && (
              <>
                {" · "}
                {c.comingCount} coming
                {c.remainingCapacity !== null && c.remainingCapacity > 0 && ` · ${c.remainingCapacity} place${c.remainingCapacity === 1 ? "" : "s"} left`}
                {c.remainingCapacity !== null && c.remainingCapacity === 0 && " · full"}
              </>
            )}
            {c.capacity === null && c.comingCount > 0 && ` · ${c.comingCount} coming`}
          </p>
        </Link>
      ))}

      {/* Closed events collapse. A community with a long history would
          otherwise open this page onto a wall of dead cards, and the thing
          a reader wants first is what is happening *now* — the count is in
          the summary so the history's size is known before opening it. */}
      {closedCycles.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)] hover:underline">
            {closedCycles.length} past event{closedCycles.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-2 flex flex-col gap-1.5">
            {closedCycles.map((c) => (
              <Link
                key={c.id}
                href={`/${c.id}/participation`}
                className="flex flex-wrap items-baseline gap-x-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-body)] transition-colors hover:border-[var(--accent-1)]"
                style={{ opacity: 0.75 }}
              >
                <span className="font-medium text-[var(--text)]">{c.name}</span>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {dateRange(c.startDate, c.endDate)}
                </span>
              </Link>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function dateRange(start: string | null, end: string | null): string {
  if (start && end) return `${start} – ${end}`;
  if (start) return `from ${start}`;
  if (end) return `until ${end}`;
  return "No dates set yet";
}

const PARTICIPATION_LABEL = {
  coming: "You're coming",
  maybe: "Maybe",
  not_coming: "Not coming",
} as const;

async function ParticipationForCycle({
  viewing,
  cycleId,
  cycleName,
  cycleScope,
  closed,
  isAdminNow,
}: {
  viewing: Member;
  cycleId: string;
  cycleName: string;
  cycleScope: string;
  closed: boolean;
  isAdminNow: boolean;
}) {
  const clock = await getViewerClock();
  const [summary, mine, canConfigure] = await Promise.all([
    getCycleParticipationSummary(viewing, cycleId),
    getMyParticipation(viewing, cycleId),
    canInitiateCycle(viewing),
  ]);
  // The same "questions for this event" the Dashboard's and Community's
  // declare-joining controls route to on submit — linked from here too so
  // the full form's submitter isn't left wondering where to answer them.
  const eventQuestions = (
    await listOutstandingQuestions(viewing, { cycleId })
  ).filter((q) => q.question.scope !== "once_ever");

  // The brief overview, as the page header: capacity, the count of
  // "coming", the remaining seats and the returning window — each says how
  // the event stands right now without opening anything.
  const overviewParts = [
    summary.capacity === null ? "Unlimited capacity" : `Capacity ${summary.capacity}`,
    `${summary.comingCount} coming`,
  ];
  if (summary.remainingCapacity !== null && summary.remainingCapacity !== 0) {
    overviewParts.push(`${summary.remainingCapacity} remaining`);
  }
  if (summary.returningWindowClosesAt) {
    overviewParts.push(
      `Returning-priority window ${summary.returningWindowOpen ? "open" : "closed"} — closes ${clock.deadline(summary.returningWindowClosesAt)}`,
    );
  }

  // Everything this page does that isn't the person's own participation —
  // the event settings, and close for admins. Only the rows the viewer has
  // show; a member with neither lives on the page as its header and plans.
  const actions =
    !closed && (canConfigure || isAdminNow) ? (
      <ActionMenu>
        {canConfigure && <Link href={`/${cycleId}/settings`}>Edit event settings</Link>}
        {isAdminNow && (
          <form action={closeCycleAction}>
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Close this event
            </button>
          </form>
        )}
      </ActionMenu>
    ) : undefined;

  return (
    <>
      <PageHeader title={cycleName} description={overviewParts.join(" · ")} actions={actions} />
      {!closed && (
        <section className="mt-6">
          <SectionHeading>Your plans</SectionHeading>
          {eventQuestions.length > 0 && (
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              Your community also asks{" "}
              {eventQuestions.length === 1 ? "one question" : `${eventQuestions.length} questions`} about this
              event —{" "}
              <Link href={`/questions?cycle=${cycleId}`} className="text-[var(--accent-1)] hover:underline">
                answer {eventQuestions.length === 1 ? "it" : "them"} here
              </Link>
              .
            </p>
          )}
          <form action={declareParticipationAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Status</span>
              <SelectField name="status" defaultValue={mine.status} className={INPUT}>
                {Object.entries(STATUS_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </SelectField>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Arrival date (optional)</span>
              <input type="date" name="arrivalDate" defaultValue={mine.arrivalDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Departure date (optional)</span>
              <input type="date" name="departureDate" defaultValue={mine.departureDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <fieldset className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <legend className="px-1 text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                For the kitchen (all optional)
              </legend>
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                If the kitchen is working out how many are eating each meal, these let it count you in for the right ones on
                the day you arrive and the day you leave. Skip them and it counts you for both days.
              </p>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Arrival time</span>
                <input type="time" name="arrivalTime" defaultValue={mine.arrivalTime?.slice(0, 5) ?? ""} className={`${INPUT} w-fit`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Or: the first meal you&rsquo;ll eat there</span>
                <SelectField name="firstMeal" defaultValue={mine.firstMeal ?? ""} className={INPUT}>
                  <option value="">Not sure</option>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </SelectField>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Departure time</span>
                <input type="time" name="departureTime" defaultValue={mine.departureTime?.slice(0, 5) ?? ""} className={`${INPUT} w-fit`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Or: the last meal you&rsquo;ll eat there</span>
                <SelectField name="lastMeal" defaultValue={mine.lastMeal ?? ""} className={INPUT}>
                  <option value="">Not sure</option>
                  <option value="breakfast">Breakfast</option>
                  <option value="lunch">Lunch</option>
                  <option value="dinner">Dinner</option>
                </SelectField>
              </label>
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                A first or last meal wins over a time if you give both.
              </p>
            </fieldset>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Note (optional)</span>
              <textarea name="note" rows={2} defaultValue={mine.note ?? ""} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
        </section>
      )}
    </>
  );
}


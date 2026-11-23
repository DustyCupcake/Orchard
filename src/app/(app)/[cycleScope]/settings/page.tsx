import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { cycle as cycleTable } from "@/db/schema";
import { getViewerClock } from "@/lib/view-clock";
import TimeZoneInput from "@/components/TimeZoneInput";
import { getViewingContext } from "@/lib/view-as";
import {
  canInitiateCycle,
  endBoundaryOf,
  getCycle,
  getEventTimeZone,
  resolveViewScopeFromSegment,
  startBoundaryOf,
} from "@/lib/cycles";
import { getCycleParticipationSummary } from "@/lib/participation";
import { getBudgetCycleForCycle } from "@/lib/budget";
import { getCommunity, isAdmin } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { listForms } from "@/lib/forms";
import { laneRuleOf, listLanes, listOpenLanes } from "@/lib/recruitment/admission-lanes";
import { describeLaneConsequence } from "@/lib/recruitment/lane-rules";
import { listWaitlisted } from "@/lib/recruitment/admission";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import DateModeField, { type DateFieldBase } from "@/components/DateModeField";
import PageHeader from "@/components/ui/PageHeader";
import { describeBoundaryWindow, formatDateRange, localInputFromInstant } from "@/lib/dates";
import { HIGHLIGHTABLE_MODULES } from "@/lib/nav";
import {
  admitWaitlistedAction,
  addPhaseAction,
  closeCycleAction,
  exportCycleAsTaskPackAction,
  updateCycleSettingsAction,
  updateEventLanesAction,
  updatePhaseBoundaryAction,
  updatePhaseHighlightAction,
} from "../participation/actions";
import SelectField from "@/components/ui/SelectField";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// See the participation page's helper of the same name — the event's clock
// (the venue's), not the viewer's, and it feeds the event settings'
// datetime inputs.
function toDatetimeLocal(date: Date, timeZone: string) {
  return localInputFromInstant(date.toISOString(), timeZone);
}

export default async function EventSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect("/login");
  const { cycleScope } = await params;
  const { error } = await searchParams;

  const scope = await resolveViewScopeFromSegment(viewing, cycleScope);
  if (!scope || scope.kind === "aggregate") redirect(`/${cycleScope}/participation`);
  const cycleId = scope.cycle.id;
  const cycleName = scope.cycle.name;
  const closed = Boolean(scope.cycle.closedAt);

  const [clock, summary, withPhases, communityRow, forms, waitlisted, canConfigure, isAdminNow, eventClock] =
    await Promise.all([
      getViewerClock(),
      getCycleParticipationSummary(viewing, cycleId),
      getCycle(viewing, cycleId),
      getCommunity(viewing),
      listForms(viewing),
      listWaitlisted(cycleId),
      canInitiateCycle(viewing),
      isAdmin(viewing),
      getEventTimeZone(viewing.communityId, cycleId),
    ]);

  const [allLanes, openLaneIds, ownLaneSet] = await Promise.all([
    listLanes(communityRow.id).then((lanes) => lanes.map(laneRuleOf)),
    listOpenLanes(communityRow.id, cycleId).then((lanes) => new Set(lanes.map((l) => l.id))),
    db
      .select({ own: cycleTable.ownAdmissionLanes })
      .from(cycleTable)
      .where(eq(cycleTable.id, cycleId))
      .then((rows) => rows[0].own),
  ]);

  // Admin-only, and only meaningful for a still-open cycle — see
  // closeCycle's own budget-owner warning (src/lib/cycles/lifecycle.ts).
  const budgetCycleRow =
    isAdminNow && !closed && isModuleEnabled(communityRow, "budget")
      ? await getBudgetCycleForCycle(viewing, cycleId)
      : null;
  const needsBudgetDoneWarning = Boolean(budgetCycleRow && !budgetCycleRow.settledAt);

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

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}
      <PageHeader title={cycleName} description={overviewParts.join(" · ")} />

      {canConfigure && waitlisted.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Waiting for a place</h3>
          <p className="mt-1 max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            These people have been approved, but the event is full, so they aren&rsquo;t members yet. They&rsquo;re admitted,
            oldest first, as soon as room appears — someone no longer coming, an invite revoked, the capacity raised. You can also
            admit one now, over the capacity.
          </p>
          <ul className="mt-3 flex max-w-[640px] flex-col gap-2">
            {waitlisted.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <span className="text-[length:var(--text-body)] text-[var(--text)]">
                  {w.name}
                  <span className="ml-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    waiting since {w.waitlistedAt ? clock.date(w.waitlistedAt) : "—"}
                  </span>
                </span>
                <form action={admitWaitlistedAction}>
                  <input type="hidden" name="arrivalId" value={w.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Admit now
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canConfigure && waitlisted.length > 0 && (
        <section className="mt-6">
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Waiting for a place</h3>
          <p className="mt-1 max-w-[640px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            These people have been approved, but the event is full, so they aren&rsquo;t members yet. They&rsquo;re admitted,
            oldest first, as soon as room appears — someone no longer coming, an invite revoked, the capacity raised. You can also
            admit one now, over the capacity.
          </p>
          <ul className="mt-3 flex max-w-[640px] flex-col gap-2">
            {waitlisted.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <span className="text-[length:var(--text-body)] text-[var(--text)]">
                  {w.name}
                  <span className="ml-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    waiting since {w.waitlistedAt ? clock.date(w.waitlistedAt) : "—"}
                  </span>
                </span>
                <form action={admitWaitlistedAction}>
                  <input type="hidden" name="arrivalId" value={w.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Admit now
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
      {canConfigure && !closed && (
        <section className="mt-6">
          <SectionHeading>Event settings</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Visible to you because you can start an event for this Community — the same authority
            configures its capacity, returning-priority window, and joining config (§4.3/8c).
          </p>
          <form action={updateCycleSettingsAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Capacity (optional — blank = unlimited)</span>
              <input type="number" name="capacity" min={1} defaultValue={summary.capacity ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Start date (optional)</span>
              <input type="date" name="startDate" defaultValue={withPhases?.startDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>End date (optional)</span>
              <input type="date" name="endDate" defaultValue={withPhases?.endDate ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Time zone (optional)</span>
              <TimeZoneInput defaultValue={withPhases?.timeZone} placeholder={communityRow.timeZone ?? "UTC"} className={`${INPUT} w-fit`} />
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                What clock this event&apos;s times are read in. Leave blank to use the community&apos;s
                {communityRow.timeZone ? ` (${communityRow.timeZone})` : " default, UTC"}.
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Returning-priority window closes at, {eventClock} (optional)</span>
              <input
                type="datetime-local"
                name="returningWindowClosesAt"
                defaultValue={
                  summary.returningWindowClosesAt ? toDatetimeLocal(new Date(summary.returningWindowClosesAt), eventClock) : ""
                }
                className={`${INPUT} w-fit`}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Application form (optional — blank = community standing form)</span>
              <SelectField
                name="recruitmentApplicationFormId"
                className={`${INPUT} w-fit`}
                defaultValue={withPhases?.recruitmentApplicationFormId ?? ""}
              >
                <option value="">— use the community&apos;s form —</option>
                {forms
                  .filter((f) => !f.archivedAt)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
              </SelectField>
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                The event&rsquo;s joining window runs from the returning-priority close above until the
                deadline below; both doors are shut outside it and once capacity is reached.
              </span>
            </label>
            <CheckField
              label="Applications open"
              name="applicationsOpen"
              defaultChecked={withPhases?.applicationsOpen ?? true}
            />
            <CheckField label="Invites open" name="invitesOpen" defaultChecked={withPhases?.invitesOpen ?? true} />
            {/* §2.3/J3's third door, on the event. Deliberately not a
                lane setting: a lane's `interviewRequired` says "an
                arrival on this lane is interviewed", and this says "no
                interviews happen in this event right now". They are
                independent on purpose — an event can interview its
                invitees with the applications door shut, and can stop
                interviewing without touching anybody's admission rule. */}
            <CheckField
              label="Interviews open"
              name="interviewsOpen"
              defaultChecked={withPhases?.interviewsOpen ?? true}
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Joining window closes at, {eventClock} (optional — blank = until the event closes)</span>
              <input
                type="datetime-local"
                name="joiningWindowClosesAt"
                defaultValue={
                  withPhases?.joiningWindowClosesAt
                    ? toDatetimeLocal(new Date(withPhases.joiningWindowClosesAt), eventClock)
                    : ""
                }
                className={`${INPUT} w-fit`}
              />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save settings
            </button>
          </form>
        </section>
      )}

      {/* Which lanes this event opens (docs/plans/admission-flow.md §2a). Not part of
          the Admin-gated "Event settings" above, because it is not an
          administrative fact about the event: a member arriving by one of
          these lanes is being measured against it, so the lanes are stated to
          everyone and only the controls that change them are restricted. */}
      {!closed && (
        <section className="mt-6">
          <div className="flex max-w-[640px] flex-col gap-3">
            <div>
              <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">How people can join this event</h3>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {ownLaneSet
                  ? "This event has chosen its own lanes. Everything else about a lane is the community's, and its application form is this event's."
                  : "This event opens the same lanes as the community does, and follows the community if it changes them."}
              </p>
            </div>
            {!canConfigure ? (
              <ul className="flex flex-col gap-2">
                {allLanes
                  .filter((l) => l.id && openLaneIds.has(l.id))
                  .map((lane) => (
                    <li key={lane.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                      <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{lane.name}</span>
                      <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">{describeLaneConsequence(lane)}</p>
                    </li>
                  ))}
                {openLaneIds.size === 0 && (
                  <li className="text-[length:var(--text-body)] text-[var(--text-muted)]">No lane is open for this event.</li>
                )}
              </ul>
            ) : (
              <form action={updateEventLanesAction} className="flex flex-col gap-3">
                <input type="hidden" name="cycleId" value={cycleId} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="radio" name="laneMode" value="community" defaultChecked={!ownLaneSet} className="mt-1" />
                  <span>The same lanes as the community</span>
                </label>
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="radio" name="laneMode" value="own" defaultChecked={ownLaneSet} className="mt-1" />
                  <span>Choose which lanes this event opens</span>
                </label>
                <ul className="flex flex-col gap-2 pl-6">
                  {allLanes.map((lane) => (
                    <li key={lane.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                      <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                        <input
                          type="checkbox"
                          name="laneId"
                          value={lane.id}
                          defaultChecked={Boolean(lane.id && openLaneIds.has(lane.id))}
                          className="mt-1"
                        />
                        <span>
                          <strong>{lane.name}</strong>
                          <span className="block text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            {describeLaneConsequence(lane)}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Each kind of invitation has to belong to exactly one of the lanes you open. A different process for
                  just this event is a different lane — add one under Settings → Recruitment, and open it only here.
                </p>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Save this event&rsquo;s lanes
                </button>
              </form>
            )}
          </div>
        </section>
      )}

      {withPhases && !closed && (
        <PhaseDatesSection
          phases={withPhases.phases}
          cycleId={cycleId}
          cycleScope={cycleScope}
          cycleStartDate={withPhases.startDate}
          cycleEndDate={withPhases.endDate}
        />
      )}

      {canConfigure && (
        <section className="mt-6">
          <SectionHeading>Export as a Task Pack</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Save this event&rsquo;s full task set (or a hand-picked subset, from the board&rsquo;s own
            bulk selection) as a named, downloadable pack — see{" "}
            <Link href="/task-packs" className="text-[var(--accent-1)] hover:underline">
              Task Packs
            </Link>{" "}
            to manage what&rsquo;s saved, share one as a file, or import one into a new event.
          </p>
          <form action={exportCycleAsTaskPackAction} className="mt-3 flex max-w-[400px] flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Pack name</span>
              <input type="text" name="name" required defaultValue={cycleName} className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Description (optional)</span>
              <textarea name="description" rows={2} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Export whole event
            </button>
          </form>
        </section>
      )}
      {isAdminNow && !closed && (
        <section className="mt-6 border-t border-[var(--border)] pt-6">
          <SectionHeading>Close this event</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Locks everything about this event — no exception. Reaching a closed event afterward is
            a normal, read-only state, not an error.
          </p>
          {needsBudgetDoneWarning && (
            <div className="mt-3">
              <Banner tone="warning">
                &ldquo;{budgetCycleRow!.title}&rdquo; hasn&rsquo;t been settled yet — settling it closes its books and returns any surplus to the community&rsquo;s budget.
              </Banner>
            </div>
          )}
          <form action={closeCycleAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="cycleId" value={cycleId} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {needsBudgetDoneWarning && <CheckField label="Close anyway" name="overrideBudgetWarning" />}
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Close event
            </button>
          </form>
        </section>
      )}
    </main>
  );
}

type CycleWithPhases = Awaited<ReturnType<typeof getCycle>>;
type PhaseRow = CycleWithPhases["phases"][number];

// See docs/plans/development-plan.md's Phase 39 — a phase spine an existing
// Cycle's own dates resolve against. No rename/reorder here (phases,
// once added, keep whatever name/order they were given) — this is for
// editing an existing phase's dates plus (below) adding a new one.
function PhaseDatesSection({
  phases,
  cycleId,
  cycleScope,
  cycleStartDate,
  cycleEndDate,
}: {
  phases: PhaseRow[];
  cycleId: string;
  cycleScope: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  return (
    <section className="mt-6">
      <SectionHeading>Phase dates</SectionHeading>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        A phase&rsquo;s dates are either set outright or placed against the event&rsquo;s own start and
        end, so moving the event moves them along with it. Each phase says where it sits in words;
        open its edit to change the dates.
      </p>
      {phases.length === 0 && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
      <div className="mt-3 flex flex-col gap-2">
        {phases.map((p) => (
          <PhaseRowCard
            key={p.id}
            p={p}
            cycleScope={cycleScope}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
        ))}
      </div>

      <details className="mt-4 max-w-[500px] rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">Add a phase</summary>
        <form action={addPhaseAction} className="mt-3 flex flex-col gap-2">
          <input type="hidden" name="cycleId" value={cycleId} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Name</span>
            <input type="text" name="name" required className={INPUT} />
          </label>
          <PhaseBoundaryFields
            prefix="start"
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <PhaseBoundaryFields
            prefix="end"
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Add
          </button>
        </form>
      </details>
    </section>
  );
}

/**
 * One phase as two lines of prose plus its edit disclosure.
 *
 * This used to render its whole authoring form inline, so a handful of
 * phases stacked two bordered fieldsets, a button and a select apiece —
 * the form was the thing you saw, and the phase was the thing you had to
 * look for. The recipe is now the summary: `describeBoundaryWindow` says
 * the same relationship the form was editing ("4 days before the event
 * starts") without anyone reading a signed number, and the controls only
 * mount when asked for. That is the `<details>`-for-edit rule the design
 * conventions already set for every other form on the app.
 */
function PhaseRowCard({
  p,
  cycleScope,
  cycleStartDate,
  cycleEndDate,
}: {
  p: PhaseRow;
  cycleScope: string;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  const pinned = HIGHLIGHTABLE_MODULES.find((m) => m.key === p.highlightModuleKey);

  return (
    <div className={`max-w-[500px] ${CARD}`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">{p.name}</h3>
        {pinned && <Tag tone="accent">{pinned.label} pinned</Tag>}
      </div>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {formatDateRange(p.startDate, p.endDate)}
        {" — "}
        {describeBoundaryWindow(startBoundaryOf(p), endBoundaryOf(p))}
      </p>
      {p.flags.orderInvalid && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--danger)]">This phase&rsquo;s end resolves before its own start.</p>
      )}

      <details className="mt-1">
        <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Edit</summary>
        <form action={updatePhaseBoundaryAction} className="mt-2 flex flex-col gap-2">
          <input type="hidden" name="phaseId" value={p.id} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <PhaseBoundaryFields
            prefix="start"
            p={p}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <PhaseBoundaryFields
            prefix="end"
            p={p}
            cycleStartDate={cycleStartDate}
            cycleEndDate={cycleEndDate}
          />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Save dates
          </button>
        </form>
        <form action={updatePhaseHighlightAction} className="mt-3 flex items-end gap-2">
          <input type="hidden" name="phaseId" value={p.id} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <label className="flex flex-col gap-1">
            <span className={LABEL}>Pin a module for everyone coming while this phase is current</span>
            <SelectField name="highlightModuleKey" defaultValue={p.highlightModuleKey ?? ""} className={INPUT}>
              <option value="">None</option>
              {HIGHLIGHTABLE_MODULES.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </SelectField>
          </label>
          <button type="submit" className={BUTTON_SECONDARY}>
            Save
          </button>
        </form>
      </details>
    </div>
  );
}

// `p` is omitted entirely for the "Add a phase" form below (a brand-new
// phase has no existing row to default from) — mirrors how
// tasks/[id]/page.tsx's MilestoneDateFields handles its own optional
// `milestone` prop for the identical add-vs-edit dual use.
function PhaseBoundaryFields({
  prefix,
  p,
  cycleStartDate,
  cycleEndDate,
}: {
  prefix: "start" | "end";
  p?: PhaseRow;
  cycleStartDate: string | null;
  cycleEndDate: string | null;
}) {
  const dateType = prefix === "start" ? p?.startDateType : p?.endDateType;
  const date = prefix === "start" ? p?.startDate : p?.endDate;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const fieldNames: Record<DateFieldBase, string> = {
    mode: `${prefix}${cap("mode")}`,
    date: `${prefix}${cap("date")}`,
    parentType: `${prefix}${cap("parentType")}`,
    phaseId: `${prefix}${cap("phaseId")}`,
  };
  const relativeAllowed = Boolean(cycleStartDate || cycleEndDate);

  return (
    <DateModeField
      legend={prefix === "start" ? "Start" : "End"}
      fieldNames={fieldNames}
      mode={p ? (dateType === "relative" ? "relative" : "absolute") : undefined}
      date={date}
      relativeAllowed={relativeAllowed}
      defaultMode={relativeAllowed ? "relative" : "absolute"}
      relativeHint="Dates inside the event move proportionally; dates outside move by whole days from the nearest edge."
    />
  );
}

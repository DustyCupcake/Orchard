import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  formatEventTime,
  isEventSchedulingOwner,
  listEventProposalsForReview,
  listMyEventProposalPings,
  listMyEventProposals,
  listPublishedSchedule,
} from "@/lib/event-scheduling";
import type { EventSlot } from "@/lib/event-scheduling";
import { effectiveDateDisplayMode, effectiveTimeZone, type PeriodDateContext } from "@/lib/dates";
import { resolveDefaultScopeSegment, resolveSingleCycleScope } from "@/lib/cycles";
import { switchToLinkedScopeAction } from "@/app/(app)/cycles/scope-actions";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { submitEventProposalAction, updateEventProposalAction } from "./actions";
import EventReviewSection from "./EventReviewSection";
import AvailabilityGrid from "./AvailabilityGrid";
import OwnerAvailabilityGrid from "./OwnerAvailabilityGrid";
import { STATUS_LABEL, STATUS_TONE } from "./status";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's "Event scheduling" and docs/development-plan.md's
// Phase 28.
export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    updated?: string;
    confirmed?: string;
    declined?: string;
    pinged?: string;
    published?: string;
    // One-based page of the owner overlay, a week at a time.
    week?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted, updated, confirmed, declined, pinged, published, week } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "event_scheduling");

  // Which cycle's programme to show — the same off-URL resolution the
  // board/task detail page/Spatial planning already read (docs/
  // development-plan.md's Phase 68), replacing the old "no cycle
  // filter at all, every cycle's proposals mixed together" behavior.
  const scopeSegment = await resolveDefaultScopeSegment(viewing);
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, scopeSegment) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Programme</h1>
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Scoped to multiple active events — pick one to see its programme:
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <form key={c.id} action={switchToLinkedScopeAction}>
              <input type="hidden" name="scope" value={c.id} />
              <input type="hidden" name="returnTo" value="/schedule" />
              <button type="submit" className={BUTTON_SECONDARY}>
                {c.name}
              </button>
            </form>
          ))}
        </div>
      </main>
    );
  }
  const cycleId = resolution.kind === "resolved" ? resolution.cycle.id : null;

  const isOwner = moduleOn ? await isEventSchedulingOwner(viewing, cycleId) : false;

  // Every slot on this page reads in the scoped event's own wall-clock,
  // falling back to the Community's — see src/lib/dates/timezone.ts.
  // What a date *looks* like is still per-member: dateDisplayMode is the
  // viewer's own setting, resolved through the Community default, so one
  // person reading "the event, on a Thursday" is a choice they made, not
  // one imposed on them.
  const scopedCycle = resolution.kind === "resolved" ? resolution.cycle : null;
  const timeZone = effectiveTimeZone(scopedCycle, communityRow);
  const dateDisplayMode = effectiveDateDisplayMode(viewing, communityRow);
  const period: PeriodDateContext | null =
    scopedCycle?.startDate && scopedCycle.endDate
      ? { name: scopedCycle.name, startDate: scopedCycle.startDate, endDate: scopedCycle.endDate }
      : null;
  const timeLabel = (s: EventSlot) => formatEventTime(s, dateDisplayMode, timeZone, period);

  // The grid's columns are days, so it needs a date range. An event's own
  // dates are the honest source; without them there is nothing to show,
  // and rather than invent a window we say what to set.
  const gridRange = scopedCycle?.startDate && scopedCycle.endDate
    ? { start: scopedCycle.startDate, end: scopedCycle.endDate }
    : null;

  const [myProposals, publishedSchedule, reviewProposals] = await Promise.all([
    moduleOn ? listMyEventProposals(viewing, cycleId) : Promise.resolve([]),
    moduleOn ? listPublishedSchedule(viewing, cycleId) : Promise.resolve([]),
    moduleOn && isOwner ? listEventProposalsForReview(viewing, cycleId) : Promise.resolve([]),
  ]);

  const myPingsByProposalId = new Map(
    await Promise.all(
      myProposals
        .filter((p) => p.status === "conflict")
        .map(async (p) => [p.id, await listMyEventProposalPings(viewing, p.id)] as const),
    ),
  );

  const memberIds = [...new Set(reviewProposals.map((p) => p.submittedBy))];
  const memberNameById =
    memberIds.length > 0
      ? new Map(
          (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
            (m) => [m.id, m.name] as const,
          ),
        )
      : new Map<string, string>();

  // The scheduling owner's cross-proposal overlay: every proposal's painted
  // availability on one grid, plus whether any stretch of time can hold the
  // whole unplaced programme. This is the question painted availability makes
  // answerable, and it's what the pairwise conflict flag can't tell you.
  const showOwnerOverlay = isOwner && gridRange !== null;

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Programme</h1>

      {!moduleOn && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          {submitted && (
            <div className="mt-4">
              <Banner tone="success">Proposal submitted.</Banner>
            </div>
          )}
          {updated && (
            <div className="mt-4">
              <Banner tone="success">Proposal updated.</Banner>
            </div>
          )}
          {confirmed && (
            <div className="mt-4">
              <Banner tone="success">Slot confirmed.</Banner>
            </div>
          )}
          {declined && (
            <div className="mt-4">
              <Banner tone="success">Proposal declined.</Banner>
            </div>
          )}
          {pinged && (
            <div className="mt-4">
              <Banner tone="success">Host pinged.</Banner>
            </div>
          )}
          {published && (
            <div className="mt-4">
              <Banner tone="success">Programme published.</Banner>
            </div>
          )}

          <section className="mt-6">
            <SectionHeading>Published programme</SectionHeading>
            {publishedSchedule.filter((p) => p.status === "confirmed").length === 0 && (
              <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">Nothing published yet.</p>
            )}
            <div className="mt-3 flex flex-col gap-2">
              {publishedSchedule
                .filter((p) => p.status === "confirmed")
                .map((p) => {
                  const confirmedSlot = p.confirmedSlot as EventSlot | null;
                  return (
                    <div key={p.id} className={CARD}>
                      <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                        {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
                      </p>
                      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                        {confirmedSlot && (
                          <span title={timeLabel(confirmedSlot).exact}>{timeLabel(confirmedSlot).visible}</span>
                        )}
                        {p.spaceNeeds && <> · {p.spaceNeeds}</>}
                      </p>
                      {p.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{p.description}</p>}
                    </div>
                  );
                })}
            </div>
          </section>

          <section className="mt-8">
            <SectionHeading>My proposals</SectionHeading>
            {myProposals.length === 0 && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
            <div className="mt-3 flex flex-col gap-3">
              {myProposals.map((p) => {
                const editable = !p.publishedAt && (p.status === "proposed" || p.status === "conflict");
                const pings = myPingsByProposalId.get(p.id) ?? [];
                const confirmedSlot = p.confirmedSlot as EventSlot | null;
                return (
                  <div key={p.id} className={CARD}>
                    <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Tag>
                    <p className="mt-1.5 text-[length:var(--text-body)] font-medium text-[var(--text)]">
                      {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
                    </p>
                    {p.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{p.description}</p>}
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
                    </p>
                    <p className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      Could do it:
                    </p>
                    <ul className="flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      {(p.preferredSlots as EventSlot[]).map((s, i) => (
                        <li key={i} title={timeLabel(s).exact}>{timeLabel(s).visible}</li>
                      ))}
                    </ul>
                    {confirmedSlot && (
                      <p className="mt-1.5 text-[length:var(--text-body)] text-[var(--text)]">
                        Confirmed: <span title={timeLabel(confirmedSlot).exact}>{timeLabel(confirmedSlot).visible}</span>
                      </p>
                    )}
                    {pings.length > 0 && (
                      <p className="mt-1.5 text-[length:var(--text-body)] text-[var(--warning)]">
                        The scheduling owner has flagged this conflict {pings.length} time(s) — propose a
                        different slot, or reach out to sort it out directly.
                      </p>
                    )}

                    {editable && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Edit</summary>
                        <form action={updateEventProposalAction} className="mt-2 flex max-w-md flex-col gap-2">
                          <input type="hidden" name="proposalId" value={p.id} />
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Host</span>
                            <input type="text" name="host" defaultValue={p.host} required className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Title</span>
                            <input type="text" name="title" defaultValue={p.title} required className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Description</span>
                            <textarea name="description" defaultValue={p.description ?? ""} rows={2} className={INPUT} />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>Space needed (optional)</span>
                            <input type="text" name="spaceNeeds" defaultValue={p.spaceNeeds ?? ""} className={INPUT} />
                          </label>
                          {gridRange ? (
                            <AvailabilityGrid
                              rangeStart={gridRange.start}
                              rangeEnd={gridRange.end}
                              timeZone={timeZone}
                              initialWindows={p.preferredSlots as EventSlot[]}
                              initialDurationMinutes={p.durationMinutes}
                            />
                          ) : (
                            <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                              This event has no dates yet, so there&rsquo;s nothing to paint
                              availability against.
                            </p>
                          )}
                          <button type="submit" disabled={!gridRange} className={`${BUTTON_PRIMARY} w-fit disabled:cursor-not-allowed disabled:opacity-60`}>
                            Save changes
                          </button>
                        </form>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>

            <h3 className="mt-6 text-[length:var(--text-heading)] font-medium text-[var(--text)]">Submit a proposal</h3>
            <form action={submitEventProposalAction} className="mt-2 flex max-w-[500px] flex-col gap-2">
              <input type="hidden" name="cycleId" value={cycleId ?? ""} />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Host</span>
                <input type="text" name="host" required className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Title</span>
                <input type="text" name="title" required className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Description</span>
                <textarea name="description" rows={2} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Space needed (optional)</span>
                <input type="text" name="spaceNeeds" className={INPUT} />
              </label>
              {gridRange ? (
                <AvailabilityGrid
                  rangeStart={gridRange.start}
                  rangeEnd={gridRange.end}
                  timeZone={timeZone}
                  initialWindows={[]}
                  initialDurationMinutes={0}
                />
              ) : (
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  This event has no dates yet, so there&rsquo;s nothing to paint availability
                  against.
                </p>
              )}
              <button type="submit" disabled={!gridRange} className={`${BUTTON_PRIMARY} w-fit disabled:cursor-not-allowed disabled:opacity-60`}>
                Submit proposal
              </button>
            </form>
          </section>

          {showOwnerOverlay && gridRange && (
            <section className="mt-8">
              <SectionHeading>Availability across the programme</SectionHeading>
              <div className="mt-3">
                <OwnerAvailabilityGrid
                  proposals={reviewProposals}
                  memberNameById={memberNameById}
                  rangeStart={gridRange.start}
                  rangeEnd={gridRange.end}
                  timeZone={timeZone}
                  timeLabel={timeLabel}
                  week={Math.max(0, (Number.parseInt(week ?? "1", 10) || 1) - 1)}
                />
              </div>
            </section>
          )}

          {isOwner && (
            <EventReviewSection
              proposals={reviewProposals}
              memberNameById={memberNameById}
              cycleId={cycleId}
              dateDisplayMode={dateDisplayMode}
              timeZone={timeZone}
              period={period}
            />
          )}
        </>
      )}
    </main>
  );
}

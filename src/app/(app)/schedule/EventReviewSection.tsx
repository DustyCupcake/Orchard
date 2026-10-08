import type { eventProposal as eventProposalTable } from "@/db/schema";
import {
  candidatePlacements,
  formatEventTime,
  windowMinutes,
  type EventSlot,
} from "@/lib/event-scheduling";
import { localInputFromInstant, type DateDisplayMode, type PeriodDateContext } from "@/lib/dates";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, Tag } from "@/components/ui/kit";
import { STATUS_LABEL, STATUS_TONE } from "./status";
import {
  confirmEventProposalAction,
  declineEventProposalAction,
  pingConflictHostAction,
  publishEventScheduleAction,
} from "./actions";

type EventProposalRow = typeof eventProposalTable.$inferSelect;

// Confirming a placement used to prefill two bare datetime-local inputs
// from toLocaleDateString()-style local time, which meant the owner saw
// the proposer's window shifted into the *server's* zone — a different
// read from the window list right above it. Both are seeded in the event's
// own zone now, and the first candidate placement is the default rather
// than a fixed start, because with painted availability there is no longer
// a single start to default to.
//
// The free-text pair stays for the case the spec explicitly allows: a
// compromise slot neither host painted ("compromise, swap, or combine").
function toDatetimeLocal(iso: string, timeZone: string) {
  return localInputFromInstant(iso, timeZone);
}

// The scheduling-owner's review view — see docs/spec.md's "Event
// scheduling" ("the task owner reviews proposals and flags slot
// conflicts") and docs/development-plan.md's Phase 28. Rendered by
// page.tsx only for the current owner-task holder; proposals here have
// already had recomputeEventConflicts run fresh against them (see
// listEventProposalsForReview).
export default function EventReviewSection({
  proposals,
  memberNameById,
  cycleId,
  dateDisplayMode,
  timeZone,
  period,
}: {
  proposals: EventProposalRow[];
  memberNameById: Map<string, string>;
  // The resolved single-cycle scope this review batch is for (docs/
  // development-plan.md's Phase 68) — publishEventScheduleAction needs
  // it explicitly since publishing is a batch operation with no single
  // proposal row of its own to derive a cycle from, unlike confirm/
  // decline/ping, which resolve ownership from the proposal they act on.
  cycleId: string | null;
  // The same two settings page.tsx reads, passed down so the review list
  // and the proposer's own list can't disagree about what a slot reads
  // as — see src/lib/dates/timezone.ts and event-scheduling/slots.ts.
  dateDisplayMode: DateDisplayMode;
  timeZone: string;
  period: PeriodDateContext | null;
}) {
  const timeLabel = (s: EventSlot) => formatEventTime(s, dateDisplayMode, timeZone, period);
  const unresolved = proposals.filter(
    (p) => !p.publishedAt && (p.status === "proposed" || p.status === "conflict"),
  );

  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Review (scheduling owner)</h2>
      {proposals.length === 0 && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">No proposals yet.</p>}
      <div className="mt-3 flex flex-col gap-3">
        {proposals.map((p) => {
          const canAct = !p.publishedAt && p.status !== "declined";
          const confirmedSlot = p.confirmedSlot as EventSlot | null;
          const preferredSlots = p.preferredSlots as EventSlot[];
          // What the owner is actually choosing between. Derived here
          // rather than stored, so it stays right when a host repaints
          // their availability or changes the session length.
          const placementOptions = candidatePlacements(preferredSlots, p.durationMinutes);
          // Total painted time, so the owner can see at a glance whether a
          // host offered a generous window or the bare minimum.
          const paintedMinutes = preferredSlots.reduce((sum, s) => sum + windowMinutes(s), 0);
          return (
            <div key={p.id} className={CARD}>
              <div className="flex items-center gap-2">
                <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Tag>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {memberNameById.get(p.submittedBy) ?? "—"}
                  {p.publishedAt && " · published"}
                </span>
              </div>
              <p className="mt-1.5 text-[length:var(--text-body)] font-medium text-[var(--text)]">
                {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
              </p>
              {p.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{p.description}</p>}
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
              </p>
              <p className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                Could do it{paintedMinutes > 0 ? ` — ${paintedMinutes} min across ${preferredSlots.length} window${preferredSlots.length === 1 ? "" : "s"}` : ""}:
              </p>
              <ul className="flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {preferredSlots.map((s, i) => (
                  <li key={i} title={timeLabel(s).exact}>{timeLabel(s).visible}</li>
                ))}
              </ul>
              {!confirmedSlot && placementOptions.length > 0 && (
                <p className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {placementOptions.length} way{placementOptions.length === 1 ? "" : "s"} to start a{" "}
                  {p.durationMinutes}-minute session in there — confirm the one that fits everything
                  else.
                </p>
              )}
              {confirmedSlot && (
                <p className="mt-1.5 text-[length:var(--text-body)] text-[var(--text)]">
                  Confirmed:{" "}
                  <span title={timeLabel(confirmedSlot).exact}>{timeLabel(confirmedSlot).visible}</span>
                </p>
              )}

              {canAct && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <form action={confirmEventProposalAction} className="flex flex-wrap items-center gap-1.5">
                    <input type="hidden" name="proposalId" value={p.id} />
                    <input
                      type="datetime-local"
                      name="startsAt"
                      defaultValue={
                        confirmedSlot
                          ? toDatetimeLocal(confirmedSlot.startsAt, timeZone)
                          : placementOptions[0]
                            ? toDatetimeLocal(placementOptions[0].startsAt, timeZone)
                            : preferredSlots[0]
                              ? toDatetimeLocal(preferredSlots[0].startsAt, timeZone)
                              : undefined
                      }
                      required
                      className={INPUT}
                    />
                    <input
                      type="datetime-local"
                      name="endsAt"
                      defaultValue={
                        confirmedSlot
                          ? toDatetimeLocal(confirmedSlot.endsAt, timeZone)
                          : placementOptions[0]
                            ? toDatetimeLocal(placementOptions[0].endsAt, timeZone)
                            : preferredSlots[0]
                              ? toDatetimeLocal(preferredSlots[0].endsAt, timeZone)
                              : undefined
                      }
                      required
                      className={INPUT}
                    />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      {placementOptions.length > 0 ? "Confirm this slot" : "Confirm slot"}
                    </button>
                  </form>

                  <form action={declineEventProposalAction}>
                    <input type="hidden" name="proposalId" value={p.id} />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Decline
                    </button>
                  </form>

                  {p.status === "conflict" && (
                    <form action={pingConflictHostAction}>
                      <input type="hidden" name="proposalId" value={p.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Ping host
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form action={publishEventScheduleAction} className="mt-4">
        <input type="hidden" name="cycleId" value={cycleId ?? ""} />
        <button type="submit" className={BUTTON_PRIMARY}>
          Publish programme
        </button>
        {unresolved.length > 0 && (
          <p className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {unresolved.length} proposal(s) still need a confirmed slot or a decline first.
          </p>
        )}
      </form>
    </section>
  );
}

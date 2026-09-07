import type { eventProposal as eventProposalTable } from "@/db/schema";
import type { EventSlot } from "@/lib/event-scheduling";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, Tag } from "@/components/ui/kit";
import { STATUS_LABEL, STATUS_TONE } from "./status";
import {
  confirmEventProposalAction,
  declineEventProposalAction,
  pingConflictHostAction,
  publishEventScheduleAction,
} from "./actions";

type EventProposalRow = typeof eventProposalTable.$inferSelect;

function formatSlot(s: EventSlot) {
  return `${new Date(s.startsAt).toLocaleString()} – ${new Date(s.endsAt).toLocaleTimeString()}`;
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not a full
// ISO string with a timezone offset — trim to what the input accepts.
function toDatetimeLocal(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
}: {
  proposals: EventProposalRow[];
  memberNameById: Map<string, string>;
  // The resolved single-cycle scope this review batch is for (docs/
  // development-plan.md's Phase 68) — publishEventScheduleAction needs
  // it explicitly since publishing is a batch operation with no single
  // proposal row of its own to derive a cycle from, unlike confirm/
  // decline/ping, which resolve ownership from the proposal they act on.
  cycleId: string | null;
}) {
  const unresolved = proposals.filter(
    (p) => !p.publishedAt && (p.status === "proposed" || p.status === "conflict"),
  );

  return (
    <section className="mt-8 border-t border-[var(--border)] pt-6">
      <h2 className="text-[22px] font-semibold text-[var(--text)]">Review (scheduling owner)</h2>
      {proposals.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No proposals yet.</p>}
      <div className="mt-3 flex flex-col gap-3">
        {proposals.map((p) => {
          const canAct = !p.publishedAt && p.status !== "declined";
          const confirmedSlot = p.confirmedSlot as EventSlot | null;
          const preferredSlots = p.preferredSlots as EventSlot[];
          return (
            <div key={p.id} className={CARD}>
              <div className="flex items-center gap-2">
                <Tag tone={STATUS_TONE[p.status]}>{STATUS_LABEL[p.status] ?? p.status}</Tag>
                <span className="text-[12px] text-[var(--text-muted)]">
                  {memberNameById.get(p.submittedBy) ?? "—"}
                  {p.publishedAt && " · published"}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] font-medium text-[var(--text)]">
                {p.title} <span className="font-normal text-[var(--text-muted)]">— hosted by {p.host}</span>
              </p>
              {p.description && <p className="mt-1 text-[13px] text-[var(--text)]">{p.description}</p>}
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
              </p>
              <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text-muted)]">
                {preferredSlots.map((s, i) => (
                  <li key={i}>{formatSlot(s)}</li>
                ))}
              </ul>
              {confirmedSlot && (
                <p className="mt-1.5 text-[13px] text-[var(--text)]">Confirmed: {formatSlot(confirmedSlot)}</p>
              )}

              {canAct && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <form action={confirmEventProposalAction} className="flex items-center gap-1.5">
                    <input type="hidden" name="proposalId" value={p.id} />
                    <input
                      type="datetime-local"
                      name="startsAt"
                      defaultValue={
                        confirmedSlot
                          ? toDatetimeLocal(confirmedSlot.startsAt)
                          : preferredSlots[0]
                            ? toDatetimeLocal(preferredSlots[0].startsAt)
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
                          ? toDatetimeLocal(confirmedSlot.endsAt)
                          : preferredSlots[0]
                            ? toDatetimeLocal(preferredSlots[0].endsAt)
                            : undefined
                      }
                      required
                      className={INPUT}
                    />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Confirm slot
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
          Publish schedule
        </button>
        {unresolved.length > 0 && (
          <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
            {unresolved.length} proposal(s) still need a confirmed slot or a decline first.
          </p>
        )}
      </form>
    </section>
  );
}

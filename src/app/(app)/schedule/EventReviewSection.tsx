import type { eventProposal as eventProposalTable } from "@/db/schema";
import type { EventSlot } from "@/lib/event-scheduling";
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

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  conflict: "Conflict",
  confirmed: "Confirmed",
  declined: "Declined",
};

// The scheduling-owner's review view — see docs/spec.md's "Event
// scheduling" ("the task owner reviews proposals and flags slot
// conflicts") and docs/development-plan.md's Phase 28. Rendered by
// page.tsx only for the current owner-task holder; proposals here have
// already had recomputeEventConflicts run fresh against them (see
// listEventProposalsForReview).
export default function EventReviewSection({
  proposals,
  memberNameById,
}: {
  proposals: EventProposalRow[];
  memberNameById: Map<string, string>;
}) {
  const unresolved = proposals.filter(
    (p) => !p.publishedAt && (p.status === "proposed" || p.status === "conflict"),
  );

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #ccc", paddingTop: "1rem" }}>
      <h2>Review (scheduling owner)</h2>
      {proposals.length === 0 && <p style={{ color: "#666" }}>No proposals yet.</p>}
      {proposals.map((p) => {
        const canAct = !p.publishedAt && p.status !== "declined";
        const confirmedSlot = p.confirmedSlot as EventSlot | null;
        const preferredSlots = p.preferredSlots as EventSlot[];
        return (
          <div
            key={p.id}
            style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.6rem" }}
          >
            <p style={{ margin: 0, fontSize: "0.8rem", color: "#666" }}>
              {STATUS_LABEL[p.status] ?? p.status} · {memberNameById.get(p.submittedBy) ?? "—"}
              {p.publishedAt && " · published"}
            </p>
            <strong>{p.title}</strong> — hosted by {p.host}
            {p.description && <p style={{ margin: "0.2rem 0" }}>{p.description}</p>}
            <p style={{ margin: "0.2rem 0", fontSize: "0.85rem", color: "#666" }}>
              {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
            </p>
            <ul style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
              {preferredSlots.map((s, i) => (
                <li key={i}>{formatSlot(s)}</li>
              ))}
            </ul>
            {confirmedSlot && (
              <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
                Confirmed: {formatSlot(confirmedSlot)}
              </p>
            )}

            {canAct && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.5rem" }}>
                <form
                  action={confirmEventProposalAction}
                  style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}
                >
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
                    style={{ padding: "0.3rem" }}
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
                    style={{ padding: "0.3rem" }}
                  />
                  <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                    Confirm slot
                  </button>
                </form>

                <form action={declineEventProposalAction}>
                  <input type="hidden" name="proposalId" value={p.id} />
                  <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                    Decline
                  </button>
                </form>

                {p.status === "conflict" && (
                  <form action={pingConflictHostAction}>
                    <input type="hidden" name="proposalId" value={p.id} />
                    <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                      Ping host
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>
        );
      })}

      <form action={publishEventScheduleAction} style={{ marginTop: "1rem" }}>
        <button type="submit" style={{ padding: "0.4rem 1rem" }}>
          Publish schedule
        </button>
        {unresolved.length > 0 && (
          <p style={{ fontSize: "0.8rem", color: "#666", marginTop: "0.3rem" }}>
            {unresolved.length} proposal(s) still need a confirmed slot or a decline first.
          </p>
        )}
      </form>
    </section>
  );
}

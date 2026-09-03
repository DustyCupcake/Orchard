import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  isEventSchedulingOwner,
  listEventProposalsForReview,
  listMyEventProposalPings,
  listMyEventProposals,
  listPublishedSchedule,
} from "@/lib/event-scheduling";
import type { EventSlot } from "@/lib/event-scheduling";
import { submitEventProposalAction, updateEventProposalAction } from "./actions";
import EventReviewSection from "./EventReviewSection";

export const dynamic = "force-dynamic";

function formatSlot(s: EventSlot) {
  return `${new Date(s.startsAt).toLocaleString()} – ${new Date(s.endsAt).toLocaleTimeString()}`;
}

function formatSlotsRaw(slots: EventSlot[]) {
  return slots.map((s) => `${s.startsAt}|${s.endsAt}`).join("\n");
}

const STATUS_LABEL: Record<string, string> = {
  proposed: "Proposed",
  conflict: "Conflict — needs a different slot or the owner's mediation",
  confirmed: "Confirmed",
  declined: "Declined",
};

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
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, submitted, updated, confirmed, declined, pinged, published } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "event_scheduling");

  const isOwner = moduleOn ? await isEventSchedulingOwner(viewing) : false;

  const [myProposals, publishedSchedule, reviewProposals] = await Promise.all([
    moduleOn ? listMyEventProposals(viewing) : Promise.resolve([]),
    moduleOn ? listPublishedSchedule(viewing) : Promise.resolve([]),
    moduleOn && isOwner ? listEventProposalsForReview(viewing) : Promise.resolve([]),
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

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 760 }}>
      <h1>Schedule</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {submitted && <p style={{ color: "#2a7a2a" }}>Proposal submitted.</p>}
          {updated && <p style={{ color: "#2a7a2a" }}>Proposal updated.</p>}
          {confirmed && <p style={{ color: "#2a7a2a" }}>Slot confirmed.</p>}
          {declined && <p style={{ color: "#2a7a2a" }}>Proposal declined.</p>}
          {pinged && <p style={{ color: "#2a7a2a" }}>Host pinged.</p>}
          {published && <p style={{ color: "#2a7a2a" }}>Schedule published.</p>}

          <section style={{ marginTop: "1rem" }}>
            <h2>Published schedule</h2>
            {publishedSchedule.filter((p) => p.status === "confirmed").length === 0 && (
              <p style={{ color: "#666" }}>Nothing published yet.</p>
            )}
            {publishedSchedule
              .filter((p) => p.status === "confirmed")
              .map((p) => {
                const confirmedSlot = p.confirmedSlot as EventSlot | null;
                return (
                  <div
                    key={p.id}
                    style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                  >
                    <strong>{p.title}</strong> — hosted by {p.host}
                    <p style={{ margin: "0.2rem 0", color: "#666", fontSize: "0.85rem" }}>
                      {confirmedSlot && formatSlot(confirmedSlot)}
                      {p.spaceNeeds && <> · {p.spaceNeeds}</>}
                    </p>
                    {p.description && <p style={{ margin: "0.2rem 0" }}>{p.description}</p>}
                  </div>
                );
              })}
          </section>

          <section style={{ marginTop: "2rem" }}>
            <h2>My proposals</h2>
            {myProposals.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
            {myProposals.map((p) => {
              const editable = !p.publishedAt && (p.status === "proposed" || p.status === "conflict");
              const pings = myPingsByProposalId.get(p.id) ?? [];
              const confirmedSlot = p.confirmedSlot as EventSlot | null;
              return (
                <div
                  key={p.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.6rem" }}
                >
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "#666" }}>
                    {STATUS_LABEL[p.status] ?? p.status}
                  </p>
                  <strong>{p.title}</strong> — hosted by {p.host}
                  {p.description && <p style={{ margin: "0.2rem 0" }}>{p.description}</p>}
                  <p style={{ margin: "0.2rem 0", fontSize: "0.85rem", color: "#666" }}>
                    {p.durationMinutes} min{p.spaceNeeds && <> · {p.spaceNeeds}</>}
                  </p>
                  <ul style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
                    {(p.preferredSlots as EventSlot[]).map((s, i) => (
                      <li key={i}>{formatSlot(s)}</li>
                    ))}
                  </ul>
                  {confirmedSlot && (
                    <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
                      Confirmed: {formatSlot(confirmedSlot)}
                    </p>
                  )}
                  {pings.length > 0 && (
                    <p style={{ margin: "0.3rem 0 0", color: "#a15c00", fontSize: "0.85rem" }}>
                      The scheduling owner has flagged this conflict {pings.length} time(s) — propose a
                      different slot, or reach out to sort it out directly.
                    </p>
                  )}

                  {editable && (
                    <details style={{ marginTop: "0.5rem" }}>
                      <summary style={{ cursor: "pointer", fontSize: "0.85rem" }}>Edit</summary>
                      <form
                        action={updateEventProposalAction}
                        style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}
                      >
                        <input type="hidden" name="proposalId" value={p.id} />
                        <input type="text" name="host" defaultValue={p.host} required style={{ padding: "0.4rem" }} />
                        <input
                          type="text"
                          name="title"
                          defaultValue={p.title}
                          required
                          style={{ padding: "0.4rem" }}
                        />
                        <textarea
                          name="description"
                          defaultValue={p.description ?? ""}
                          rows={2}
                          style={{ padding: "0.4rem" }}
                        />
                        <input
                          type="number"
                          name="durationMinutes"
                          defaultValue={p.durationMinutes}
                          min={1}
                          required
                          style={{ padding: "0.4rem" }}
                        />
                        <input
                          type="text"
                          name="spaceNeeds"
                          defaultValue={p.spaceNeeds ?? ""}
                          placeholder="space needed (optional)"
                          style={{ padding: "0.4rem" }}
                        />
                        <textarea
                          name="preferredSlotsRaw"
                          defaultValue={formatSlotsRaw(p.preferredSlots as EventSlot[])}
                          rows={3}
                          placeholder="startsAt|endsAt, one per line"
                          style={{ padding: "0.4rem", fontFamily: "monospace" }}
                        />
                        <button type="submit" style={{ padding: "0.3rem 0.8rem", width: "fit-content" }}>
                          Save changes
                        </button>
                      </form>
                    </details>
                  )}
                </div>
              );
            })}

            <h3>Submit a proposal</h3>
            <form
              action={submitEventProposalAction}
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
            >
              <label>
                Host
                <br />
                <input type="text" name="host" required style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Title
                <br />
                <input type="text" name="title" required style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Description
                <br />
                <textarea name="description" rows={2} style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Duration (minutes)
                <br />
                <input
                  type="number"
                  name="durationMinutes"
                  min={1}
                  required
                  style={{ padding: "0.4rem" }}
                />
              </label>
              <label>
                Space needed (optional)
                <br />
                <input type="text" name="spaceNeeds" style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                Preferred slots — one per line, <code>startsAt|endsAt</code>
                <br />
                <textarea
                  name="preferredSlotsRaw"
                  rows={4}
                  required
                  placeholder={"2026-09-10T14:00|2026-09-10T15:30\n2026-09-11T09:00|2026-09-11T10:30"}
                  style={{ padding: "0.4rem", width: "100%", fontFamily: "monospace" }}
                />
              </label>
              <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                Submit proposal
              </button>
            </form>
          </section>

          {isOwner && (
            <EventReviewSection proposals={reviewProposals} memberNameById={memberNameById} />
          )}
        </>
      )}
    </main>
  );
}

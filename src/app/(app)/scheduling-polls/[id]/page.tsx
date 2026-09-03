import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import {
  getConfirmedAttendees,
  getMyAvailability,
  getPoll,
  getPollAggregate,
  getSummary,
  listAgendaItems,
  listAttendance,
  listSummaryReads,
} from "@/lib/scheduling-polls";
import AvailabilityGrid from "../AvailabilityGrid";
import {
  addAgendaItemAction,
  confirmSlotAction,
  markSummaryReadAction,
  publishSummaryAction,
  recordAttendanceAction,
  saveSummaryAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SchedulingPollDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing, viewAs } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;
  const poll = await getPoll(viewing, id);
  const isOrganizer = poll.organizedBy === viewing.id;
  const isConfirmed = Boolean(poll.confirmedSlotStart);

  const [branchRow, myAvailability, aggregate, agendaItems, summary, confirmedAttendees, communityMembers] =
    await Promise.all([
      db.select().from(branch).where(eq(branch.id, poll.branchId)).then((r) => r[0]),
      isConfirmed ? Promise.resolve([]) : getMyAvailability(viewing, id),
      isConfirmed ? Promise.resolve({ slots: [], submittedCount: 0 }) : getPollAggregate(viewing, id),
      poll.hasAgenda ? listAgendaItems(viewing, id) : Promise.resolve([]),
      poll.needsSummary ? getSummary(viewing, id) : Promise.resolve(null),
      isConfirmed ? getConfirmedAttendees(viewing, id) : Promise.resolve([]),
      db.select().from(member).where(eq(member.communityId, viewing.communityId)),
    ]);

  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));
  const summaryReads = summary && poll.requireRead ? await listSummaryReads(viewing, summary.id) : [];
  const iReadSummary = summaryReads.some((r) => r.memberId === viewing.id);
  const attendance = isConfirmed ? await listAttendance(viewing, id) : [];
  const attendanceByMember = new Map(attendance.map((a) => [a.memberId, a.attended]));

  const qualifyingSlots = aggregate.slots.filter((s) => s.qualifies);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 700 }}>
      <h1>{poll.title}</h1>
      <p style={{ color: "#666" }}>
        {branchRow?.name} · organized by {memberNameById.get(poll.organizedBy) ?? "—"} ·{" "}
        {poll.resolutionMode === "must_overlap"
          ? `must overlap: ${poll.requiredParticipantIds.map((id) => memberNameById.get(id) ?? "—").join(", ")}`
          : `needs ${poll.minAttendance ?? 1}+ people`}
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {isConfirmed ? (
        <section style={{ marginTop: "1rem" }}>
          <h2>Confirmed</h2>
          <p>
            {new Date(poll.confirmedSlotStart!).toLocaleString()} –{" "}
            {new Date(poll.confirmedSlotEnd!).toLocaleTimeString()}
          </p>
          <p>
            <a href={`/api/scheduling-polls/${poll.id}/invite`} style={{ color: "inherit" }}>
              Download calendar invite (.ics) →
            </a>
          </p>
          <p style={{ fontSize: "0.85rem", color: "#666" }}>
            Confirmed as available: {confirmedAttendees.map((m) => m.name).join(", ") || "—"}
          </p>

          <h3 style={{ marginTop: "1rem" }}>Attendance</h3>
          {confirmedAttendees.length === 0 && <p style={{ color: "#666" }}>Nobody to mark yet.</p>}
          {confirmedAttendees.map((m) => (
            <div key={m.id} style={{ marginBottom: "0.3rem", fontSize: "0.9rem" }}>
              {m.name}{" "}
              {attendanceByMember.has(m.id) ? (
                <span>({attendanceByMember.get(m.id) ? "attended" : "did not attend"})</span>
              ) : (
                <>
                  <form action={recordAttendanceAction} style={{ display: "inline" }}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <input type="hidden" name="attended" value="true" />
                    <button type="submit">Attended</button>
                  </form>{" "}
                  <form action={recordAttendanceAction} style={{ display: "inline" }}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <input type="hidden" name="attended" value="false" />
                    <button type="submit">Didn&rsquo;t attend</button>
                  </form>
                </>
              )}
            </div>
          ))}
        </section>
      ) : (
        <>
          <section style={{ marginTop: "1rem" }}>
            <h2>Your availability</h2>
            <AvailabilityGrid
              pollId={poll.id}
              rangeStart={poll.rangeStart}
              rangeEnd={poll.rangeEnd}
              initialSelected={myAvailability}
              readOnly={Boolean(viewAs)}
            />
          </section>

          <section style={{ marginTop: "1.5rem" }}>
            <h2>Aggregate</h2>
            <p style={{ fontSize: "0.85rem", color: "#666" }}>
              {aggregate.submittedCount} member(s) have submitted. Only the overlap shows — never who
              submitted what.
            </p>
            {qualifyingSlots.length === 0 && <p style={{ color: "#666" }}>No slot qualifies yet.</p>}
            {qualifyingSlots.map((s) => (
              <div key={s.slot} style={{ marginBottom: "0.3rem", fontSize: "0.9rem" }}>
                {new Date(s.slot).toLocaleString()} — {s.count} available
                {isOrganizer && (
                  <form action={confirmSlotAction} style={{ display: "inline", marginLeft: "0.5rem" }}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="slot" value={s.slot} />
                    <button type="submit">Confirm this slot</button>
                  </form>
                )}
              </div>
            ))}
          </section>
        </>
      )}

      {poll.hasAgenda && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Agenda</h2>
          {agendaItems.length === 0 && <p style={{ color: "#666" }}>Nothing on the agenda yet.</p>}
          <ul>
            {agendaItems.map((i) => (
              <li key={i.id}>{i.text}</li>
            ))}
          </ul>
          <form action={addAgendaItemAction} style={{ display: "flex", gap: "0.5rem" }}>
            <input type="hidden" name="pollId" value={poll.id} />
            <input type="text" name="text" required placeholder="Add an agenda item" style={{ padding: "0.4rem", flex: 1 }} />
            <button type="submit">Add</button>
          </form>
        </section>
      )}

      {poll.needsSummary && (
        <section style={{ marginTop: "1.5rem" }}>
          <h2>Summary</h2>
          {summary?.publishedAt ? (
            <>
              <p style={{ whiteSpace: "pre-wrap" }}>{summary.body}</p>
              <p style={{ fontSize: "0.8rem", color: "#666" }}>
                Published {new Date(summary.publishedAt).toLocaleString()}
                {poll.requireRead && ` · read by ${summaryReads.length} member(s)`}
              </p>
              {poll.requireRead && !iReadSummary && (
                <form action={markSummaryReadAction}>
                  <input type="hidden" name="pollId" value={poll.id} />
                  <input type="hidden" name="summaryId" value={summary.id} />
                  <button type="submit">Mark as read</button>
                </form>
              )}
            </>
          ) : (
            <>
              <form action={saveSummaryAction} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <input type="hidden" name="pollId" value={poll.id} />
                <textarea name="body" rows={4} defaultValue={summary?.body ?? ""} style={{ padding: "0.5rem" }} />
                <button type="submit" style={{ width: "fit-content", padding: "0.4rem 0.8rem" }}>
                  Save draft
                </button>
              </form>
              {summary && (
                <form action={publishSummaryAction} style={{ marginTop: "0.5rem" }}>
                  <input type="hidden" name="pollId" value={poll.id} />
                  <button type="submit">Publish</button>
                </form>
              )}
            </>
          )}
        </section>
      )}
    </main>
  );
}

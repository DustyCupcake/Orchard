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
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT } from "@/components/ui/kit";
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

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

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
    <main className="mx-auto max-w-[700px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{poll.title}</h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        {branchRow?.name} · organized by {memberNameById.get(poll.organizedBy) ?? "—"} ·{" "}
        {poll.resolutionMode === "must_overlap"
          ? `must overlap: ${poll.requiredParticipantIds.map((id) => memberNameById.get(id) ?? "—").join(", ")}`
          : `needs ${poll.minAttendance ?? 1}+ people`}
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {isConfirmed ? (
        <section className="mt-6">
          <SectionHeading>Confirmed</SectionHeading>
          <p className="mt-2 text-[14px] text-[var(--text)]">
            {new Date(poll.confirmedSlotStart!).toLocaleString()} –{" "}
            {new Date(poll.confirmedSlotEnd!).toLocaleTimeString()}
          </p>
          <p className="mt-1 text-[13px]">
            <a href={`/api/scheduling-polls/${poll.id}/invite`} className="text-[var(--accent-1)] hover:underline">
              Download calendar invite (.ics) →
            </a>
          </p>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
            Confirmed as available: {confirmedAttendees.map((m) => m.name).join(", ") || "—"}
          </p>

          <h3 className="mt-4 text-[15px] font-medium text-[var(--text)]">Attendance</h3>
          {confirmedAttendees.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nobody to mark yet.</p>}
          {confirmedAttendees.map((m) => (
            <div key={m.id} className="mt-2 flex items-center gap-2 text-[13px] text-[var(--text)]">
              {m.name}
              {attendanceByMember.has(m.id) ? (
                <span className="text-[var(--text-muted)]">
                  ({attendanceByMember.get(m.id) ? "attended" : "did not attend"})
                </span>
              ) : (
                <>
                  <form action={recordAttendanceAction}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <input type="hidden" name="attended" value="true" />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Attended
                    </button>
                  </form>
                  <form action={recordAttendanceAction}>
                    <input type="hidden" name="pollId" value={poll.id} />
                    <input type="hidden" name="memberId" value={m.id} />
                    <input type="hidden" name="attended" value="false" />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Didn&rsquo;t attend
                    </button>
                  </form>
                </>
              )}
            </div>
          ))}
        </section>
      ) : (
        <>
          <section className="mt-6">
            <SectionHeading>Your availability</SectionHeading>
            <div className="mt-3">
              <AvailabilityGrid
                pollId={poll.id}
                rangeStart={poll.rangeStart}
                rangeEnd={poll.rangeEnd}
                initialSelected={myAvailability}
                readOnly={Boolean(viewAs)}
              />
            </div>
          </section>

          <section className="mt-8">
            <SectionHeading>Aggregate</SectionHeading>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              {aggregate.submittedCount} member(s) have submitted. Only the overlap shows — never who
              submitted what.
            </p>
            {qualifyingSlots.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No slot qualifies yet.</p>}
            <div className="mt-2 flex flex-col gap-2">
              {qualifyingSlots.map((s) => (
                <div key={s.slot} className="flex items-center gap-3 text-[13px] text-[var(--text)]">
                  <span>
                    {new Date(s.slot).toLocaleString()} — {s.count} available
                  </span>
                  {isOrganizer && (
                    <form action={confirmSlotAction}>
                      <input type="hidden" name="pollId" value={poll.id} />
                      <input type="hidden" name="slot" value={s.slot} />
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Confirm this slot
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {poll.hasAgenda && (
        <section className="mt-8">
          <SectionHeading>Agenda</SectionHeading>
          {agendaItems.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nothing on the agenda yet.</p>}
          <ul className="mt-2 flex flex-col gap-1">
            {agendaItems.map((i) => (
              <li key={i.id} className="text-[13px] text-[var(--text)]">
                {i.text}
              </li>
            ))}
          </ul>
          <form action={addAgendaItemAction} className="mt-3 flex gap-2">
            <input type="hidden" name="pollId" value={poll.id} />
            <input type="text" name="text" required placeholder="Add an agenda item" className={`${INPUT} flex-1`} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Add
            </button>
          </form>
        </section>
      )}

      {poll.needsSummary && (
        <section className="mt-8">
          <SectionHeading>Summary</SectionHeading>
          {summary?.publishedAt ? (
            <>
              <p className="mt-2 whitespace-pre-wrap text-[13px] text-[var(--text)]">{summary.body}</p>
              <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                Published {new Date(summary.publishedAt).toLocaleString()}
                {poll.requireRead && ` · read by ${summaryReads.length} member(s)`}
              </p>
              {poll.requireRead && !iReadSummary && (
                <form action={markSummaryReadAction} className="mt-2">
                  <input type="hidden" name="pollId" value={poll.id} />
                  <input type="hidden" name="summaryId" value={summary.id} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Mark as read
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className={`mt-3 ${CARD}`}>
              <form action={saveSummaryAction} className="flex flex-col gap-2">
                <input type="hidden" name="pollId" value={poll.id} />
                <textarea name="body" rows={4} defaultValue={summary?.body ?? ""} className={INPUT} />
                <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                  Save draft
                </button>
              </form>
              {summary && (
                <form action={publishSummaryAction} className="mt-2">
                  <input type="hidden" name="pollId" value={poll.id} />
                  <button type="submit" className={BUTTON_PRIMARY}>
                    Publish
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

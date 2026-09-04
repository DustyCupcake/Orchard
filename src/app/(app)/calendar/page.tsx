import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { BUTTON_SECONDARY } from "@/components/ui/kit";
import {
  getCalendarEvent,
  listCalendarEventInvites,
  listMyCalendarEventInvites,
  listMyCalendarEvents,
} from "@/lib/calendar-events";
import { listBranches } from "@/lib/settings";
import { listCycles } from "@/lib/cycles";
import { buildMonthGrid, getCalendarView, monthParam, parseMonthParam, shiftMonth, MONTH_LABEL, type CalendarEntry } from "@/lib/calendar";
import {
  acceptInviteAction,
  createCalendarEventAction,
  declineInviteAction,
  deleteCalendarEventAction,
  inviteBranchAction,
  inviteCommunityAction,
  inviteMemberAction,
  updateCalendarEventAction,
} from "./actions";

export const dynamic = "force-dynamic";

const SHARE_LABEL: Record<string, string> = {
  personal: "Personal (just you)",
  branch: "Shared with a Branch",
  community: "Shared with the whole Community",
};

const KIND_LABEL: Record<CalendarEntry["kind"], string> = {
  phase_start: "Phase start",
  phase_end: "Phase end",
  milestone: "Milestone",
  calendar_event: "Event",
  input_round_cutoff: "Input round",
  assembly_agenda_ends: "Assembly agenda",
  assembly_notice_ends: "Assembly notice",
  assembly_voting_ends: "Assembly voting",
  poll_confirmed: "Scheduling poll",
  event_confirmed: "Programme",
  birthday: "Birthday",
  shift_occurrence: "Shift",
  budget_deadline: "Budget",
};

const KIND_CLASS: Record<CalendarEntry["kind"], string> = {
  phase_start: "bg-emerald-100 text-emerald-800",
  phase_end: "bg-emerald-100 text-emerald-800",
  milestone: "bg-blue-100 text-blue-800",
  calendar_event: "bg-purple-100 text-purple-800",
  input_round_cutoff: "bg-amber-100 text-amber-800",
  assembly_agenda_ends: "bg-neutral-200 text-neutral-700",
  assembly_notice_ends: "bg-neutral-200 text-neutral-700",
  assembly_voting_ends: "bg-neutral-200 text-neutral-700",
  poll_confirmed: "bg-teal-100 text-teal-800",
  event_confirmed: "bg-indigo-100 text-indigo-800",
  birthday: "bg-pink-100 text-pink-800",
  shift_occurrence: "bg-orange-100 text-orange-800",
  budget_deadline: "bg-rose-100 text-rose-800",
};

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// The Calendar view's payoff — one Community-wide read layer over every
// dated thing that already exists across the app, plus (folded in from
// Phase 42, per that phase's own "expected to move into /calendar" note)
// Freestanding events' own create/manage/invite/accept/decline UI. See
// docs/development-plan.md's Phase 44 — a read layer only; every source
// below is queried as-is via src/lib/calendar/view.ts, no mutation logic
// added here beyond CalendarEvent's own pre-existing actions.
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    updated?: string;
    deleted?: string;
    invited?: string;
    responded?: string;
    month?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, created, updated, deleted, invited, responded, month } = await searchParams;

  const [view, myEvents, myInvites, branches, cycles, communityMembers] = await Promise.all([
    getCalendarView(viewing),
    listMyCalendarEvents(viewing),
    listMyCalendarEventInvites(viewing),
    listBranches(viewing),
    listCycles(viewing),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
  ]);

  const { year, month: monthNum } = parseMonthParam(month);
  const weeks = buildMonthGrid(year, monthNum);
  const prev = shiftMonth(year, monthNum, -1);
  const next = shiftMonth(year, monthNum, 1);

  const entriesByDate = new Map<string, CalendarEntry[]>();
  for (const e of view.entries) {
    const list = entriesByDate.get(e.date) ?? [];
    list.push(e);
    entriesByDate.set(e.date, list);
  }

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcoming = view.entries.filter((e) => e.date >= todayStr).slice(0, 20);

  const myOwnEvents = myEvents.filter((e) => e.memberId === viewing.id);
  const acceptedEvents = myEvents.filter((e) => e.memberId !== viewing.id);
  const inviteListsByEventId = new Map(
    await Promise.all(
      myOwnEvents.map(async (e) => [e.id, await listCalendarEventInvites(viewing, e.id)] as const),
    ),
  );

  return (
    <main className="mx-auto max-w-4xl p-8 font-sans">
      <h1 className="text-2xl font-semibold text-neutral-900">Calendar</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {view.currentCycle ? `Current cycle: ${view.currentCycle.name}. ` : ""}
        Phase boundaries, your task milestones, your calendar events, and every other module
        deadline in one place — a read layer only, nothing here changes what any of those pages do.
      </p>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {created && <p className="mt-2 text-sm text-emerald-700">Event created.</p>}
      {updated && <p className="mt-2 text-sm text-emerald-700">Event updated.</p>}
      {deleted && <p className="mt-2 text-sm text-emerald-700">Event deleted.</p>}
      {invited && <p className="mt-2 text-sm text-emerald-700">Invites sent.</p>}
      {responded && <p className="mt-2 text-sm text-emerald-700">Your response is saved.</p>}

      <div className="mt-4">
        <Link href="/scheduling-polls" className={BUTTON_SECONDARY}>
          Scheduling polls
        </Link>
      </div>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <a href={`/calendar?month=${monthParam(prev.year, prev.month)}`} className="text-sm text-neutral-600 hover:text-neutral-900">
            ← {MONTH_LABEL[(prev.month - 1 + 12) % 12]}
          </a>
          <h2 className="text-base font-semibold text-neutral-800">
            {MONTH_LABEL[monthNum - 1]} {year}
          </h2>
          <a href={`/calendar?month=${monthParam(next.year, next.month)}`} className="text-sm text-neutral-600 hover:text-neutral-900">
            {MONTH_LABEL[(next.month - 1 + 12) % 12]} →
          </a>
        </div>

        <table className="mt-3 w-full table-fixed border-collapse text-xs">
          <thead>
            <tr>
              {WEEKDAY_LABEL.map((w) => (
                <th key={w} className="border border-neutral-200 bg-neutral-50 p-1 text-neutral-500">
                  {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week) => (
              <tr key={week[0].date}>
                {week.map((day) => {
                  const dayEntries = entriesByDate.get(day.date) ?? [];
                  return (
                    <td
                      key={day.date}
                      className={`h-24 align-top border border-neutral-200 p-1 ${day.inMonth ? "" : "bg-neutral-50 text-neutral-400"} ${day.isToday ? "ring-2 ring-inset ring-blue-400" : ""}`}
                    >
                      <div className="text-[11px] text-neutral-500">{Number(day.date.slice(8, 10))}</div>
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {dayEntries.slice(0, 3).map((e, i) => (
                          <a
                            key={i}
                            href={e.href}
                            className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${KIND_CLASS[e.kind]}`}
                            title={e.label}
                          >
                            {e.label}
                          </a>
                        ))}
                        {dayEntries.length > 3 && (
                          <span className="text-[10px] text-neutral-400">+{dayEntries.length - 3} more</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-6">
        <h2 className="text-base font-semibold text-neutral-800">Upcoming</h2>
        {upcoming.length === 0 && <p className="mt-1 text-sm text-neutral-500">Nothing dated ahead right now.</p>}
        <ul className="mt-2 space-y-1">
          {upcoming.map((e, i) => (
            <li key={i} className="flex items-center gap-2 text-sm">
              <span className="w-24 shrink-0 text-neutral-500">{e.date}</span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${KIND_CLASS[e.kind]}`}>{KIND_LABEL[e.kind]}</span>
              <a href={e.href} className="text-neutral-800 hover:underline">
                {e.label}
              </a>
              {e.drifted && <span className="text-[10px] text-amber-700">drifted</span>}
            </li>
          ))}
        </ul>
      </section>

      {myInvites.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-neutral-800">Invites waiting on you</h2>
          {myInvites.map((i) => (
            <div key={i.eventId} className="mt-2 rounded-md border border-neutral-300 p-3">
              <strong>{i.eventTitle}</strong>{" "}
              <span className="text-sm text-neutral-500">
                — invited by {i.invitedByName}, {new Date(i.invitedAt).toLocaleDateString()}
              </span>
              <div className="mt-2 flex gap-2">
                <form action={acceptInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit" className="rounded-md bg-neutral-800 px-3 py-1 text-sm text-white">
                    Accept
                  </button>
                </form>
                <form action={declineInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit" className="rounded-md border border-neutral-300 px-3 py-1 text-sm">
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold text-neutral-800">Your events</h2>
        {myOwnEvents.length === 0 && <p className="mt-1 text-sm text-neutral-500">None yet.</p>}
        {myOwnEvents.map((e) => {
          const eventInvites = inviteListsByEventId.get(e.id) ?? [];
          return (
            <div key={e.id} className="mt-3 rounded-md border border-neutral-300 p-3">
              <strong>{e.title}</strong> <span className="text-sm text-neutral-500">({SHARE_LABEL[e.shareTarget]})</span>
              <div className="text-sm text-neutral-500">
                {e.date ?? "unresolved"}
                {e.drifted && <span className="text-amber-700"> · drifted from its anchor</span>}
              </div>
              {e.description && <p className="mt-1">{e.description}</p>}

              {eventInvites.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500">
                  Invited: {eventInvites.map((i) => `${i.memberName} (${i.invite.status})`).join(", ")}
                </p>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-sm">Edit</summary>
                <form action={updateCalendarEventAction} className="mt-2 flex max-w-md flex-col gap-2">
                  <input type="hidden" name="eventId" value={e.id} />
                  <input type="text" name="title" required defaultValue={e.title} className="rounded border border-neutral-300 p-2" />
                  <textarea name="description" rows={2} defaultValue={e.description ?? ""} className="rounded border border-neutral-300 p-2" />
                  <select name="cycleId" defaultValue={e.cycleId ?? ""} className="rounded border border-neutral-300 p-2">
                    <option value="">Cycle-independent</option>
                    {cycles.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <EventDateFields event={e} />
                  <select name="shareTarget" defaultValue={e.shareTarget} className="rounded border border-neutral-300 p-2">
                    <option value="personal">Personal (just you)</option>
                    <option value="branch">Shared with a Branch</option>
                    <option value="community">Shared with the whole Community</option>
                  </select>
                  <select name="sharedBranchId" defaultValue={e.sharedBranchId ?? ""} className="rounded border border-neutral-300 p-2">
                    <option value="">— pick a Branch if shareTarget is Branch —</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="w-fit rounded-md bg-neutral-800 px-3 py-1 text-sm text-white">
                    Save
                  </button>
                </form>
              </details>

              <details className="mt-2">
                <summary className="cursor-pointer text-sm">Invite people</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <form action={inviteMemberAction} className="flex gap-2">
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="memberId" required className="rounded border border-neutral-300 p-1.5 text-sm">
                      <option value="">Pick a member</option>
                      {communityMembers
                        .filter((m) => m.id !== viewing.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                    <button type="submit" className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
                      Invite
                    </button>
                  </form>
                  <form action={inviteBranchAction} className="flex gap-2">
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="branchId" required className="rounded border border-neutral-300 p-1.5 text-sm">
                      <option value="">Pick a Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
                      Invite Branch&rsquo;s current roster
                    </button>
                  </form>
                  <form action={inviteCommunityAction}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <button type="submit" className="rounded-md border border-neutral-300 px-2 py-1 text-sm">
                      Invite the whole Community
                    </button>
                  </form>
                </div>
              </details>

              <form action={deleteCalendarEventAction} className="mt-2">
                <input type="hidden" name="eventId" value={e.id} />
                <button type="submit" className="text-sm text-red-600 hover:underline">
                  Delete
                </button>
              </form>
            </div>
          );
        })}
      </section>

      {acceptedEvents.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-neutral-800">On your calendar</h2>
          {acceptedEvents.map((e) => (
            <div key={e.id} className="mt-1 text-sm">
              <strong>{e.title}</strong> <span className="text-neutral-500">— {e.date ?? "unresolved"}</span>
            </div>
          ))}
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-base font-semibold text-neutral-800">Create an event</h2>
        <form action={createCalendarEventAction} className="mt-2 flex max-w-md flex-col gap-2">
          <input type="text" name="title" required placeholder="Title" className="rounded border border-neutral-300 p-2" />
          <textarea name="description" rows={2} placeholder="Description (optional)" className="rounded border border-neutral-300 p-2" />
          <select name="cycleId" defaultValue="" className="rounded border border-neutral-300 p-2">
            <option value="">Cycle-independent</option>
            {cycles.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <EventDateFields />
          <select name="shareTarget" defaultValue="personal" className="rounded border border-neutral-300 p-2">
            <option value="personal">Personal (just you)</option>
            <option value="branch">Shared with a Branch</option>
            <option value="community">Shared with the whole Community</option>
          </select>
          <select name="sharedBranchId" defaultValue="" className="rounded border border-neutral-300 p-2">
            <option value="">— pick a Branch if shareTarget is Branch —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <button type="submit" className="w-fit rounded-md bg-neutral-800 px-3 py-1 text-sm text-white">
            Create
          </button>
        </form>
      </section>
    </main>
  );
}

type EventRow = Awaited<ReturnType<typeof listMyCalendarEvents>>[number] | Awaited<ReturnType<typeof getCalendarEvent>>;

// A single date, not a start/end pair — see src/app/(app)/participation/
// page.tsx's PhaseBoundaryFields for the two-boundary sibling of this,
// and src/lib/dates/resolve.ts's dateBoundaryInput for the shared shape
// both forms submit.
function EventDateFields({ event }: { event?: EventRow }) {
  const mode = !event || event.dateType === "absolute" ? "absolute" : `relative_${event.relativeMode}`;

  return (
    <fieldset className="rounded border border-neutral-200 p-2">
      <legend className="px-1 text-xs text-neutral-500">When</legend>
      <label className="block text-sm">
        Mode
        <select name="dateMode" defaultValue={mode} className="mt-1 w-full rounded border border-neutral-300 p-2">
          <option value="absolute">Absolute date</option>
          <option value="relative_offset">Relative — offset (days from the Cycle&rsquo;s start/end)</option>
          <option value="relative_percent">Relative — percent (between the Cycle&rsquo;s start and end)</option>
        </select>
      </label>
      <label className="mt-2 block text-sm">
        Absolute date (used when mode is Absolute)
        <input
          type="date"
          name="absoluteDate"
          defaultValue={event?.dateType === "absolute" ? (event.date ?? "") : ""}
          className="mt-1 w-full rounded border border-neutral-300 p-2"
        />
      </label>
      <label className="mt-2 block text-sm">
        Anchor (used when mode is relative offset)
        <select name="anchor" defaultValue={event?.anchorType ?? "cycle_start"} className="mt-1 w-full rounded border border-neutral-300 p-2">
          <option value="cycle_start">Cycle start</option>
          <option value="cycle_end">Cycle end</option>
        </select>
      </label>
      <label className="mt-2 block text-sm">
        Offset days (used when mode is relative offset, and no target date is given below)
        <input
          type="number"
          name="offsetDays"
          defaultValue={event?.relativeMode === "offset" ? (event.offsetDays ?? "") : ""}
          className="mt-1 w-full rounded border border-neutral-300 p-2"
        />
      </label>
      <label className="mt-2 block text-sm">
        Percent 0-100 (used when mode is relative percent, and no target date is given below)
        <input
          type="number"
          min={0}
          max={100}
          name="percent"
          defaultValue={event?.relativeMode === "percent" ? (event.percent ?? "") : ""}
          className="mt-1 w-full rounded border border-neutral-300 p-2"
        />
      </label>
      <label className="mt-2 block text-sm">
        Or drag to this target date (recomputes and persists the offset/percent above)
        <input type="date" name="targetDate" className="mt-1 w-full rounded border border-neutral-300 p-2" />
      </label>
    </fieldset>
  );
}

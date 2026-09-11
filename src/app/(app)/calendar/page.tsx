import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag, TONE_CLASSES, type Tone } from "@/components/ui/kit";
import DateModeField, { type DateFieldBase } from "@/components/DateModeField";
import PageHeader from "@/components/ui/PageHeader";
import Tabs from "@/components/ui/Tabs";
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

// Collapsed onto the shared 6-tone Tag palette (see kit.tsx) rather
// than a bespoke color per kind — enough kinds share a tone that this
// still reads as "settled/confirmed" vs. "deadline" vs. "personal" at
// a glance, and KIND_LABEL/the entry's own link carry the specifics.
const KIND_TONE: Record<CalendarEntry["kind"], Tone> = {
  phase_start: "success",
  phase_end: "success",
  poll_confirmed: "success",
  milestone: "accent",
  event_confirmed: "accent",
  calendar_event: "accent2",
  birthday: "accent2",
  input_round_cutoff: "warning",
  budget_deadline: "warning",
  assembly_agenda_ends: "neutral",
  assembly_notice_ends: "neutral",
  assembly_voting_ends: "neutral",
  shift_occurrence: "neutral",
};

const WEEKDAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// The page used to stack Month grid / Upcoming / Invites / Your events /
// On your calendar all at once — split into tabs (same zero-JS `?tab=`
// pattern as settings/page.tsx and tasks/[id]/page.tsx) so it reads as
// one view at a time. "Create an event" moves behind the header's "New
// event" action (a `?compose=1` link, same technique as the month nav
// already uses) instead of always rendering at the bottom of the page.
const CAL_TABS = [
  { key: "month", label: "Month" },
  { key: "upcoming", label: "Upcoming" },
  { key: "your-events", label: "Your events" },
] as const;
type CalTabKey = (typeof CAL_TABS)[number]["key"];
const CAL_TAB_KEYS = CAL_TABS.map((t) => t.key) as readonly string[];

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
    tab?: string;
    compose?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, created, updated, deleted, invited, responded, month, tab: tabRaw, compose } = await searchParams;
  const activeTab: CalTabKey = CAL_TAB_KEYS.includes(tabRaw ?? "") ? (tabRaw as CalTabKey) : "month";
  const composeOpen = compose === "1";
  const tabHref = (key: CalTabKey) => `/calendar?tab=${key}${month ? `&month=${month}` : ""}`;
  const newEventHref = `/calendar?compose=1&tab=your-events${month ? `&month=${month}` : ""}`;
  const cancelComposeHref = tabHref("your-events");

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
    <main className="mx-auto max-w-4xl px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Calendar"
        description={
          <>
            {view.currentCycle ? `Current cycle: ${view.currentCycle.name}. ` : ""}
            Phase boundaries, your task milestones, your calendar events, and every other module
            deadline in one place — a read layer only, nothing here changes what any of those pages do.
          </>
        }
        actions={
          <>
            <Link href="/scheduling-polls" className={BUTTON_SECONDARY}>
              Scheduling polls
            </Link>
            <Link href={newEventHref} className={BUTTON_PRIMARY}>
              New event
            </Link>
          </>
        }
        tabs={<Tabs tabs={CAL_TABS} active={activeTab} hrefFor={tabHref} />}
      />

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}
      {created && <div className="mt-4"><Banner tone="success">Event created.</Banner></div>}
      {updated && <div className="mt-4"><Banner tone="success">Event updated.</Banner></div>}
      {deleted && <div className="mt-4"><Banner tone="success">Event deleted.</Banner></div>}
      {invited && <div className="mt-4"><Banner tone="success">Invites sent.</Banner></div>}
      {responded && <div className="mt-4"><Banner tone="success">Your response is saved.</Banner></div>}

      {activeTab === "month" && (
      <section className="mt-4">
        <div className="flex items-center justify-between">
          <Link
            href={`/calendar?month=${monthParam(prev.year, prev.month)}`}
            className="flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            <CaretLeftIcon size={14} /> {MONTH_LABEL[(prev.month - 1 + 12) % 12]}
          </Link>
          <h2 className="text-[16px] font-semibold text-[var(--text)]">
            {MONTH_LABEL[monthNum - 1]} {year}
          </h2>
          <Link
            href={`/calendar?month=${monthParam(next.year, next.month)}`}
            className="flex items-center gap-1 text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            {MONTH_LABEL[(next.month - 1 + 12) % 12]} <CaretRightIcon size={14} />
          </Link>
        </div>

        <table className="mt-3 w-full table-fixed border-collapse text-[12px]">
          <thead>
            <tr>
              {WEEKDAY_LABEL.map((w) => (
                <th
                  key={w}
                  className="border border-[var(--border)] bg-[var(--surface-sunken)] p-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                >
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
                      className={`h-24 border border-[var(--border)] p-1 align-top ${day.inMonth ? "bg-[var(--surface)]" : "bg-[var(--surface-sunken)] text-[var(--text-muted)]"} ${day.isToday ? "ring-2 ring-inset ring-[var(--accent-1)]" : ""}`}
                    >
                      <div className="text-[11px] text-[var(--text-muted)]">{Number(day.date.slice(8, 10))}</div>
                      <div className="mt-0.5 flex flex-col gap-0.5">
                        {dayEntries.slice(0, 3).map((e, i) => (
                          <a
                            key={i}
                            href={e.href}
                            className={`truncate rounded-[var(--radius-sm)] px-1 py-0.5 text-[10px] leading-tight ${TONE_CLASSES[KIND_TONE[e.kind]]}`}
                            title={e.label}
                          >
                            {e.label}
                          </a>
                        ))}
                        {dayEntries.length > 3 && (
                          <span className="text-[10px] text-[var(--text-muted)]">+{dayEntries.length - 3} more</span>
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
      )}

      {activeTab === "upcoming" && (
      <section className="mt-4">
        <SectionHeading>Upcoming</SectionHeading>
        {upcoming.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">Nothing dated ahead right now.</p>}
        <ul className="mt-2">
          {upcoming.map((e, i) => (
            <li
              key={i}
              className="flex items-center gap-3 border-b border-[var(--border)] py-2 text-[13px] last:border-b-0"
            >
              <span className="w-24 shrink-0 text-[var(--text-muted)]">{e.date}</span>
              <span className="shrink-0"><Tag tone={KIND_TONE[e.kind]}>{KIND_LABEL[e.kind]}</Tag></span>
              <a href={e.href} className="min-w-0 truncate text-[var(--text)] hover:text-[var(--accent-1)]">
                {e.label}
              </a>
              {e.drifted && <span className="shrink-0 text-[11px] text-[var(--warning)]">drifted</span>}
            </li>
          ))}
        </ul>
      </section>
      )}

      {activeTab === "your-events" && (
      <>
      {composeOpen && (
        <section className="mt-4">
          <div className="flex items-center justify-between">
            <SectionHeading>Create an event</SectionHeading>
            <Link href={cancelComposeHref} className={BUTTON_GHOST}>
              Cancel
            </Link>
          </div>
          <form action={createCalendarEventAction} className={`mt-3 flex max-w-md flex-col gap-2 ${CARD}`}>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Title</span>
              <input type="text" name="title" required placeholder="Title" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Description (optional)</span>
              <textarea name="description" rows={2} placeholder="Description (optional)" className={INPUT} />
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Cycle</span>
              <select name="cycleId" defaultValue="" className={INPUT}>
                <option value="">Cycle-independent</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <EventDateFields />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Share with</span>
              <select name="shareTarget" defaultValue="personal" className={INPUT}>
                <option value="personal">Personal (just you)</option>
                <option value="branch">Shared with a Branch</option>
                <option value="community">Shared with the whole Community</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Branch (used when share target is Branch)</span>
              <select name="sharedBranchId" defaultValue="" className={INPUT}>
                <option value="">— pick a Branch if shareTarget is Branch —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Create
            </button>
          </form>
        </section>
      )}

      {myInvites.length > 0 && (
        <section className="mt-4">
          <SectionHeading>Invites waiting on you</SectionHeading>
          {myInvites.map((i) => (
            <div key={i.eventId} className={`mt-3 ${CARD}`}>
              <p className="text-[14px] font-medium text-[var(--text)]">{i.eventTitle}</p>
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                Invited by {i.invitedByName}, {new Date(i.invitedAt).toLocaleDateString()}
              </p>
              <div className="mt-3 flex gap-2">
                <form action={acceptInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit" className={BUTTON_PRIMARY}>
                    Accept
                  </button>
                </form>
                <form action={declineInviteAction}>
                  <input type="hidden" name="eventId" value={i.eventId} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Decline
                  </button>
                </form>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="mt-8">
        <SectionHeading>Your events</SectionHeading>
        {myOwnEvents.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None yet.</p>}
        {myOwnEvents.map((e) => {
          const eventInvites = inviteListsByEventId.get(e.id) ?? [];
          return (
            <div key={e.id} className={`mt-3 ${CARD}`}>
              <div className="flex items-baseline gap-2">
                <p className="text-[14px] font-medium text-[var(--text)]">{e.title}</p>
                <Tag>{SHARE_LABEL[e.shareTarget]}</Tag>
              </div>
              <p className="mt-0.5 text-[13px] text-[var(--text-muted)]">
                {e.date ?? "unresolved"}
                {e.drifted && <span className="text-[var(--warning)]"> · drifted from its anchor</span>}
              </p>
              {e.description && <p className="mt-2 text-[13px] text-[var(--text)]">{e.description}</p>}

              {eventInvites.length > 0 && (
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                  Invited: {eventInvites.map((i) => `${i.memberName} (${i.invite.status})`).join(", ")}
                </p>
              )}

              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Edit</summary>
                <form action={updateCalendarEventAction} className="mt-2 flex max-w-md flex-col gap-2">
                  <input type="hidden" name="eventId" value={e.id} />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Title</span>
                    <input type="text" name="title" required defaultValue={e.title} className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Description</span>
                    <textarea name="description" rows={2} defaultValue={e.description ?? ""} className={INPUT} />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Cycle</span>
                    <select name="cycleId" defaultValue={e.cycleId ?? ""} className={INPUT}>
                      <option value="">Cycle-independent</option>
                      {cycles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <EventDateFields event={e} />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Share with</span>
                    <select name="shareTarget" defaultValue={e.shareTarget} className={INPUT}>
                      <option value="personal">Personal (just you)</option>
                      <option value="branch">Shared with a Branch</option>
                      <option value="community">Shared with the whole Community</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Branch (used when share target is Branch)</span>
                    <select name="sharedBranchId" defaultValue={e.sharedBranchId ?? ""} className={INPUT}>
                      <option value="">— pick a Branch if shareTarget is Branch —</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                    Save
                  </button>
                </form>
              </details>

              <details className="mt-2">
                <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Invite people</summary>
                <div className="mt-2 flex flex-col gap-2">
                  <form action={inviteMemberAction} className="flex gap-2">
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="memberId" required className={INPUT}>
                      <option value="">Pick a member</option>
                      {communityMembers
                        .filter((m) => m.id !== viewing.id)
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Invite
                    </button>
                  </form>
                  <form action={inviteBranchAction} className="flex gap-2">
                    <input type="hidden" name="eventId" value={e.id} />
                    <select name="branchId" required className={INPUT}>
                      <option value="">Pick a Branch</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Invite Branch&rsquo;s current roster
                    </button>
                  </form>
                  <form action={inviteCommunityAction}>
                    <input type="hidden" name="eventId" value={e.id} />
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Invite the whole Community
                    </button>
                  </form>
                </div>
              </details>

              <form action={deleteCalendarEventAction} className="mt-2">
                <input type="hidden" name="eventId" value={e.id} />
                <button type="submit" className={BUTTON_GHOST}>
                  Delete
                </button>
              </form>
            </div>
          );
        })}
      </section>

      {acceptedEvents.length > 0 && (
        <section className="mt-8">
          <SectionHeading>On your calendar</SectionHeading>
          <ul className="mt-2">
            {acceptedEvents.map((e) => (
              <li key={e.id} className="border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
                <span className="font-medium text-[var(--text)]">{e.title}</span>{" "}
                <span className="text-[var(--text-muted)]">— {e.date ?? "unresolved"}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      </>
      )}
    </main>
  );
}

type EventRow = Awaited<ReturnType<typeof listMyCalendarEvents>>[number] | Awaited<ReturnType<typeof getCalendarEvent>>;

// A single date, not a start/end pair — see src/app/(app)/participation/
// page.tsx's PhaseBoundaryFields for the two-boundary sibling of this,
// and src/lib/dates/resolve.ts's dateBoundaryInput for the shared shape
// both forms submit. Calendar events have no phase-anchor concept, so
// DateModeField never gets a `phases` list here — only Absolute/
// Cycle-relative are ever offered.
const EVENT_DATE_FIELD_NAMES: Record<DateFieldBase, string> = {
  mode: "dateMode",
  absoluteDate: "absoluteDate",
  anchor: "anchor",
  offsetDays: "offsetDays",
  percent: "percent",
  targetDate: "targetDate",
  phaseId: "phaseId",
};

function EventDateFields({ event }: { event?: EventRow }) {
  return (
    <DateModeField
      fieldNames={EVENT_DATE_FIELD_NAMES}
      mode={event?.dateType}
      relativeMode={event?.relativeMode}
      anchor={event?.anchorType}
      absoluteDate={event?.dateType === "absolute" ? event.date : undefined}
      offsetDays={event?.relativeMode === "offset" ? event.offsetDays : undefined}
      percent={event?.relativeMode === "percent" ? event.percent : undefined}
    />
  );
}

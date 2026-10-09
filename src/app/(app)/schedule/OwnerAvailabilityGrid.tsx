import type { eventProposal as eventProposalTable } from "@/db/schema";
import {
  candidatePlacements,
  CELL_MINUTES,
  commonPlacementWindow,
  gridDays,
  gridWeeks,
  type EventSlot,
} from "@/lib/event-scheduling";
import { formatTimeInZone, instantFromZoned } from "@/lib/dates";
import Link from "next/link";
import { BUTTON_SECONDARY, CARD, Tag } from "@/components/ui/kit";

type EventProposalRow = typeof eventProposalTable.$inferSelect;

const CELL_MS = CELL_MINUTES * 60_000;
const ROWS_PER_HOUR = 60 / CELL_MINUTES;
const ROW_COUNT = 24 * ROWS_PER_HOUR;

/**
 * The scheduling owner's cross-proposal availability overlay.
 *
 * Read-only, and unlike the host-side grid this one is a server component:
 * there is nothing to paint here, and rendering it on the server keeps the
 * one interactive component on this page to one.
 *
 * Every unplaced proposal's painted windows are drawn as thin marks on a
 * shared day-by-time grid, so the owner can see where the programme's
 * availability actually piles up rather than reading each proposal's
 * windows one card at a time. Confirmed placements are drawn solid, since
 * they're no longer options — they're commitments, and treating them as
 * movable is exactly the mistake this view should prevent.
 *
 * The headline line is the real payload, and it's what painted
 * availability made possible: one stretch of time that could hold every
 * proposal still waiting to be placed, or a plain statement that none
 * does. Pairwise conflict flags say two hosts need to negotiate; this says
 * whether the programme fits at all.
 */
export default function OwnerAvailabilityGrid({
  proposals,
  memberNameById,
  rangeStart,
  rangeEnd,
  timeZone,
  timeLabel,
  week: requestedWeek,
}: {
  proposals: EventProposalRow[];
  memberNameById: Map<string, string>;
  rangeStart: string;
  rangeEnd: string;
  timeZone: string;
  timeLabel: (s: EventSlot) => { visible: string; exact: string };
  /** Zero-based page of the grid, from the URL — a week at a time. */
  week: number;
}) {
  const weeks = gridWeeks(gridDays(rangeStart, rangeEnd));
  if (weeks.length === 0) return null;
  const week = Math.min(Math.max(0, requestedWeek), weeks.length - 1);
  const days = weeks[week];

  const unplaced = proposals.filter(
    (p) => !p.publishedAt && p.status !== "declined" && !p.confirmedSlot,
  );

  const common = commonPlacementWindow(
    unplaced.map((p) => ({
      windows: p.preferredSlots as EventSlot[],
      durationMinutes: p.durationMinutes,
    })),
  );

  const optionCountById = new Map(
    proposals.map((p) => [
      p.id,
      candidatePlacements(p.preferredSlots as EventSlot[], p.durationMinutes).length,
    ]),
  );

  return (
    <div className={CARD}>
      <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
        What everyone said they could do
      </p>

      {weeks.length > 1 && (
        <nav className="mt-2 flex items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {week > 0 ? (
            <Link href={`?week=${week}`} scroll={false} className={BUTTON_SECONDARY}>
              Previous week
            </Link>
          ) : (
            <span className={`${BUTTON_SECONDARY} opacity-50`}>Previous week</span>
          )}
          <span>
            {weekdayLabel(days[0], timeZone)} – {weekdayLabel(days[days.length - 1], timeZone)} · week{" "}
            {week + 1} of {weeks.length}
          </span>
          {week < weeks.length - 1 ? (
            <Link href={`?week=${week + 2}`} scroll={false} className={BUTTON_SECONDARY}>
              Next week
            </Link>
          ) : (
            <span className={`${BUTTON_SECONDARY} opacity-50`}>Next week</span>
          )}
        </nav>
      )}

      <div className="mt-2 overflow-auto rounded-[var(--radius-md)] border border-[var(--border)]">
        <div className="flex select-none">
          <div className="sticky left-0 z-10 flex shrink-0 flex-col bg-[var(--surface)]">
            <div className="h-8 w-14" />
            {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => (
              <div
                key={rowIdx}
                className={`h-[14px] pr-1 text-right text-[length:var(--text-micro)] text-[var(--text-muted)] ${rowIdx % ROWS_PER_HOUR === 0 ? "visible" : "invisible"}`}
              >
                {String(Math.floor(rowIdx / ROWS_PER_HOUR)).padStart(2, "0")}
              </div>
            ))}
          </div>
          {days.map((day) => (
            <div key={day} className="flex min-w-24 flex-1 flex-col">
              <div className="h-8 text-center text-[length:var(--text-micro)] text-[var(--text-muted)]">
                {weekdayLabel(day, timeZone)}
              </div>
              {Array.from({ length: ROW_COUNT }).map((_, rowIdx) => {
                const cellStart = cellStartMs(day, rowIdx, timeZone);
                if (cellStart === null) {
                  return <div key={`${day}-${rowIdx}`} className="h-[14px] w-full bg-[var(--surface-sunken)]" />;
                }
                const cellEnd = cellStart + CELL_MS;
                // How many unplaced proposals are free across this cell,
                // plus how many are already locked into it.
                const freeCount = unplaced.filter((p) =>
                  coversCell(p.preferredSlots as EventSlot[], cellStart, cellEnd),
                ).length;
                const confirmedCount = proposals.filter(
                  (p) =>
                    p.confirmedSlot &&
                    coversCell([p.confirmedSlot as EventSlot], cellStart, cellEnd),
                ).length;

                const tone =
                  confirmedCount > 0
                    ? "bg-[var(--accent-2)]"
                    : freeCount === 0
                      ? "bg-[var(--surface)]"
                      : "bg-[var(--accent-1)]";

                return (
                  <div
                    key={`${day}-${rowIdx}`}
                    title={
                      confirmedCount > 0
                        ? `${confirmedCount} confirmed here, ${freeCount} could also do it`
                        : `${freeCount} could do it`
                    }
                    className={`h-[14px] border-l border-t border-l-[var(--surface-sunken)] border-t-[var(--surface-sunken)] ${tone}`}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        <Tag>Confirmed</Tag>
        <span>Something is scheduled there</span>
        <Tag>Available</Tag>
        <span>Unplaced proposals that could do it</span>
        <span>All times in {timeZone}.</span>
      </div>

      {common ? (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
          {unplaced.length === 1 ? "This one fits at" : `All ${unplaced.length} waiting to be placed fit between`}{" "}
          <span title={timeLabel(common).exact}>{timeLabel(common).visible}</span>
          , back to back.
        </p>
      ) : unplaced.length > 0 ? (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          No stretch of time holds every proposal waiting to be placed — something needs to move,
          shorten, or drop out.
        </p>
      ) : (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Nothing waiting to be placed.
        </p>
      )}

      {unplaced.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {unplaced.map((p) => (
            <li key={p.id}>
              {p.title} — {memberNameById.get(p.submittedBy) ?? "—"}
              {p.status === "conflict" && (
                <span className="text-[var(--warning)]"> · flagged as clashing</span>
              )}
              {optionCountById.get(p.id) === 0 && (
                <span className="text-[var(--warning)]">
                  {" "}
                  · no window here is long enough for {p.durationMinutes} minutes
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function coversCell(windows: EventSlot[], cellStart: number, cellEnd: number): boolean {
  return windows.some(
    (w) => new Date(w.startsAt).getTime() <= cellStart && new Date(w.endsAt).getTime() >= cellEnd,
  );
}

/**
 * The UTC instant of one grid cell, or null when that wall clock doesn't
 * exist on this day (a DST spring-forward gap).
 *
 * Duplicated from the host-side grid rather than shared, because that is
 * a client component and this is a server one, so they can't share a
 * module. Both read CELL_MINUTES from the lib, so the cell size can't
 * drift between them — a mismatch would silently offset this overlay by
 * 30 minutes against what hosts painted.
 */
function cellStartMs(day: string, rowIdx: number, timeZone: string): number | null {
  const hour = Math.floor(rowIdx / ROWS_PER_HOUR);
  const minute = (rowIdx % ROWS_PER_HOUR) * CELL_MINUTES;
  const wanted = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const instant = instantFromZoned(`${day}T${wanted}`, timeZone);
  // Round-trip check: a gap resolves to a neighbour, so its wall clock
  // won't read back as what we asked for.
  return formatTimeInZone(instant.toISOString(), timeZone) === wanted
    ? instant.getTime()
    : null;
}

function weekdayLabel(day: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${day}T12:00:00Z`));
}
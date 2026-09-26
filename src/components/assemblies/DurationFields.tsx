"use client";

import { useState } from "react";
import { INPUT, LABEL } from "../ui/kit";
import SegmentedControl from "../ui/SegmentedControl";
import { humanizeDuration, relativeTime } from "./time";

// The three windows an Assembly runs through, as one honest control
// instead of three raw "minutes" number boxes.
//
// The old form asked for agendaMinutes/noticeMinutes/votingMinutes as
// bare integers, which put a unit conversion on the reader: picking a
// one-week agenda meant knowing 10080, and the page's own intro had to
// explain "60 = 1 hour, 1440 = 1 day" in prose. Here you pick a number
// in a unit you already think in, and the minutes are derived.
//
// The presets exist because "how long?" is really "how urgent?", and
// almost every proposal lands on one of three answers. They're a
// starting point, not a constraint — every field stays individually
// editable after picking one, which matters because "urgent decision but
// still a week to vote" is a real shape.
//
// The preview is the part that was missing entirely: you can see what
// your three numbers actually produce, per window, before committing.

const UNIT_MINUTES = { minutes: 1, hours: 60, days: 1440, weeks: 10080 } as const;
type Unit = keyof typeof UNIT_MINUTES;
const UNIT_OPTIONS: { value: Unit; label: string }[] = [
  { value: "minutes", label: "Minutes" },
  { value: "hours", label: "Hours" },
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
];

const WINDOWS = [
  {
    key: "agenda",
    name: "agendaMinutes",
    label: "Agenda building",
    blurb: "Anyone can add agenda items",
    min: 0,
  },
  {
    key: "notice",
    name: "noticeMinutes",
    label: "Notice",
    blurb: "Agenda locked and readable, voting not open yet",
    min: 0,
  },
  {
    key: "voting",
    name: "votingMinutes",
    label: "Voting",
    blurb: "Members vote, and results are tallied when it closes",
    min: 1,
  },
] as const;

type WindowKey = (typeof WINDOWS)[number]["key"];
type Amounts = Record<WindowKey, { amount: number; unit: Unit }>;

const PRESETS: { label: string; hint: string; values: Amounts }[] = [
  {
    label: "Urgent",
    hint: "hours to notice, a day to vote",
    values: {
      agenda: { amount: 1, unit: "hours" },
      notice: { amount: 1, unit: "hours" },
      voting: { amount: 1, unit: "days" },
    },
  },
  {
    label: "Normal",
    hint: "a day each to build and read, three to vote",
    values: {
      agenda: { amount: 1, unit: "days" },
      notice: { amount: 1, unit: "days" },
      voting: { amount: 3, unit: "days" },
    },
  },
  {
    label: "Deliberate",
    hint: "a week to build and read, two to vote",
    values: {
      agenda: { amount: 1, unit: "weeks" },
      notice: { amount: 1, unit: "weeks" },
      voting: { amount: 2, unit: "weeks" },
    },
  },
];

function toMinutes({ amount, unit }: { amount: number; unit: Unit }, min: number): number {
  const raw = Math.round(amount) * UNIT_MINUTES[unit];
  return Math.max(min, Number.isFinite(raw) ? raw : min);
}

export default function DurationFields({ now }: { now: number }) {
  const [amounts, setAmounts] = useState<Amounts>(PRESETS[1].values);

  const setWindow = (key: WindowKey, next: Partial<Amounts[WindowKey]>) =>
    setAmounts((prev) => ({ ...prev, [key]: { ...prev[key], ...next } }));

  // The three boundaries, each measured from the one before it — the
  // same arithmetic createAssembly does, mirrored here so the preview
  // can't disagree with what actually gets stored.
  let cursor = now;
  const boundaries = WINDOWS.map((w) => {
    const minutes = toMinutes(amounts[w.key], w.min);
    const startsAt = cursor;
    cursor += minutes * 60_000;
    return { ...w, minutes, startsAt, endsAt: cursor };
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
        <span className={LABEL}>How much time does this need?</span>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          {PRESETS.map((preset) => {
            const isActive = WINDOWS.every(
              (w) => amounts[w.key].unit === preset.values[w.key].unit && amounts[w.key].amount === preset.values[w.key].amount,
            );
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => setAmounts(preset.values)}
                className={`rounded-[var(--radius-md)] border px-3 py-1.5 text-left text-[13px] transition-colors ${
                  isActive
                    ? "border-[var(--accent-1)] bg-[var(--accent-1-soft)] text-[var(--accent-1)]"
                    : "border-[var(--border)] text-[var(--text)] hover:bg-[var(--neutral-100)]"
                }`}
              >
                <span className="font-medium">{preset.label}</span>
                <span className="ml-1.5 text-[12px] text-[var(--text-muted)]">{preset.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          A starting point — every window below stays editable.
        </p>
      </div>

      {boundaries.map((b) => (
        <div key={b.key} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-[var(--text)]">{b.label}</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                aria-label={`${b.label} — how many ${amounts[b.key].unit}`}
                value={amounts[b.key].amount}
                onChange={(e) => setWindow(b.key, { amount: Number(e.target.value) })}
                className={`${INPUT} w-20`}
              />
              <SegmentedControl
                size="sm"
                value={amounts[b.key].unit}
                onChange={(unit) => setWindow(b.key, { unit })}
                options={UNIT_OPTIONS}
              />
              {/* The real field the server parses. The number box above
                  has no name of its own — same shape DateModeField uses
                  for its mode/date pair. */}
              <input type="hidden" name={b.name} value={b.minutes} />
            </div>
          </div>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">{b.blurb}</p>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            {b.key === "agenda" ? (
              b.minutes === 0 ? (
                <>
                  No window at all — the agenda would be locked before anyone could add
                  anything, so this Assembly would go straight to notice.
                </>
              ) : (
                <>Open for {humanizeDuration(b.endsAt - b.startsAt)}, starting now.</>
              )
            ) : (
              <>
                Runs for {humanizeDuration(b.endsAt - b.startsAt)} —{" "}
                {relativeTime(b.endsAt, now)}.
              </>
            )}
          </p>
        </div>
      ))}

      <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
        <span className={LABEL}>What that adds up to</span>
        <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
          <li>Agenda closes {relativeTime(boundaries[0].endsAt, now)}</li>
          <li>Voting opens {relativeTime(boundaries[1].endsAt, now)}</li>
          <li>Everything closes {relativeTime(boundaries[2].endsAt, now)}</li>
        </ul>
      </div>
    </div>
  );
}

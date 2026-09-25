import { daysBetween } from "./resolve";

export type DateDisplayMode = "exact" | "period";

export interface PeriodDateContext {
  name: string;
  startDate: string;
  endDate: string;
  /** Include a Cycle name when the view is not already inside one Cycle. */
  cycleName?: string | null;
  boundaryKind?: "start" | "end";
}

export interface DateLabel {
  canonical: string;
  exact: string;
  weekday: string;
  visible: string;
  periodAvailable: boolean;
}

const exactFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const weekdayFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

function asUtcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

export function formatExactDate(date: string): string {
  return exactFormatter.format(asUtcDate(date));
}

export function formatWeekday(date: string): string {
  return weekdayFormatter.format(asUtcDate(date));
}

export function isShortPeriod(startDate: string, endDate: string): boolean {
  return startDate <= endDate && daysBetween(startDate, endDate) + 1 <= 7;
}

export function formatDateLabel(
  date: string | null | undefined,
  mode: DateDisplayMode,
  period?: PeriodDateContext | null,
): DateLabel {
  if (!date) {
    return {
      canonical: "",
      exact: "Unresolved",
      weekday: "",
      visible: "Unresolved",
      periodAvailable: false,
    };
  }

  const exact = formatExactDate(date);
  const weekday = formatWeekday(date);
  const periodAvailable = Boolean(
    period &&
      isShortPeriod(period.startDate, period.endDate) &&
      date >= period.startDate &&
      date <= period.endDate,
  );

  if (mode === "period" && period && periodAvailable) {
    const boundary = period.boundaryKind ? `${period.boundaryKind}s` : null;
    const periodLabel = boundary ? `${period.name} ${boundary}` : period.name;
    const cyclePrefix = period.cycleName ? `${period.cycleName} · ` : "";
    return {
      canonical: date,
      exact,
      weekday,
      visible: `${cyclePrefix}${periodLabel} · ${weekday}`,
      periodAvailable: true,
    };
  }

  return { canonical: date, exact, weekday, visible: exact, periodAvailable: false };
}

export function effectiveDateDisplayMode(
  member: { dateDisplayMode?: DateDisplayMode | null },
  community: { defaultDateDisplayMode: DateDisplayMode },
): DateDisplayMode {
  return member.dateDisplayMode ?? community.defaultDateDisplayMode;
}

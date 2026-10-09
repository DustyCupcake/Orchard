import { AppError } from "../errors";

/**
 * Which wall-clock a Community's programme actually runs in. Two
 * nullable columns — Community.timeZone and Cycle.timeZone — with the
 * per-event value inheriting the Community's, the same two-level shape
 * Community.defaultDateDisplayMode / Member.dateDisplayMode already
 * uses in display.ts.
 *
 * This is about *whose* clock a typed-in time belongs to, which is a
 * different question from *how a resolved date is written out*:
 * display.ts's `exact`/`period` setting is per-member presentation of a
 * date the Community has already agreed on, while this is the event
 * deciding what "14:00" means. A host proposing 14:00–15:30 is
 * describing a moment at the venue, not a moment in their own
 * timezone, so the event's zone is what both the picker and the saved
 * slot list have to speak.
 *
 * Stored slots stay absolute ISO instants regardless — nothing here
 * rewrites what's already in the database, and conflict detection keeps
 * comparing instants. This only decides how an instant is read back out
 * as a wall-clock.
 */
export const DEFAULT_TIME_ZONE = "UTC";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Whether two names mean the same zone. Compared as the runtime canonicalises
 * them, so an alias ("Europe/Kiev" and "Europe/Kyiv") doesn't read as a
 * difference; an unusable name only equals itself.
 */
export function sameTimeZone(a: string, b: string): boolean {
  const canonical = (zone: string) => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone;
    } catch {
      return zone;
    }
  };
  return canonical(a) === canonical(b);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The event's own zone if it has one, else the Community's, else UTC.
 *
 * An unusable value (a typo that somehow got stored, or an IANA zone
 * this runtime doesn't know) falls through rather than throwing: a
 * stale timezone shouldn't make a Community's whole programme
 * unreadable, and both write paths validate before storing, so the only
 * way to land here is a value that stopped being valid after the fact.
 */
export function effectiveTimeZone(
  event: { timeZone?: string | null } | null | undefined,
  community: { timeZone?: string | null },
): string {
  for (const candidate of [event?.timeZone, community.timeZone]) {
    if (candidate && isValidTimeZone(candidate)) return candidate;
  }
  return DEFAULT_TIME_ZONE;
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

// formatToParts is the only dependency-free way to read an instant as
// wall-clock fields in an arbitrary zone, and it's slow enough that
// building the formatter per call shows up on a page that renders one
// per proposal slot — so one formatter per zone, kept for the process.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  // hourCycle rather than hour12:false, which renders midnight as hour
  // 24 and would silently shift a midnight slot onto the previous day
  // when read back into a Date.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const out: Partial<ZonedParts> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) {
    // Narrowed to the keys we asked for: formatToParts types its `type`
    // as the union of every possible part kind, and only the six fields
    // above are ever populated by this formatter's own options.
    if (
      part.type === "year" ||
      part.type === "month" ||
      part.type === "day" ||
      part.type === "hour" ||
      part.type === "minute" ||
      part.type === "second"
    ) {
      out[part.type] = Number(part.value);
    }
  }
  return out as ZonedParts;
}

/** The calendar date an instant falls on, in the given zone, as YYYY-MM-DD. */
export function localDateInZone(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** 24-hour HH:mm an instant reads as, in the given zone. */
export function formatTimeInZone(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * The zone's offset from UTC at a given instant, in milliseconds —
 * found by formatting the instant into the zone, reading those
 * wall-clock fields back as though they were UTC, and taking the
 * difference. Positive east of Greenwich.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Truncate rather than round: the formatted parts carry whole-second
  // precision, so any sub-second remainder is an artifact of the
  // instant and would otherwise leak into the offset.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * A wall-clock in the given zone -> the instant it names. The input is
 * "YYYY-MM-DDTHH:mm", exactly what a `datetime-local` control yields.
 *
 * Two passes, because the offset depends on the instant and the
 * instant depends on the offset. The first guess uses the offset at the
 * naive UTC reading, which is wrong within a few hours of a DST
 * transition; re-reading the offset *at the candidate instant* and
 * applying it once more settles it. That second pass is what makes
 * "01:30 on the spring-forward morning" resolve to the pre-transition
 * instant rather than landing an hour out.
 */
export function instantFromZoned(local: string, timeZone: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(local);
  if (!match) {
    throw new AppError(`Not a date and time: ${local}`);
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(naive)) {
    throw new AppError(`Not a date and time: ${local}`);
  }
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), timeZone));
  return new Date(naive - zoneOffsetMs(firstGuess, timeZone));
}

/** The inverse of instantFromZoned, for pre-filling a datetime-local. */
export function localInputFromInstant(iso: string, timeZone: string): string {
  const p = zonedParts(new Date(iso), timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}
/**
 * Writing a moment out in a stated zone.
 *
 * Every function here takes the zone as an argument rather than reading
 * one, because the same instant is shown on two different clocks depending
 * on what it is: a shift or a programme slot is read on the venue's clock,
 * and a deadline or a message's timestamp on the viewer's own. Which one a
 * call site wants is a decision about the thing being shown, so it is
 * made at the call site and not guessed here.
 *
 * Month names and ordering are en-US, matching display.ts. Hours are
 * 24-hour, matching how the programme already reads (14:00, not 2:00 PM).
 */
import { isValidTimeZone, DEFAULT_TIME_ZONE } from "./timezone";

type Instant = Date | string | number;
export type InstantStyle = "datetime" | "date" | "time";

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, style: InstantStyle, zoneName: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${style}|${zoneName}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const options: Intl.DateTimeFormatOptions = { timeZone, hourCycle: "h23" };
  if (style !== "time") options.dateStyle = "medium";
  if (style !== "date") options.timeStyle = "short";
  if (zoneName && style !== "date") {
    // dateStyle/timeStyle can't be combined with timeZoneName, so the
    // fields are spelled out for that case.
    delete options.dateStyle;
    delete options.timeStyle;
    if (style === "datetime") {
      options.year = "numeric";
      options.month = "short";
      options.day = "numeric";
    }
    options.hour = "2-digit";
    options.minute = "2-digit";
    options.timeZoneName = "short";
  }
  const created = new Intl.DateTimeFormat("en-US", options);
  cache.set(key, created);
  return created;
}

function safeZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
}

/**
 * "Oct 9, 2026, 15:04" / "Oct 9, 2026" / "15:04". With `zoneName`, a
 * time carries its zone — "Oct 9, 2026, 15:04 GMT+2" — which is what a
 * deadline wants when it may be read by someone on another clock.
 */
export function formatInstant(
  instant: Instant,
  timeZone: string,
  style: InstantStyle = "datetime",
  options: { zoneName?: boolean } = {},
): string {
  return formatter(safeZone(timeZone), style, options.zoneName ?? false).format(new Date(instant));
}

/**
 * A start–end range: "Oct 9, 2026, 14:00–15:30", or with both dates when
 * it crosses midnight in the given zone.
 */
export function formatInstantRange(start: Instant, end: Instant, timeZone: string): string {
  const zone = safeZone(timeZone);
  const sameDay = formatInstant(start, zone, "date") === formatInstant(end, zone, "date");
  return `${formatInstant(start, zone)}–${sameDay ? formatInstant(end, zone, "time") : formatInstant(end, zone)}`;
}

import { INPUT } from "@/components/ui/kit";

// A free text field rather than a select of all ~600 IANA zones: the
// list is long enough that finding a zone in it is harder than typing
// it, and a datalist gets both — type "Europe/Lon" and the browser
// offers the match, or type a zone this runtime doesn't have in its list
// and it's still accepted. Validated on write wherever it's saved — see
// isValidTimeZone in src/lib/dates/timezone.ts.
export const COMMON_TIME_ZONES = [
  "UTC",
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Madrid",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Stockholm",
  "Europe/Warsaw",
  "Europe/Athens",
  "Europe/Istanbul",
  "Europe/Moscow",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "America/Halifax",
  "America/Sao_Paulo",
  "America/Mexico_City",
  "Africa/Cairo",
  "Africa/Lagos",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Asia/Jerusalem",
  "Asia/Dubai",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Perth",
  "Australia/Sydney",
  "Pacific/Auckland",
  "Pacific/Honolulu",
];

export default function TimeZoneInput({
  defaultValue,
  placeholder = "UTC",
  className = INPUT,
}: {
  defaultValue?: string | null;
  placeholder?: string;
  className?: string;
}) {
  return (
    <>
      <input
        type="text"
        name="timeZone"
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        list="time-zone-suggestions"
        className={className}
      />
      <datalist id="time-zone-suggestions">
        {COMMON_TIME_ZONES.map((zone) => (
          <option key={zone} value={zone} />
        ))}
      </datalist>
    </>
  );
}

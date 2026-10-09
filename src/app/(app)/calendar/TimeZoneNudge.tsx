"use client";

import { useEffect, useState } from "react";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "@/components/ui/kit";
import { setMyTimeZoneAction } from "../profile/actions";

const DISMISS_KEY = "orchard.timeZoneNudge.dismissed";

// Two names for the same zone ("Europe/Kiev" and "Europe/Kyiv") shouldn't
// read as a mismatch, so both sides are canonicalised by the runtime
// before they're compared.
function canonical(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
  } catch {
    return timeZone;
  }
}

/**
 * Notices when the browser is in a different zone from the one the
 * calendar is reading in, and offers to switch — once.
 *
 * Only the browser can know where the person actually is, which is why
 * this is client-side while the zone itself stays an explicit setting: the
 * calendar never silently follows the device. Dismissing remembers the
 * zone that was dismissed, not the fact that it was, so someone who
 * declined at home is asked again if their laptop later reports a
 * different zone. localStorage is a convenience here and nothing more; if
 * it's unavailable the prompt simply shows again.
 *
 * Renders nothing on the server and on first paint, so the page never
 * flashes a banner that the check then removes.
 */
export default function TimeZoneNudge({ currentZone }: { currentZone: string }) {
  const [detected, setDetected] = useState<string | null>(null);

  useEffect(() => {
    // Reading the browser's zone and localStorage is only possible after
    // mount, which is why this sets state from an effect.
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!browserZone || canonical(browserZone) === canonical(currentZone)) return;
    let dismissed: string | null = null;
    try {
      dismissed = window.localStorage.getItem(DISMISS_KEY);
    } catch {
      // Unavailable storage just means we ask again.
    }
    if (dismissed === browserZone) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetected(browserZone);
  }, [currentZone]);

  if (!detected) return null;

  function dismiss() {
    try {
      window.localStorage.setItem(DISMISS_KEY, detected ?? "");
    } catch {
      // Same as above.
    }
    setDetected(null);
  }

  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 text-[length:var(--text-body)] text-[var(--text)]"
    >
      <span>
        Your browser is in {detected}, but the calendar is reading in {currentZone}. Use {detected}?
      </span>
      <form action={setMyTimeZoneAction} className="flex items-center gap-2">
        <input type="hidden" name="timeZone" value={detected} />
        <button type="submit" className={BUTTON_PRIMARY}>
          Use {detected}
        </button>
        <button type="button" onClick={dismiss} className={BUTTON_GHOST}>
          Keep {currentZone}
        </button>
      </form>
    </div>
  );
}

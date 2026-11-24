"use client";

import { useSyncExternalStore } from "react";
import { daysPerPageForWidth } from "@/lib/shifts/views";

function subscribe(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

/**
 * How many day-columns the calendar fits at the current screen width (see
 * daysPerPageForWidth). The server can't know the width, so it — and the
 * first client render — use the narrowest layout, one day; the real count
 * follows as soon as the page hydrates. The calendar is the second view, so
 * it is normally opened after that and never seen jumping.
 */
export function useDaysPerPage(): number {
  return useSyncExternalStore(
    subscribe,
    () => daysPerPageForWidth(window.innerWidth),
    () => 1,
  );
}

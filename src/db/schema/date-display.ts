import { pgEnum } from "drizzle-orm/pg-core";

// Presentation only — this never changes the canonical date or its
// relative recipe. `exact` keeps the calendar date; `period` uses a
// period name plus weekday when the date belongs to a short, unambiguous
// period, with the exact date retained accessibly as a fallback.
export const dateDisplayModeEnum = pgEnum("date_display_mode", ["exact", "period"]);

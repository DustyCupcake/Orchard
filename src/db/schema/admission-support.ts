import { boolean, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { admission } from "./admission";
import { member } from "./member";

// docs/plans/admission-flow.md §2, "The support shortcut". A support is one member's
// word for one arrival: they know the person, or think they'd fit, and have said
// so once. It replaces the nomination model, which made people *wait* on
// supports; this is only a record, with no state and no deadline. N of them skip
// whatever is left of the lane's path and admit (never past a standing concern);
// fewer change nothing, and the person simply completes the path they entered on.
//
// Both marks can be set, neither can be unset: a support with no mark records
// nothing ("I clicked the button" is not social proof), and that is checked where
// it is written, in src/lib/recruitment/support.ts.
//
// Never read back to the person except as the name of who vouched, and shown to
// the evaluators whether or not the shortcut is reached.
export const admissionSupport = pgTable(
  "admission_support",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arrivalId: uuid("arrival_id")
      .notNull()
      .references(() => admission.id),
    supporterId: uuid("supporter_id")
      .notNull()
      .references(() => member.id),
    knowsPersonally: boolean("knows_personally").notNull().default(false),
    thinksGoodFit: boolean("thinks_good_fit").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One support per member per arrival, strengthened or corrected in place.
    uniqueIndex("admission_support_arrival_supporter_unique").on(t.arrivalId, t.supporterId),
  ],
);

import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";

// A cut of every Question that was queued (not yet bundled) for this
// Community at cutoffAt — see docs/spec.md's "Input rounds". Created
// only when there's at least one Question to bundle ("a round with
// nothing queued in it just doesn't fire" — see
// src/lib/input-rounds/scheduler.ts). The *current* round for a
// Community is just the one with the latest cutoffAt — creating a new
// round is what "closes" the previous one; there's no separate status
// column for that.
export const inputRound = pgTable("input_round", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull().defaultNow(),
});

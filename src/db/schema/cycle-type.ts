import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";

// A Community-defined label for grouping its own Cycles — Season,
// Reunion, Workday — mainly so a Tier's cycle_type_count criterion can
// count occurrences of one *kind* of cycle without a lighter gathering
// padding the number. See docs/spec.md's "Cycle type" and
// docs/development-plan.md's Phase 40. Optional throughout — a
// Community that never bothers with it just leaves every Cycle
// untyped.
export const cycleType = pgTable("cycle_type", {
  id: uuid("id").primaryKey().defaultRandom(),
  communityId: uuid("community_id")
    .notNull()
    .references(() => community.id),
  name: text("name").notNull(),
  // Spec's own data model calls this `default_pack_id → TaskPack` — a
  // "suggested starting pack" nudge, never enforced. No TaskPack table
  // exists yet (see docs/development-plan.md's "Beyond Phase 45" — Task
  // packs as a portable, cross-community mechanism are still unbuilt);
  // Phase 6's own clone-previous-cycle flow is explicitly "conceptually
  // the same mechanism as importing a pack" until a real one exists, so
  // this points at a specific Cycle instead, whose task set stands in
  // as "the pack" for now. Deliberately non-FK, validated only at the
  // app layer when set (must belong to this Community) — the same
  // pattern Community's own task/form pointers use, needed here for the
  // same reason: cycle.ts already has to import this file for
  // cycle_type_id, and this file importing cycle.ts back would be a
  // real circular import between the two schema files (this codebase's
  // consistent precedent, e.g. Community's conflictTeamTaskId/
  // spatialPlanningTaskId, is to break that with a non-FK pointer
  // rather than fight the one-directional-imports convention every
  // other multi-file lib module here also keeps). Purely a nudge:
  // nothing reads this to actually clone anything — see Phase 40's own
  // "no enforcement of a type's suggested pack."
  defaultSourceCycleId: uuid("default_source_cycle_id"),
  // Spec's own real field, now that a real TaskPack table exists (Phase
  // 55) — "suggested starting pack for a Cycle of this type." Same
  // non-FK reasoning as defaultSourceCycleId just above (task_pack.ts
  // already imports task.ts, which imports cycle.ts, which imports
  // this file — cycle_type.ts importing task_pack.ts back would cycle).
  // Deliberately kept alongside defaultSourceCycleId rather than
  // replacing it: an already-configured Community's existing "clone
  // this specific prior cycle" nudge isn't automatically a saved pack,
  // and nothing forces a migration between the two — a CycleType can
  // suggest either, or both, or neither.
  defaultPackId: uuid("default_pack_id"),
});

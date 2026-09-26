import { pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { community } from "./community";
import { member } from "./member";
import { permissionGrantModuleEnum } from "./permission-grant";

// "Everyone has this permission" — a Community's deliberate decision that
// a capability is open to all its members rather than carried by whoever
// holds a task granting it. See docs/open-permissions-plan.md.
//
// A row is the whole fact: "this Community has module M open". There is no
// grant row, because there is no task: a row here and a `permission_grant`
// row are independent facts about the same module, and a Community may have
// both (everyone can, and these people are the ones who chose to take it on)
// or either alone.
//
// **Why a separate table and not a nullable `permission_grant.taskId`.**
// Every resolver reaches authority the same way — `listGrantingTaskIds` →
// `inArray(task.id, ...)` → a `taskAssignment` join — so a NULL taskId there
// would match no assignment and grant *nothing*, which is indistinguishable
// from "correctly closed". A sentinel id would fail the same way and break
// the uuid typing besides. This table is unread by any of those paths, so a
// mistake in it can only fail closed (a flag nothing reads) rather than open.
// Phase 63's removal of nine `Community` columns is the same instinct: keep
// one source of truth per fact rather than several that can disagree.
//
// **Why not 14 booleans on `community`.** Same reason, and worse: those would
// be settable from a different tab than the one describing the role, free to
// disagree with the grant table. One narrow table keyed on the module enum
// keeps "this capability exists for this Community" in the same shape the
// existing grant table already uses.
//
// The PK is (community, module) rather than a surrogate id: double-opening is
// then a constraint violation instead of a duplicate fact, and a Community's
// whole open set is trivially one indexed range scan.
export const openPermissionGrant = pgTable(
  "open_permission_grant",
  {
    communityId: uuid("community_id")
      .notNull()
      .references(() => community.id),
    moduleKey: permissionGrantModuleEnum("module_key").notNull(),
    // Both are kept. `opened_by` answers "who decided the whole Community
    // could View-as anyone", which is the kind of fact worth being able to
    // reconstruct later; it is deliberately *not* extended into a general
    // settings audit log — that is its own piece of work (the plan's §9.1),
    // and this column is only the cheap half of it. Note the row is deleted
    // on close, so this records the opening, not the closing.
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => member.id),
  },
  (t) => [primaryKey({ columns: [t.communityId, t.moduleKey] })],
);

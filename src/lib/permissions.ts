import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db, type DbOrTx, type Tx } from "@/db";
import { conflictReport, member, openPermissionGrant, permissionGrant, task, taskAssignment } from "@/db/schema";
import type { member as memberTable } from "@/db/schema";
import { AppError, ConfirmationRequiredError, NotFoundError } from "./errors";
import { recordSettingChanges } from "./settings/history";

type Member = typeof memberTable.$inferSelect;

export const PERMISSION_MODULE_KEYS = [
  "admin",
  "branch_coordination",
  "community_coordination",
  "conflict_team",
  "feedback_review",
  "event_scheduling_owner",
  "recruitment",
  "recruitment_mediation",
  "spatial_planning",
  "announcements",
  "support",
  "backstop",
  "shift_management",
  "budget",
  "kitchen",
] as const;
export type PermissionModuleKey = (typeof PERMISSION_MODULE_KEYS)[number];

// Task and proposal flows may attach the ordinary module grants inline,
// but Budget authority is deliberately settings-only. Keeping that
// exception in one named list prevents a generic task/proposal checkbox
// or forged POST from becoming a second Budget-owner configuration path.
export const TASK_GRANTABLE_PERMISSION_MODULE_KEYS = PERMISSION_MODULE_KEYS.filter(
  (moduleKey) => moduleKey !== "budget",
);

// Human-readable label/description per module — the single source of
// truth for the settings panel's Access & permissions tab and the task
// and proposal grant controls where applicable (docs/plans/development-plan.md's
// Phase 64), so those surfaces never describe a gate two different ways.
export const PERMISSION_MODULE_LABELS: Record<PermissionModuleKey, string> = {
  admin: "Admin",
  branch_coordination: "Branch coordination",
  community_coordination: "Community coordination",
  conflict_team: "Conflict team",
  feedback_review: "Feedback review",
  event_scheduling_owner: "Programme owner",
  recruitment: "Recruitment",
  // Deliberately not "Recruitment (mediation)": the plan (§2.7/J8) makes
  // this a *separate* grant that a community can hand to a different
  // task from the one that evaluates applications, so a name that reads
  // as a sub-role of Recruitment would quietly re-couple the two the
  // moment someone looks at the settings panel. The hint below is the
  // exemplary text §2.7 asks for, and it says plainly what the holder
  // sees and decides.
  recruitment_mediation: "Recruitment mediation",
  spatial_planning: "Spatial planning",
  announcements: "Announcements",
  support: "Support (View-as)",
  backstop: "Backstop",
  shift_management: "Shift management",
  budget: "Budget",
  kitchen: "Kitchen",
};

// What each capability *is* — deliberately no scope rule restated per
// module. The scope rule is the one sentence every module in a section
// shares, and the settings panel states it once in the section header
// (see PERMISSION_MODULE_SECTIONS); a hint that repeated "placed in a
// cycle, it covers that cycle" thirteen times was pure repetition that
// buried the part that actually differs — what holding the role lets you
// do. Kept here (rather than inline in the panel) so the settings page
// stays the only place that has to know about sectioning.
export const PERMISSION_MODULE_HINTS: Record<PermissionModuleKey, string> = {
  admin:
    "Gates the whole settings screen. Holders must be endorsed by the community on the task itself, not just assigned.",
  branch_coordination:
    "Per branch, across every event. Waives requirements, sees escalations and talk-to-coordinator pings, approves join requests and nominations.",
  community_coordination:
    "The same as Branch coordination, except the branch never narrows it. Placed in an event, it coordinates that event; left outside one, it coordinates the whole community at once — the option for a small event that doesn't need a coordinator per branch.",
  conflict_team:
    "Reviews and acknowledges conflict reports. Reports can be filed with nobody set; nobody can review until it is.",
  feedback_review:
    "Sees feedback responses on /feedback.",
  event_scheduling_owner:
    "Reviews, confirms and publishes the Programme. Members can still submit proposals without this set.",
  recruitment:
    "Evaluates applications on /applications and the inquiry inbox on /invites.",
  recruitment_mediation:
    "Holder mediates recruitment objections (invite-consensus and evaluated-path alike), sees objector identities that are shielded from everyone else, and may exercise the majority overrule where the community has enabled it.",
  spatial_planning:
    "Draws and edits Zones. Nobody can until this is set — see /spatial-planning.",
  announcements:
    "Flips meaning by placement: unset, it gates community-wide announcements; in an event, it gates messages to that event's roster instead. Targeted messages work either way.",
  support:
    "View the platform exactly as another member would, read-only — see docs/spec.md's View-as.",
  backstop:
    "Named responsible for a scope's critical tasks — covering them, not closing them off. Unclaimed criticals stay claimable by anyone.",
  shift_management:
    "Opens sign-ups, confirms proposals and re-places series. A roster with no grant-backed manager stays visibly closed.",
  budget:
    "Edits the budget period while proposals are open, closes proposals, confirms the funded set and marks it done. Settings-only — never granted from a task or proposal.",
  kitchen:
    "Builds and publishes the menu, reviews the food-ideas inbox, and — once the allergies field is linked to this grant — reads member constraints. Members can still file food ideas without it.",
};

// The §2.2 tier table made concrete — how each module's authority
// follows the granted task's placement (§2.1). The settings panel and
// the task-detail form read this to render each grant's derived scope
// and to flag a community-shaped grant that sits in a cycle, rather
// than hard-coding per-module exceptions at each surface:
//   "community"     — community-shaped: cycle-less only. A cycle-placed
//                     instance is a contradiction the interface warns
//                     about (admin, conflict_team, support,
//                     community_coordination).
//   "cycle"         — cycle-shaped: placement *is* the scope. In cycle C
//                     → cycle C; cycle-less → the community/evergreen
//                     scope (branch_coordination, event_scheduling_owner,
//                     spatial_planning, backstop, shift_management,
//                     feedback_review, recruitment, budget).
//   "cycle_variant" — community-shaped base with an optional per-cycle
//                     variant: cycle-less → community-wide; cycle-placed
//                     → that cycle (announcements).
export type PermissionModuleScopeTier = "community" | "cycle" | "cycle_variant";

export const PERMISSION_MODULE_SCOPE_TIER: Record<PermissionModuleKey, PermissionModuleScopeTier> = {
  admin: "community",
  branch_coordination: "cycle",
  // The same rule as Branch coordination — placement is the scope, and a
  // task in an event is that event's coordinator — with exactly one
  // difference: the cycle-less form covers the *whole community* rather
  // than one branch. So it's cycle_variant: cycle-less → community-wide,
  // cycle-placed → that cycle. The branch is never part of the scope for
  // this module, so a granted task sitting in a branch has that branch
  // ignored.
  community_coordination: "cycle_variant",
  conflict_team: "community",
  feedback_review: "cycle",
  event_scheduling_owner: "cycle",
  recruitment: "cycle",
  // Community-shaped, mirroring conflict_team, and for the same reason
  // the plan gives (§2.7): mediation is a standing, relationship-shaped
  // authority even though the arrivals it mediates are not — an
  // objection to one event's invite is still mediated by the same
  // people who mediate an objection to an untagged application, and
  // scoping the body per event would fragment it into exactly the
  // per-event veto-by-inaction the redesign exists to end. It is also
  // multi-cardinality per scope (§2.7: "a mediation *team* is fine"),
  // see MULTI_CARDINALITY_MODULES below.
  recruitment_mediation: "community",
  spatial_planning: "cycle",
  announcements: "cycle_variant",
  support: "community",
  backstop: "cycle",
  shift_management: "cycle",
  budget: "cycle",
  kitchen: "cycle",
};

// How the settings panel groups the modules (the "Community-wide" and
// "Per-event" sections). The split is *derived* from the tier table
// rather than hand-listed, so a new module can never end up in no
// section or in two — the same one-source-of-truth discipline the rest
// of this file keeps. Only "community" earns its own section — those
// roles are whole-community *by definition* and an event placement is a
// contradiction, which is a genuinely different rule to explain. The
// "cycle" and "cycle_variant" tiers share the per-event section because
// the rule a reader needs is identical for both: placement is the scope,
// and leaving the event out means the community as a whole. The only
// difference between the two tiers is the wording of the derived label
// on the row, which describeGrantScope already states exactly.
export interface PermissionModuleSection {
  key: "community" | "cycle";
  title: string;
  // Stated once per section instead of once per module — the rule every
  // module in the section shares, which is what the per-module hints
  // used to each restate in full.
  rule: string;
  moduleKeys: PermissionModuleKey[];
}

function moduleKeysInSection(tier: PermissionModuleScopeTier): PermissionModuleKey[] {
  // Filtered off PERMISSION_MODULE_KEYS, so display order inside each
  // section always matches the declaration order above.
  return PERMISSION_MODULE_KEYS.filter((moduleKey) => PERMISSION_MODULE_SCOPE_TIER[moduleKey] === tier);
}

export const PERMISSION_MODULE_SECTIONS: readonly PermissionModuleSection[] = [
  {
    key: "community",
    title: "Community-wide",
    rule:
      "These roles cover the whole community, so keep the event unset. Whoever holds the task holds the role everywhere — a task placed in an event is a contradiction here, and the panel warns about it rather than silently ignoring it.",
    moduleKeys: moduleKeysInSection("community"),
  },
  {
    key: "cycle",
    title: "Per-event",
    rule:
      "Placement is the scope: a task in an event owns that event. The same task left outside every event covers the community as a whole — each row below shows which of the two it is.",
    moduleKeys: [...moduleKeysInSection("cycle"), ...moduleKeysInSection("cycle_variant")],
  },
];

// The derived-scope label a grant row shows (§5.1): the cycle the
// granting task is placed in, or — for a cycle-less task — "Community-
// wide" for a module whose authority is whole-community, and "Evergreen"
// for a cycle-shaped module's standing/community-less instance (§2.2).
export function describeGrantScope(
  moduleKey: PermissionModuleKey,
  cycleId: string | null,
  cycleName: string | null,
): string {
  if (cycleId) return cycleName ?? "that event";
  return PERMISSION_MODULE_SCOPE_TIER[moduleKey] === "cycle" ? "Evergreen" : "Community-wide";
}

// A community-shaped module whose granting task sits in a cycle — the
// contradiction §2.2 describes. The authority still applies (the server
// is the source of truth, D1), so this is a warning the interface shows,
// not a mistake it blocks.
export function isMisplacedCommunityGrant(moduleKey: PermissionModuleKey, cycleId: string | null): boolean {
  return PERMISSION_MODULE_SCOPE_TIER[moduleKey] === "community" && cycleId !== null;
}

// Modules where more than one task can simultaneously grant access
// (Phase 13/15/54's original tag-based gates) — every other module
// enforces at most one granting task, the same single-pointer
// cardinality its old Community column already had.
const MULTI_CARDINALITY_MODULES = new Set<PermissionModuleKey>([
  "admin",
  "branch_coordination",
  // A community can run both a community-wide coordinator and
  // per-branch coordinators at once — the small-event case wants the
  // former, a large one the latter, and plenty want the first as a
  // floor under the second. Same shape as branch_coordination.
  "community_coordination",
  "support",
  // D2 — one `kitchen` grant = full module access wherever granted; the
  // community may put it on however many tasks work in the module, none
  // of them replacing the others (branch_coordination's shape, not
  // budget's single-owner shape).
  "kitchen",
  // §2.7 — "multi-cardinality per scope (a mediation *team* is fine)".
  // A body that can be overruled-against is a body, not a single pair of
  // hands: a community that wanted one named mediator per objection
  // would have no threshold to compute and no peers to see the pattern
  // of a serial objector, which is the whole point of §2.6.
  "recruitment_mediation",
]);

export function allowsMultipleGrants(moduleKey: PermissionModuleKey): boolean {
  return MULTI_CARDINALITY_MODULES.has(moduleKey);
}

// Which task(s) currently grant this module for a Community — the one
// thing every one of the original fields/tags actually meant, and the
// one thing every enforcement check below reads instead of a Community
// column or a Task.tags match now. Scope is *not* an argument: it
// travels on the granting task's own placement (`task.cycleId` — see
// docs/plans/archive/cycle-scope-remediation-plan.md §2.1), so callers wanting a
// specific scope filter that themselves, either by scoping their join
// on task.cycleId (the per-cycle resolvers, e.g.
// src/lib/spatial-planning/access.ts) or through the
// listGrantingTaskIdsForScope helper below (the settings/spatial-
// planning "is anything designated in this scope?" checks).
export async function listGrantingTaskIds(
  communityId: string,
  moduleKey: PermissionModuleKey,
): Promise<string[]> {
  const rows = await db
    .select({ taskId: permissionGrant.taskId })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
  return rows.map((r) => r.taskId);
}

export async function listPermissionGrants(communityId: string, moduleKey: PermissionModuleKey) {
  return db
    .select()
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.moduleKey, moduleKey)));
}

// ---------------------------------------------------------------------------
// "Everyone has this permission" — the open-flag reads
// (docs/plans/archive/open-permissions-plan.md §2.2)
//
// The whole open-permissions mechanism rests on this file NOT changing how
// authority is resolved today. listGrantingTaskIds above is still the only
// thing that produces a task id for a module, and every resolver still
// reaches a person through a taskAssignment join — so an open module adds
// capability at the *front* of a resolver, it never rewrites the grant path.
// That is what makes a mistake here fail closed (a flag nothing reads) rather
// than open.
//
// Reads here are unfiltered by scope on purpose. An open module *is* the
// community/evergreen scope, which under the §2.1 rule is already a superset
// for the nine `cycle`-tier modules — so "is this open" needs no cycleId
// argument, and listGrantingTaskIdsForScope stays task-only (D15).

// Every module this Community has declared open to all its members. The one
// read a per-page settings view wants (the Access & permissions tab renders
// all 14 checkboxes from a single call), and cheap enough to be safe to call
// on any page that needs to know "is anything open at all" — notably
// src/lib/nav.ts, which would otherwise probe a module per page load.
export async function listOpenModuleKeys(communityId: string): Promise<Set<PermissionModuleKey>> {
  const rows = await db
    .select({ moduleKey: openPermissionGrant.moduleKey })
    .from(openPermissionGrant)
    .where(eq(openPermissionGrant.communityId, communityId));
  return new Set(rows.map((r) => r.moduleKey));
}

// The single enforcement call. A composite-PK lookup, so it is safe to call
// as the first line of any resolver — which is exactly how Step 4/5 of the
// plan intend to use it: open short-circuits, and the grant path is reached
// only when the module is closed.
export async function isModuleOpenToEveryone(
  communityId: string,
  moduleKey: PermissionModuleKey,
): Promise<boolean> {
  const [row] = await db
    .select({ moduleKey: openPermissionGrant.moduleKey })
    .from(openPermissionGrant)
    .where(
      and(eq(openPermissionGrant.communityId, communityId), eq(openPermissionGrant.moduleKey, moduleKey)),
    )
    .limit(1);
  return Boolean(row);
}

// Who currently *holds* a set of granting tasks — the distinct, non-shadow
// members on them. `isShadow: false` is the same filter every resolver
// applies: a shadow is a placeholder learning the work, not someone doing it,
// so counting one as a holder would overstate who can actually act.
//
// This is deliberately a task-id list and not a
// (communityId, moduleKey, scope) signature. Scope-awareness comes from
// *which* id-list the caller passes — listGrantingTaskIds for the
// community-wide case, listGrantingTaskIdsForScope for one scope — rather
// than from a parameter that would have to mean branch for coordination,
// cycle for most modules, and nothing for the `community` tier. Reusing the
// scope split the codebase already has beats adding a second one.
//
// Distinct by member, not by assignment: two grants held by the same person
// are one holder, and that is the number the plan's D12/D14 both need — the
// settings tab's "N people hold this" and "resolves to more than one person"
// are the same count.
export async function listHoldersOfTasks(taskIds: readonly string[]): Promise<{ memberId: string; name: string }[]> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select({ memberId: member.id, name: member.name })
    .from(taskAssignment)
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .where(and(inArray(taskAssignment.taskId, [...taskIds]), eq(taskAssignment.isShadow, false)));
  const byMember = new Map(rows.map((r) => [r.memberId, r]));
  return [...byMember.values()];
}

// The count form, for the callers that only need "is it more than one?" —
// the plan's D12 shared/personal decision and the nav short-circuit. Derived
// from listHoldersOfTasks rather than issued as a second COUNT query so the
// number can't disagree with the names the settings tab renders beside it.
export async function countHoldersOfTasks(taskIds: readonly string[]): Promise<number> {
  return (await listHoldersOfTasks(taskIds)).length;
}

// What opening each of these to everyone does, in the words the settings
// screen shows beside the checkbox and the server repeats when it refuses
// without confirmation. They are the two modules that genuinely change what
// the whole community can do (D13); every other module's open state widens a
// permission without widening who can change the rules themselves.
export const OPEN_BLAST_RADIUS: Partial<Record<PermissionModuleKey, string>> = {
  support:
    "Opening View-as means every member will be able to view the platform read-only, exactly as any other member would — including the people who hold sensitive-data and permission access.",
  admin: "Opening Admins means every member will be able to change every setting, including who holds which permissions.",
};

// How many conflict reports every member of the team can currently read:
// the two states in which visibility widens from "the reporter and the
// point of contact" to the whole non-excluded team (see listConflictReports
// in conflict.ts — unacknowledged, or escalated). Opening `conflict_team` to
// everyone makes every member part of that team, so this is exactly the
// number of reports whose readership it would change.
//
// Lives here and not in conflict.ts because conflict.ts imports this file,
// and the count is needed by setModuleOpen.
export async function countConflictReportsVisibleToWholeTeam(communityId: string, executor: DbOrTx = db) {
  const [row] = await executor
    .select({ n: sql<number>`count(*)::int` })
    .from(conflictReport)
    .where(
      and(
        eq(conflictReport.communityId, communityId),
        or(isNull(conflictReport.acknowledgedAt), eq(conflictReport.escalated, true)),
      ),
    );
  return row?.n ?? 0;
}

// Writes the open flag, or clears it when `open` is false. One upsert/delete
// rather than a separate set/clear pair: the row's whole existence is the
// fact, so there is nothing for a "replace" to distinguish (contrast
// setPermissionGrant, where a *task* can move between scopes while the grant
// row persists).
//
// Returns false when the module cannot be opened, so the caller can report
// the refusal rather than silently doing nothing.
// Takes an actor for the same reason as the three grant functions below:
// the log needs a member id, and taking it as a parameter means a call site
// cannot forget. `openedBy` was the member id this already needed, so it is
// now derived from the actor rather than passed alongside it.
export async function setModuleOpen(
  actor: Member,
  moduleKey: PermissionModuleKey,
  open: boolean,
  options: { confirmedReportExposure?: boolean; confirmedBlastRadius?: boolean } = {},
): Promise<boolean> {
  const communityId = actor.communityId;
  if (open && !isOpenableModule(moduleKey)) return false;

  await db.transaction(async (tx) => {
    // Two kinds of "this is more than a checkbox" are enforced here rather
    // than in the settings UI, because a confirmation that lives only in the
    // browser is one a forged POST skips: the two modules whose open state
    // changes what the whole community can do (admin, support), and the
    // conflict team when it would expose reports that already exist.
    if (open && !options.confirmedBlastRadius && OPEN_BLAST_RADIUS[moduleKey]) {
      const alreadyOpen = await tx
        .select({ moduleKey: openPermissionGrant.moduleKey })
        .from(openPermissionGrant)
        .where(and(eq(openPermissionGrant.communityId, communityId), eq(openPermissionGrant.moduleKey, moduleKey)));
      if (alreadyOpen.length === 0) {
        throw new ConfirmationRequiredError(`${OPEN_BLAST_RADIUS[moduleKey]} Tick the box to confirm.`);
      }
    }
    if (open && moduleKey === "conflict_team" && !options.confirmedReportExposure) {
      const alreadyOpen = await tx
        .select({ moduleKey: openPermissionGrant.moduleKey })
        .from(openPermissionGrant)
        .where(and(eq(openPermissionGrant.communityId, communityId), eq(openPermissionGrant.moduleKey, moduleKey)));
      if (alreadyOpen.length === 0) {
        const exposed = await countConflictReportsVisibleToWholeTeam(communityId, tx);
        if (exposed > 0) {
          throw new ConfirmationRequiredError(
            `${exposed} existing conflict ${exposed === 1 ? "report is" : "reports are"} unacknowledged or escalated, which means every team member can read ${exposed === 1 ? "it" : "them"} — and opening this makes everyone a team member. A report is hidden from the people its reporter excluded when it was filed, but the reporter could only pick from the team as it was then, so anyone it concerns who wasn't on that team is not excluded. Acknowledge or resolve ${exposed === 1 ? "it" : "them"} first, or tick the box to open it anyway.`,
          );
        }
      }
    }
    if (open) {
      // `.onConflictDoNothing()` means an already-open module inserts
      // nothing, so the log line has to key off whether the row is
      // actually new — otherwise re-ticking a ticked box writes a change
      // that never happened.
      const inserted = await tx
        .insert(openPermissionGrant)
        .values({ communityId, moduleKey, openedBy: actor.id })
        .onConflictDoNothing()
        .returning({ moduleKey: openPermissionGrant.moduleKey });
      if (inserted.length > 0) {
        await recordSettingChanges(tx, {
          actor,
          entity: "open_permission_grant",
          action: "created",
          // No entityId: open_permission_grant is keyed on
          // (community_id, module_key) and has no surrogate id of its own.
          entityId: null,
          entityLabel: PERMISSION_MODULE_LABELS[moduleKey],
          current: {},
          changes: { moduleKey, open: true },
        });
      }
    } else {
      const deleted = await tx
        .delete(openPermissionGrant)
        .where(
          and(eq(openPermissionGrant.communityId, communityId), eq(openPermissionGrant.moduleKey, moduleKey)),
        )
        .returning({ moduleKey: openPermissionGrant.moduleKey });
      if (deleted.length > 0) {
        await recordSettingChanges(tx, {
          actor,
          entity: "open_permission_grant",
          action: "deleted",
          entityId: null,
          entityLabel: PERMISSION_MODULE_LABELS[moduleKey],
          current: { moduleKey, open: true },
          changes: { moduleKey, open: false },
        });
      }
    }
  });
  return true;
}

// The one module with no open path (D11). `backstop`'s authority is a *named
// person* to notify — notifyBackstopOfHardFlag emails the single member
// resolveBackstopHolder picked — and the task detail page names the same one,
// so a backstop with no name has nothing to do. Enforced here, at the write,
// and again in the settings UI (which renders no checkbox) so the two can't
// drift; deliberately NOT in the schema, since the enum has to keep carrying
// the key for the rest of the module to work.
//
// D11 is the only exclusion. It was originally reasoned as a *power* problem —
// that excluding another person should stay task-gated — and that reasoning
// was wrong: an open conflict_team already lets any member acknowledge a
// report and then resolve it (resolveConflictReport has no team check at all),
// which is strictly more authority than recusal, so gating recusal harder
// would have protected nothing.
export const NON_OPENABLE_MODULE_KEYS: ReadonlySet<PermissionModuleKey> = new Set(["backstop"]);

export function isOpenableModule(moduleKey: PermissionModuleKey): boolean {
  return !NON_OPENABLE_MODULE_KEYS.has(moduleKey);
}

// Holder counts for the settings tab's Access & permissions rows (D14).
// Keyed by task id, deliberately *not* the distinct-member form
// listHoldersOfTasks uses: each row has to answer "who holds *this* task",
// and a member holding two of the same module's tasks appears in both rows —
// whereas the D12 count needs them once.
export async function listHoldersByTaskId(
  taskIds: readonly string[],
): Promise<Map<string, { memberId: string; name: string }[]>> {
  type Holder = { memberId: string; name: string };
  const byTask = new Map<string, Map<string, Holder>>();
  if (taskIds.length === 0) return new Map();
  const rows = await db
    .select({ taskId: taskAssignment.taskId, memberId: member.id, name: member.name })
    .from(taskAssignment)
    .innerJoin(member, eq(member.id, taskAssignment.memberId))
    .where(and(inArray(taskAssignment.taskId, [...taskIds]), eq(taskAssignment.isShadow, false)));
  for (const r of rows) {
    const forTask = byTask.get(r.taskId) ?? new Map<string, Holder>();
    forTask.set(r.memberId, { memberId: r.memberId, name: r.name });
    byTask.set(r.taskId, forTask);
  }
  return new Map([...byTask].map(([taskId, m]) => [taskId, [...m.values()] as Holder[]]));
}


// Every grant across every module for a Community, with just enough
// task info (title, branchId, and the granted task's *placement*) to
// render a human-readable row — the settings panel's Access &
// permissions tab groups these by module and shows the derived scope
// ("cycle name, or community-wide" per task.cycleId), and a task's own
// edit/proposal-activation screen scans them to warn when checking a
// single-cardinality module would move it off another task in the same
// scope. cycleId is the granting task's `task.cycleId` (the one scope
// read, docs/plans/archive/cycle-scope-remediation-plan.md §2.1) — `permission_grant`
// carries no cycle column anymore (migration D8). Branch *name* is
// deliberately left to the caller (every one of these three screens
// already has its own branch list in hand) rather than joining branch
// here too.
export async function listGrantsWithTaskInfo(communityId: string) {
  return db
    .select({
      moduleKey: permissionGrant.moduleKey,
      taskId: permissionGrant.taskId,
      title: task.title,
      branchId: task.branchId,
      cycleId: task.cycleId,
    })
    .from(permissionGrant)
    .innerJoin(task, eq(task.id, permissionGrant.taskId))
    .where(eq(permissionGrant.communityId, communityId));
}

// The scope-aware "is anything designated in this scope?" check the
// spatial-planning page needs to render its "No Spatial-planning task
// designated yet" warning per cycle being viewed — filters the module's
// granting tasks by *their* placement (cycleId = null → cycle-less
// community/evergreen tasks only; a real id → tasks placed in that
// cycle). Plain listGrantingTaskIds covers the "any scope at all" form
// (nav/dashboard/conflict-team read paths never care which scope).
export async function listGrantingTaskIdsForScope(
  communityId: string,
  moduleKey: PermissionModuleKey,
  cycleId: string | null,
): Promise<string[]> {
  const grantingTaskIds = await listGrantingTaskIds(communityId, moduleKey);
  if (grantingTaskIds.length === 0) return [];
  const rows = await db
    .select({ id: task.id })
    .from(task)
    .where(
      and(
        inArray(task.id, grantingTaskIds),
        cycleId === null ? isNull(task.cycleId) : eq(task.cycleId, cycleId),
      ),
    );
  return rows.map((r) => r.id);
}

// Which modules a specific task currently grants — what the task
// detail view's "Permissions granted by this task" checkboxes diff
// their submission against.
export async function listModuleKeysGrantedByTask(
  communityId: string,
  taskId: string,
): Promise<Set<PermissionModuleKey>> {
  const rows = await db
    .select({ moduleKey: permissionGrant.moduleKey })
    .from(permissionGrant)
    .where(and(eq(permissionGrant.communityId, communityId), eq(permissionGrant.taskId, taskId)));
  return new Set(rows.map((r) => r.moduleKey));
}

// Placement-derived scope has no database row of its own to lock, and
// PermissionGrant has no unique key from which PostgreSQL can derive the
// Cycle scope. These transaction-scoped advisory locks are the concurrency
// boundary instead:
//
//   - the task lock serializes grant changes with a placement change on that
//     same task (src/lib/tasks/crud.ts uses this same helper);
//   - the scope lock serializes replacements between different tasks in one
//     exact `(community, module, cycle-or-NULL)` scope.
//
// Hash collisions only over-serialize two unrelated scopes; they can never
// let two replacements into the same scope run concurrently. The scope keys
// are sorted before acquisition so two task moves involving several modules
// cannot deadlock by taking the same locks in opposite orders.
const TASK_LOCK_NAMESPACE = "orchard:permission-grant:task:v1";
const SCOPE_LOCK_NAMESPACE = "orchard:permission-grant:scope:v1";

function grantScopeLockIdentity(scope: SingleCardinalityGrantScope) {
  return JSON.stringify([scope.communityId, scope.moduleKey, scope.cycleId]);
}

async function acquireAdvisoryTransactionLock(tx: Tx, namespace: string, identity: string) {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtext(${namespace}), hashtext(${identity}))
  `);
}

// Shared with task placement updates. All cooperating operations take this
// before reading the task's current placement, then take any affected scope
// locks in sorted order.
export async function lockPermissionGrantTask(tx: Tx, taskId: string) {
  await acquireAdvisoryTransactionLock(tx, TASK_LOCK_NAMESPACE, taskId);
}

export type SingleCardinalityGrantScope = {
  communityId: string;
  moduleKey: PermissionModuleKey;
  cycleId: string | null;
};

export async function lockSingleCardinalityGrantScopes(
  tx: Tx,
  scopes: readonly SingleCardinalityGrantScope[],
) {
  const identities = [...new Set(scopes.map(grantScopeLockIdentity))].sort();
  for (const identity of identities) {
    await acquireAdvisoryTransactionLock(tx, SCOPE_LOCK_NAMESPACE, identity);
  }
}

// Defense in depth, not just a UI-layer check — the same "the lib
// function re-validates, it doesn't just trust whatever the caller
// already checked" posture this codebase's other write paths already
// take (e.g. Phase 25/26/36's own field-validation bug fixes). A
// caller with direct programmatic access (a test, a future script)
// should get the same real NotFoundError a cross-community task ID
// would have thrown under the old updateCommunity validation.
async function requireTaskInCommunity(tx: Tx, communityId: string, taskId: string) {
  const [row] = await tx
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
  if (!row) {
    throw new NotFoundError("Task not found in your community");
  }
}

// Single-cardinality modules only — makes taskId *the* task granting
// this module, replacing whatever task currently grants it in the same
// scope (docs/plans/archive/cycle-scope-remediation-plan.md §2.1/§2.3). The scope is
// not an argument: it comes from where the granted task itself sits
// (`task.cycleId`) — a task placed in cycle C grants cycle C only, a
// cycle-less task is the community/evergreen role — so the replacement
// set is "every other grant of this module whose granting task sits in
// that same scope." Cycle A's owner and cycle B's owner thus still
// coexist as two separate rows (each task placed in its own cycle),
// but two tasks placed in the same cycle can never both grant the same
// module: the second setPermissionGrant silently replaces the first,
// exactly like the old single-pointer-column semantics. Clearing a
// grant is removePermissionGrant(communityId, moduleKey, taskId) — the
// old null-taskId "clear" branch of this function is gone (there is no
// cycle-scope argument to omit, so "clear the community-wide one" has
// nothing left to mean). Never call this for a multi-cardinality
// module (admin/branch_coordination/support) — it would silently drop
// every other task already granting it; use addPermissionGrant instead.
// The three grant functions below take an actor rather than a bare
// communityId. That is a signature change with a single purpose: the
// change log needs a member id for every row, and taking it as a parameter
// means no call site can forget it. Every existing caller already had an
// actor in hand and was passing `actor.communityId`, so nothing had to be
// threaded down — which is the good version of this change. It is worth
// saying that out loud because the bad version (an optional actor, logged
// only when present) would have compiled too, and would have made the audit
// trail quietly conditional, which is the one thing it must not be.
export async function setPermissionGrant(
  actor: Member,
  moduleKey: PermissionModuleKey,
  taskId: string,
): Promise<void> {
  const communityId = actor.communityId;
  if (allowsMultipleGrants(moduleKey)) {
    throw new AppError(`${PERMISSION_MODULE_LABELS[moduleKey]} grants may coexist; use addPermissionGrant`);
  }

  await db.transaction(async (tx) => {
    // Freeze this task's placement before deriving its scope. updateTask
    // takes this same lock before changing cycleId, so the placement read
    // below and the scope lock cannot disagree with a concurrent move.
    await lockPermissionGrantTask(tx, taskId);
    await requireTaskInCommunity(tx, communityId, taskId);

    // The one scope read (§2.1): the granted task's own placement.
    const [grantingTask] = await tx
      .select({ cycleId: task.cycleId })
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
    const scopeCycleId = grantingTask.cycleId;
    await lockSingleCardinalityGrantScopes(tx, [
      { communityId, moduleKey, cycleId: scopeCycleId },
    ]);

    const sameScopeTaskIds = await tx
      .select({ id: task.id })
      .from(task)
      .where(
        and(
          eq(task.communityId, communityId),
          scopeCycleId === null ? isNull(task.cycleId) : eq(task.cycleId, scopeCycleId),
        ),
      );
    const removed = await tx
      .delete(permissionGrant)
      .where(
        and(
          eq(permissionGrant.communityId, communityId),
          eq(permissionGrant.moduleKey, moduleKey),
          inArray(
            permissionGrant.taskId,
            sameScopeTaskIds.map((r) => r.id),
          ),
        ),
      )
      .returning({ taskId: permissionGrant.taskId });
    await tx.insert(permissionGrant).values({ communityId, moduleKey, taskId });

    // A set on a single-cardinality module is a *replacement*, and the row
    // that got replaced is the interesting half: "budget moved from the
    // Autumn rota to the Spring rota" is the whole content of this change,
    // and logging only the new holder would record the destination and lose
    // the journey. So both ends go in one row, and the removed task's title
    // is resolved because the new holder's title alone can't say what it
    // replaced.
    //
    // `removed.length > 0` is the test, not the resolved title's presence:
    // the first-ever grant of a module also reaches this code, and calling
    // it "updated" would put a replacement in the log where there was no
    // predecessor. Both rows then read `created`, which is what the
    // per-field diff already says via its null oldValue.
    const [replaced] = removed.length
      ? await tx
          .select({ title: task.title })
          .from(task)
          .where(inArray(task.id, removed.map((r) => r.taskId)))
          .limit(1)
      : [undefined];
    const [held] = await tx.select({ title: task.title }).from(task).where(eq(task.id, taskId));

    await recordSettingChanges(tx, {
      actor,
      entity: "permission_grant",
      action: removed.length > 0 ? "updated" : "created",
      entityId: null,
      entityLabel: PERMISSION_MODULE_LABELS[moduleKey],
      current: { moduleKey, grantingTask: replaced?.title ?? null },
      changes: { moduleKey, grantingTask: held?.title ?? taskId },
    });
  });
}

// Multi-cardinality modules — adds one more granting task without
// touching any others already granting the same module. A no-op if
// this exact (community, module, task) grant already exists.
export async function addPermissionGrant(
  actor: Member,
  moduleKey: PermissionModuleKey,
  taskId: string,
): Promise<void> {
  const communityId = actor.communityId;
  if (!allowsMultipleGrants(moduleKey)) {
    throw new AppError(`${PERMISSION_MODULE_LABELS[moduleKey]} allows one granting task per scope; use setPermissionGrant`);
  }

  await db.transaction(async (tx) => {
    await lockPermissionGrantTask(tx, taskId);
    await requireTaskInCommunity(tx, communityId, taskId);
    const existing = await tx
      .select({ id: permissionGrant.id })
      .from(permissionGrant)
      .where(
        and(
          eq(permissionGrant.communityId, communityId),
          eq(permissionGrant.moduleKey, moduleKey),
          eq(permissionGrant.taskId, taskId),
        ),
      );
    // Already there: no row, and no log line either. The function is
    // documented as a no-op in this case, and a log line for a change that
    // did not happen is the fastest way to make a log untrustworthy.
    if (existing.length === 0) {
      await tx.insert(permissionGrant).values({ communityId, moduleKey, taskId });
      const [held] = await tx.select({ title: task.title }).from(task).where(eq(task.id, taskId));
      await recordSettingChanges(tx, {
        actor,
        entity: "permission_grant",
        action: "created",
        entityId: null,
        entityLabel: PERMISSION_MODULE_LABELS[moduleKey],
        current: {},
        changes: { moduleKey, grantingTask: held?.title ?? taskId },
      });
    }
  });
}

// Remove a specific task's grant of this module — the plain inverse of
// setPermissionGrant (and of addPermissionGrant for the multi-
// cardinality modules). No cycle argument: the grant row is keyed by
// task, and the scope it covered was just that task's placement, so
// removing the row removes the whole grant.
//
// Removing the *last* Admins grant is the one removal that changes who is
// allowed to do things community-wide rather than who holds a role: with no
// Admins task left, settings go back to being editable by every member (see
// requireAdmins). That is the intended way back from a community with no
// working Admins task, so it is allowed — but it must be meant, so it needs
// `confirmedLastAdmin`, and says what it will do when it doesn't have it.
export async function removePermissionGrant(
  actor: Member,
  moduleKey: PermissionModuleKey,
  taskId: string,
  options: { confirmedLastAdmin?: boolean } = {},
): Promise<void> {
  const communityId = actor.communityId;
  await db.transaction(async (tx) => {
    await lockPermissionGrantTask(tx, taskId);
    await requireTaskInCommunity(tx, communityId, taskId);

    if (moduleKey === "admin" && !options.confirmedLastAdmin) {
      const remaining = await tx
        .select({ id: permissionGrant.id })
        .from(permissionGrant)
        .where(
          and(
            eq(permissionGrant.communityId, communityId),
            eq(permissionGrant.moduleKey, "admin"),
            ne(permissionGrant.taskId, taskId),
          ),
        );
      const [thisOne] = await tx
        .select({ id: permissionGrant.id })
        .from(permissionGrant)
        .where(
          and(
            eq(permissionGrant.communityId, communityId),
            eq(permissionGrant.moduleKey, "admin"),
            eq(permissionGrant.taskId, taskId),
          ),
        );
      if (thisOne && remaining.length === 0) {
        throw new ConfirmationRequiredError(
          "This is the last Admins grant. Removing it means every member can change community settings until a new one is added. Tick the box to confirm.",
        );
      }
    }

    // Read the task's placement to derive the scope for locking
    const [grantingTask] = await tx
      .select({ cycleId: task.cycleId })
      .from(task)
      .where(and(eq(task.id, taskId), eq(task.communityId, communityId)));
    const scopeCycleId = grantingTask.cycleId;
    await lockSingleCardinalityGrantScopes(tx, [
      { communityId, moduleKey, cycleId: scopeCycleId },
    ]);

    // `.returning()` because removing a grant that wasn't there changes
    // nothing, and a log line for a no-op removal would be a false entry —
    // "budget revoked from the Autumn rota" when it was never held.
    const removed = await tx
      .delete(permissionGrant)
      .where(
        and(
          eq(permissionGrant.communityId, communityId),
          eq(permissionGrant.moduleKey, moduleKey),
          eq(permissionGrant.taskId, taskId),
        ),
      )
      .returning({ id: permissionGrant.id });

    if (removed.length > 0) {
      const [held] = await tx.select({ title: task.title }).from(task).where(eq(task.id, taskId));
      await recordSettingChanges(tx, {
        actor,
        entity: "permission_grant",
        action: "deleted",
        entityId: null,
        entityLabel: PERMISSION_MODULE_LABELS[moduleKey],
        current: { moduleKey, grantingTask: held?.title ?? taskId },
        changes: { moduleKey, grantingTask: null },
      });
    }
  });
}

// The shared core of cycle clone and task-pack import
// (docs/plans/archive/cycle-scope-remediation-plan.md §4.4): a copied task keeps the
// ordinary module grants its source had, as new bare { communityId,
// moduleKey, taskId } rows keyed by the copy's task id. No scope is copied
// — the copy's own placement re-scopes everything (§2.1). Budget is the
// deliberate exception: it is a settings-only, cycle-scoped authority, so
// cloning/importing must never appoint an owner for the destination scope;
// an Admin designates it explicitly in Settings → Access & permissions.
export async function copyPermissionGrants(
  tx: Tx,
  communityId: string,
  moduleKeysByTask: Map<string, readonly PermissionModuleKey[]>,
): Promise<void> {
  const rows: { communityId: string; moduleKey: PermissionModuleKey; taskId: string }[] = [];
  for (const [taskId, moduleKeys] of moduleKeysByTask) {
    for (const moduleKey of moduleKeys) {
      if (moduleKey === "budget") continue;
      rows.push({ communityId, moduleKey, taskId });
    }
  }
  if (rows.length === 0) return;
  await tx.insert(permissionGrant).values(rows);
}

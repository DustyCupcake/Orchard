import type { NavContext } from "@/lib/nav";

export type ModuleKey = keyof NavContext["visibleModules"];

export type NavItem = {
  key: string;
  label: string;
  href: string;
  icon: string;
  // Item only renders when this module flag is true. Absent = always visible.
  moduleKey?: ModuleKey;
  // Item only renders for a coordination-view holder. Absent = visible to everyone.
  coordinatorOnly?: boolean;
};

export type NavGroup = {
  key: string;
  label: string;
  icon: string;
  items: NavItem[];
  // Only meaningful when headerIsLink is true: names the group's "main
  // view" explicitly (Tasks → /board, a genuine hub page with its own
  // button row to the rest of the group). Falls back to the group's
  // first item when headerIsLink is true but this is absent (Community
  // → /members — no real hub page, just "whatever's first").
  href?: string;
  // Two distinct header styles, picked per group by what its items
  // actually are — see AppShell.tsx's NavGroupBlock:
  //  - true: items are lightweight views into one domain, not
  //    individually meaningful destinations to pin — the header becomes
  //    a real link (icon + label) with a separate chevron for expand/
  //    collapse, and items lose their own icons (indented text only),
  //    since the header's icon already stands for the whole category.
  //    Tasks and Community use this.
  //  - false/absent: items are substantial, independently pinnable
  //    destinations (each a full module) — the header stays a plain
  //    uppercase toggle-only label, and each item keeps its own icon so
  //    it reads the same whether reached via this list or via a pin.
  //    Modules uses this.
  headerIsLink?: boolean;
};

export const DASHBOARD_ITEM: NavItem = { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home" };
export const CALENDAR_ITEM: NavItem = { key: "calendar", label: "Calendar", href: "/calendar", icon: "calendar" };
export const SETTINGS_ITEM: NavItem = { key: "settings", label: "Settings", href: "/settings", icon: "gear" };

// Calendar is a single aggregating read view (Phase 44) — it has no
// sub-pages of its own, unlike the groups below, so it sits at the top
// level alongside Dashboard/Settings rather than as a group. Everything
// that used to live under a "Calendar" group but is actually its own
// working surface (submit a poll response, sign up for a shift, review
// an event proposal, answer an input round) moved to whichever group
// matches what kind of surface it is — see each item's new home below.
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "tasks",
    label: "Tasks",
    icon: "check",
    // The board is "the main task view" — most of this group's other
    // destinations are also reachable as buttons from there; this
    // sub-list is the alternate way to get to them. See board/page.tsx.
    href: "/board",
    headerIsLink: true,
    items: [
      { key: "board", label: "Board", href: "/board", icon: "check" },
      { key: "propose", label: "Propose a task", href: "/propose", icon: "check" },
      { key: "proposals", label: "Proposals", href: "/proposals", icon: "check" },
      { key: "contribution", label: "My contribution", href: "/contribution", icon: "check" },
      { key: "coordination", label: "Coordination", href: "/coordination", icon: "check", coordinatorOnly: true },
      { key: "escalation", label: "Escalation", href: "/escalation", icon: "check", coordinatorOnly: true },
      // An input round is questions posed against a task — a task-side
      // mechanic, unlike Scheduling polls (moved to a button on
      // /calendar instead: it's about when things happen, not the task
      // itself).
      { key: "input-rounds", label: "Input rounds", href: "/input-rounds", icon: "check" },
    ],
  },
  {
    key: "community",
    label: "Community",
    icon: "people",
    headerIsLink: true,
    items: [
      { key: "members", label: "Members", href: "/members", icon: "people" },
      { key: "messages", label: "Messages", href: "/messages", icon: "mail" },
      { key: "assemblies", label: "Assemblies", href: "/assemblies", icon: "people" },
      { key: "documentation", label: "Documentation", href: "/documentation", icon: "people" },
      { key: "feedback", label: "Feedback", href: "/feedback", icon: "people", moduleKey: "feedback" },
      // The community's relationship to Cycles over time — history,
      // current-cycle composition/participation stats — with a
      // member's own participation declaration as one part of that,
      // not a separate destination. Cycle-scoped data (who's part of
      // it), as distinct from Calendar's when-things-happen dates.
      { key: "cycles", label: "Cycles", href: "/participation", icon: "cycle" },
    ],
  },
  {
    key: "modules",
    label: "Modules",
    icon: "grid",
    items: [
      { key: "budget", label: "Budget", href: "/budget", icon: "budget", moduleKey: "budget" },
      {
        key: "spatial-planning",
        label: "Spatial planning",
        href: "/spatial-planning",
        icon: "map",
        moduleKey: "spatialPlanning",
      },
      // Invites/Applications are reachable from within Recruitment
      // itself (its own tabs/links), not separate nav destinations.
      {
        key: "recruitment",
        label: "Recruitment",
        href: "/recruitment",
        icon: "recruitment",
        moduleKey: "recruitment",
      },
      {
        key: "conflict-reports",
        label: "Conflict reports",
        href: "/conflict-reports",
        icon: "handshake",
        moduleKey: "conflictReports",
      },
      {
        key: "sensitive-data",
        label: "Sensitive data",
        href: "/sensitive-data",
        icon: "shield",
        moduleKey: "sensitiveData",
      },
      { key: "schedule", label: "Event schedule", href: "/schedule", icon: "calendarHeart", moduleKey: "eventScheduling" },
      { key: "shifts", label: "Shifts", href: "/shifts", icon: "clipboardText", moduleKey: "shifts" },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = [DASHBOARD_ITEM, CALENDAR_ITEM, SETTINGS_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)];

export function isItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (item.coordinatorOnly && !ctx.isCoordinator) return false;
  if (item.moduleKey && !ctx.visibleModules[item.moduleKey]) return false;
  return true;
}

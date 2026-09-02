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
    items: [
      { key: "board", label: "Board", href: "/board", icon: "check" },
      { key: "propose", label: "Propose a task", href: "/propose", icon: "check" },
      { key: "proposals", label: "Proposals", href: "/proposals", icon: "check" },
      { key: "contribution", label: "My contribution", href: "/contribution", icon: "check" },
      { key: "coordination", label: "Coordination", href: "/coordination", icon: "check", coordinatorOnly: true },
      { key: "escalation", label: "Escalation", href: "/escalation", icon: "check", coordinatorOnly: true },
      // Core coordination mechanics, not calendar content — a poll
      // spins up real tasks, an input round is questions posed against
      // one.
      { key: "scheduling-polls", label: "Scheduling polls", href: "/scheduling-polls", icon: "check" },
      { key: "input-rounds", label: "Input rounds", href: "/input-rounds", icon: "check" },
    ],
  },
  {
    key: "community",
    label: "Community",
    icon: "people",
    items: [
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
        icon: "shield",
        moduleKey: "conflictReports",
      },
      {
        key: "sensitive-data",
        label: "Sensitive data",
        href: "/sensitive-data",
        icon: "shield",
        moduleKey: "sensitiveData",
      },
      { key: "schedule", label: "Event schedule", href: "/schedule", icon: "calendar", moduleKey: "eventScheduling" },
      { key: "shifts", label: "Shifts", href: "/shifts", icon: "calendar", moduleKey: "shifts" },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = [DASHBOARD_ITEM, CALENDAR_ITEM, SETTINGS_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)];

export function isItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (item.coordinatorOnly && !ctx.isCoordinator) return false;
  if (item.moduleKey && !ctx.visibleModules[item.moduleKey]) return false;
  return true;
}

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
export const SETTINGS_ITEM: NavItem = { key: "settings", label: "Settings", href: "/settings", icon: "gear" };

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
    ],
  },
  {
    key: "calendar",
    label: "Calendar",
    icon: "calendar",
    items: [
      { key: "schedule", label: "Event schedule", href: "/schedule", icon: "calendar", moduleKey: "eventScheduling" },
      { key: "scheduling-polls", label: "Scheduling polls", href: "/scheduling-polls", icon: "calendar" },
      { key: "shifts", label: "Shifts", href: "/shifts", icon: "calendar", moduleKey: "shifts" },
      { key: "participation", label: "Participation", href: "/participation", icon: "calendar" },
      { key: "calendar-events", label: "Calendar events", href: "/calendar-events", icon: "calendar" },
      { key: "input-rounds", label: "Input rounds", href: "/input-rounds", icon: "calendar" },
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
      {
        key: "recruitment",
        label: "Recruitment pipeline",
        href: "/recruitment",
        icon: "recruitment",
        moduleKey: "recruitment",
      },
      { key: "invites", label: "Invites", href: "/invites", icon: "recruitment", moduleKey: "recruitment" },
      {
        key: "applications",
        label: "Applications",
        href: "/applications",
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
    ],
  },
];

export const ALL_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

export function isItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (item.coordinatorOnly && !ctx.isCoordinator) return false;
  if (item.moduleKey && !ctx.visibleModules[item.moduleKey]) return false;
  return true;
}

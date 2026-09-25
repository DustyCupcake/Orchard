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
  // button row to the rest of the group).
  href?: string;
  // Two distinct header styles, picked per group by what its items
  // actually are — see AppShell.tsx's NavGroupBlock:
  //  - true: items are lightweight views into one domain, not
  //    individually meaningful destinations to pin — the header becomes
  //    a real link (icon + label) with a separate chevron for expand/
  //    collapse, and items lose their own icons (indented text only),
  //    since the header's icon already stands for the whole category.
  //    Tasks, Community, Communication and Library use this.
  //  - false/absent: items are substantial, independently pinnable
  //    destinations (each a full module) — the header stays a plain
  //    uppercase toggle-only label, and each item keeps its own icon so
  //    it reads the same whether reached via this list or via a pin.
  //    Modules uses this.
  headerIsLink?: boolean;
};

export const DASHBOARD_ITEM: NavItem = { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "home" };
export const CALENDAR_ITEM: NavItem = { key: "calendar", label: "Calendar", href: "/calendar", icon: "calendar" };

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
      // The sub-list carries only the three real destinations this
      // group's header hub (/board) routes to from its own button row —
      // Board is the header link itself, "Propose a task" is the board's
      // primary button, and Escalation lives in the board's coordinator
      // overflow, so none of them need a duplicate sidebar row.
      { key: "proposals", label: "Proposals", href: "/proposals", icon: "stack" },
      { key: "contribution", label: "My contribution", href: "/contribution", icon: "handheart" },
      { key: "coordination", label: "Coordination", href: "/coordination", icon: "compass", coordinatorOnly: true },
      // Input rounds moved to the Communication group — it's an ask-me
      // interaction, not a task mechanic (see that group's comment).
    ],
  },
  {
    key: "community",
    label: "Community",
    icon: "people",
    // The community dashboard (src/app/(app)/community/page.tsx) is
    // the group's real hub — a page with its own hub-link row and
    // "Invite a member" primary, the board's role for Tasks. Previously
    // the header fell back to "whatever's first" (/members).
    href: "/community",
    headerIsLink: true,
    items: [
      { key: "members", label: "Members", href: "/members", icon: "people" },
      { key: "assemblies", label: "Assemblies", href: "/assemblies", icon: "chatsCircle" },
      // The community's relationship to Cycles over time — history,
      // current-cycle composition/participation stats — with a member's
      // own participation declaration as one part of that, not a
      // separate destination. Presented to members as "Events" (the
      // Cycle → Event relabel; schema, routes and URLs keep "cycle").
      // Cycle-scoped data (who's part of it), as distinct from
      // Calendar's when-things-happen dates.
      { key: "cycles", label: "Events", href: "/participation", icon: "cycle" },
      // Community-wide config (branches, tiers, modules, ...) — moved
      // out of its old fixed bottom-of-sidebar slot: that position
      // reads as "your own stuff" (it sits right above the profile/
      // logout block), which fits personal settings, not the rarely-
      // touched admin config this actually is. Reachable here and from
      // /community. Resolved as "stays in Community for now" — there
      // are also personal settings, and no better home has emerged yet.
      { key: "settings", label: "Settings", href: "/settings", icon: "gear" },
    ],
  },
  {
    key: "communication",
    label: "Communication",
    icon: "chatCircle",
    // The attention/needs-you family — everything "someone is asking me
    // to answer" (messages, input rounds, feedback reviews, nominations,
    // date invites, scheduling polls). The header links to the Inbox
    // dashboard (/communication), which aggregates every type into
    // per-kind sections (hidden when empty); each subheading below is a
    // working surface in its own right, reachable directly for the
    // focused view + its send action. Carries the Communication side of
    // the two-center attention split (see AppShell.tsx); the task side
    // rides the Dashboard item.
    href: "/communication",
    headerIsLink: true,
    items: [
      { key: "messages", label: "Messages", href: "/messages", icon: "mail" },
      // An input round is questions posed against a task — "people
      // asking me things," an interaction surface, not a task mechanic.
      { key: "input-rounds", label: "Input rounds", href: "/input-rounds", icon: "question" },
      { key: "feedback", label: "Feedback", href: "/feedback", icon: "chatCircleDots", moduleKey: "feedback" },
    ],
  },
  {
    key: "library",
    label: "Library",
    icon: "bookOpen",
    // A single top-level destination, the same way Calendar is — the
    // community's documentation (wiki pages + task-doc browse),
    // relabeled "Library" and given its own hub. Header links straight
    // to the existing /documentation page (label-only change; route
    // and URLs unchanged). No sub-list: the header *is* the link.
    href: "/documentation",
    headerIsLink: true,
    items: [],
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
      {
        key: "schedule",
        label: "Programme",
        href: "/schedule",
        icon: "calendarHeart",
        moduleKey: "eventScheduling",
      },
      { key: "shifts", label: "Shifts", href: "/shifts", icon: "clipboardText", moduleKey: "shifts" },
    ],
  },
];

export const ALL_ITEMS: NavItem[] = [DASHBOARD_ITEM, CALENDAR_ITEM, ...NAV_GROUPS.flatMap((g) => g.items)];

export function isItemVisible(item: NavItem, ctx: NavContext): boolean {
  if (item.coordinatorOnly && !ctx.isCoordinator) return false;
  if (item.moduleKey && !ctx.visibleModules[item.moduleKey]) return false;
  return true;
}

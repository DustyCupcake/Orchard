import { describe, expect, it } from "vitest";
import {
  ALL_ITEMS,
  NAV_GROUPS,
  isCycleScopedHref,
  isNavGroupRenderable,
} from "@/components/nav/nav-config";

describe("navigation group visibility", () => {
  // Event management is reached from the view-scope switcher's own
  // dropdown ("Manage events", CycleSwitcher.tsx), not from a sidebar row
  // of its own. Asserting no nav item carries the Events href anywhere,
  // so nobody helpfully re-adds the top-level row it used to have — the
  // bare /participation is a redirect shim onto /[cycleScope]/participation,
  // so such a row could never even light up on the page it led to.
  it("gives the Events page no nav item of its own", () => {
    expect(ALL_ITEMS.some((item) => item.href === "/participation")).toBe(false);
    expect(ALL_ITEMS.some((item) => item.key === "cycles")).toBe(false);
    for (const group of NAV_GROUPS) {
      expect(group.items.some((item) => item.href === "/participation")).toBe(false);
      expect(group.items.some((item) => item.key === "cycles")).toBe(false);
    }
  });

  // /questions is a supporting page, not a destination in its own right —
  // it's reached from the Dashboard element, /profile, the event page, and
  // the post-declaration handover. Asserting it has NO nav item, so nobody
  // helpfully adds a permanent top-level row for it again.
  it("gives /questions no nav item of its own", () => {
    expect(ALL_ITEMS.some((item) => item.href === "/questions")).toBe(false);
    for (const group of NAV_GROUPS) {
      expect(group.items.some((item) => item.href === "/questions")).toBe(false);
    }
  });

  it("keeps the header-only Library destination renderable", () => {
    const library = NAV_GROUPS.find((group) => group.key === "library");

    expect(library).toMatchObject({
      label: "Library",
      href: "/documentation",
      headerIsLink: true,
      items: [],
    });
    expect(isNavGroupRenderable(library!)).toBe(true);
  });

  it("does not render an empty ordinary group", () => {
    const library = NAV_GROUPS.find((group) => group.key === "library")!;
    expect(isNavGroupRenderable({ ...library, headerIsLink: false })).toBe(false);
  });
});

describe("cycle-scoped nav hrefs", () => {
  // The bug this guards: a nav item whose real page lives at
  // /{cycleScope}{href} lights up only for the length of the redirect
  // from the bare href, then goes dark on the page it actually led to.
  // AppShell's isActive strips the leading scope segment for exactly the
  // items flagged cycleScoped, so forgetting the flag on a new
  // cycle-scoped page silently reintroduces the flash.
  it("marks every item whose page moved under [cycleScope]", () => {
    // The four real pages under [cycleScope] today. Coordination and
    // Escalation moved in Phase 65 alongside Participation and Budget.
    for (const href of ["/participation", "/budget", "/coordination", "/escalation"]) {
      const items = ALL_ITEMS.filter((item) => item.href === href);
      if (items.length === 0) continue; // no nav row (participation/escalation)
      for (const item of items) {
        expect({ href, cycleScoped: item.cycleScoped }).toEqual({ href, cycleScoped: true });
      }
    }
  });

  it("resolves a href as cycle-scoped only when an item says so", () => {
    expect(isCycleScopedHref("/coordination")).toBe(true);
    expect(isCycleScopedHref("/budget")).toBe(true);
    // A normal top-level destination must not be treated as one, or
    // /board would light up on any /{scope}/board path.
    expect(isCycleScopedHref("/board")).toBe(false);
    expect(isCycleScopedHref("/dashboard")).toBe(false);
    expect(isCycleScopedHref("/participation")).toBe(false);
  });

  it("keeps the Coordination row inside the Tasks group and coordinator-only", () => {
    const tasks = NAV_GROUPS.find((group) => group.key === "tasks")!;
    const coordination = tasks.items.find((item) => item.key === "coordination");
    expect(coordination).toMatchObject({
      href: "/coordination",
      coordinatorOnly: true,
      cycleScoped: true,
    });
  });
});

describe("group expand/collapse defaults", () => {
  // A headerIsLink group is a link first and a container second: its own
  // destination is the row you click and the sub-list is alternate routes
  // into it. Modules is the opposite — its header isn't a destination, so
  // collapsing it by default would hide the only content it has.
  it("collapses link-header groups by default and leaves Modules open", () => {
    for (const group of NAV_GROUPS) {
      if (group.key === "modules") {
        expect(group.defaultOpen ?? true).toBe(true);
      } else if (group.items.length > 0) {
        expect(group).toMatchObject({ headerIsLink: true, defaultOpen: false });
      }
    }
  });

  it("keeps the default consistent with the header style it explains", () => {
    // Guards the two flags from drifting apart: a group whose header
    // isn't a link must never be collapsed by default, because there is
    // nowhere to go but the sub-list.
    for (const group of NAV_GROUPS) {
      if (group.defaultOpen === false) {
        expect(group.headerIsLink).toBe(true);
        expect(group.items.length).toBeGreaterThan(0);
      }
    }
  });
});

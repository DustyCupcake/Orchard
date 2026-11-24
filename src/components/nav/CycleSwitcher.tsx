"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavIcon } from "./phosphor-icon-map";
import { setViewScopeAction } from "@/app/(app)/nav-actions";
import type { NavContext, ParticipationStatus } from "@/lib/nav";

// The global cycle-switcher (docs/plans/development-plan.md's Phase 65) —
// rendered from AppShell.tsx right below the sidebar header, both
// mobile and desktop. `urlScope`/`subPath` are parsed by AppShell from
// the live pathname (this component's own author has no server-side
// way to know it — the (app) layout sits *above* the new [cycleScope]
// segment) — authoritative display truth while actually on a
// cycle-scoped page; ctx.defaultScopeSegment (server-resolved from
// Member.lastViewedCycleId) is the fallback everywhere else.
// The [cycleScope] pages a scope selection can navigate between — the
// shared vocabulary with AppShell's cycleScopeMatch regex, which parses
// the sub-path out of the live pathname. Exported so the regex's capture
// group and this type can't drift apart: a page added to one without the
// other fails to typecheck, rather than silently refreshing in place
// instead of navigating.
export type CycleSubPath = "participation" | "budget" | "coordination" | "escalation";

// The status dot next to each event in the switcher's dropdown: the
// viewer's participation status on that event — coming, maybe, not
// coming, or haven't said. It links to the event's participation page.
const STATUS_DOT_CLASS: Record<ParticipationStatus, string> = {
  coming: "bg-[var(--success)]",
  maybe: "bg-[var(--warning)]",
  not_coming: "bg-[var(--text)]",
  unknown: "border border-[var(--border)] bg-transparent",
};

const STATUS_TITLE: Record<ParticipationStatus, string> = {
  coming: "You're coming",
  maybe: "You might be coming",
  not_coming: "You're not coming",
  unknown: "Haven't said",
};

export default function CycleSwitcher({
  ctx,
  urlScope,
  subPath,
  collapsed,
}: {
  ctx: NavContext["cycleSwitcher"];
  urlScope: string | null;
  // null on any page that isn't itself URL-scoped (the board, dashboard,
  // task detail, ...) — docs/plans/development-plan.md's Phase 67 is the
  // first consumer of the switcher outside Participation/Budget, and
  // those pages have nowhere scope-specific to navigate to on
  // selection; selectScope below just refreshes them in place instead.
  subPath: CycleSubPath | null;
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const currentScope = urlScope ?? ctx.defaultScopeSegment;

  if (!ctx.hasAnyOpenCycle) {
    if (collapsed) return null;
    return (
      <div className="border-b border-[var(--border)] px-3 py-2.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        {ctx.canInitiateCycle ? (
          <Link href="/manage-events" className="text-[var(--accent-1)] hover:underline">
            Start an event
          </Link>
        ) : (
          "No event open yet"
        )}
      </div>
    );
  }

  async function selectScope(scope: string) {
    setOpen(false);
    await setViewScopeAction(scope);
    if (subPath) {
      router.push(`/${scope}/${subPath}`);
    } else {
      router.refresh();
    }
  }

  const currentLabel =
    currentScope === "active"
      ? "All active events"
      : (ctx.openCycles.find((c) => c.id === currentScope)?.name ??
        (currentScope === ctx.defaultScopeSegment ? ctx.defaultScopeName : null) ??
        "Event");

  return (
    <div className="relative border-b border-[var(--border)] px-2 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? currentLabel : undefined}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)] ${
          collapsed ? "justify-center" : "justify-between"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <NavIcon name="cycle" size={14} className="shrink-0 text-[var(--text-muted)]" />
          {!collapsed && <span className="truncate">{currentLabel}</span>}
        </span>
        {!collapsed && <NavIcon name="chevronDown" size={12} className="shrink-0 text-[var(--text-muted)]" />}
      </button>

      {open && (
        <div className="absolute left-2 right-2 top-full z-10 mt-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] py-1 shadow-lg">
          <button
            onClick={() => selectScope("active")}
            className={`flex w-full items-center px-3 py-1.5 text-left text-[length:var(--text-body)] hover:bg-[var(--surface-sunken)] ${
              currentScope === "active" ? "font-medium text-[var(--accent-1)]" : "text-[var(--text)]"
            }`}
          >
            All active events
          </button>
          {ctx.openCycles.map((c) => (
            <div key={c.id} className="group/cycleitem flex items-center">
              <button
                onClick={() => selectScope(c.id)}
                className={`flex flex-1 items-center truncate px-3 py-1.5 text-left text-[length:var(--text-body)] hover:bg-[var(--surface-sunken)] ${
                  currentScope === c.id ? "font-medium text-[var(--accent-1)]" : "text-[var(--text)]"
                }`}
              >
                {c.name}
              </button>
              <Link
                href={`/${c.id}/settings`}
                title="Event settings"
                onClick={() => setOpen(false)}
                className="mr-1 shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] opacity-0 hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] group-hover/cycleitem:opacity-100"
              >
                <NavIcon name="gear" size={14} />
              </Link>
              {/* The viewer's participation status on this event —
                  coming (green), maybe (yellow), not coming (dark), or
                  haven't said (an empty circle). Clicking it goes to the
                  event's participation page, where they can change it. */}
              <Link
                href={`/${c.id}/participation`}
                title={STATUS_TITLE[c.myStatus]}
                aria-label={`Your participation status on ${c.name}: ${STATUS_TITLE[c.myStatus]}`}
                onClick={() => setOpen(false)}
                className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] hover:bg-[var(--surface-sunken)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-1)]"
              >
                <span aria-hidden className={`block h-2.5 w-2.5 rounded-full ${STATUS_DOT_CLASS[c.myStatus]}`} />
              </Link>
            </div>
          ))}
          {/* The two links below are destinations, not selections — the
              rows above change which event this whole view is scoped to,
              these two just go somewhere. A hairline separates them, so a
              click is never ambiguous about which kind of row it was.
              "Manage events" is a fixed destination for the events list,
              event types and the create form — it deliberately does not
              follow the current selection: the gear above is the link to
              the selected event's own settings. */}
          <div className="my-1 border-t border-[var(--border)]" />
          <Link
            href="/manage-events"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)]"
          >
            Manage events
          </Link>
          <Link
            href="/cycles"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
          >
            Find a closed event
          </Link>
        </div>
      )}
    </div>
  );
}

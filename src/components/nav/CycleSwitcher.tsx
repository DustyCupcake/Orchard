"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { NavIcon } from "./phosphor-icon-map";
import { setViewScopeAction } from "@/app/(app)/nav-actions";
import type { NavContext } from "@/lib/nav";

// The global cycle-switcher (docs/development-plan.md's Phase 65) —
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

export default function CycleSwitcher({
  ctx,
  urlScope,
  subPath,
  collapsed,
}: {
  ctx: NavContext["cycleSwitcher"];
  urlScope: string | null;
  // null on any page that isn't itself URL-scoped (the board, dashboard,
  // task detail, ...) — docs/development-plan.md's Phase 67 is the
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
          <Link href="/active/participation" className="text-[var(--accent-1)] hover:underline">
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
                href={`/${c.id}/participation#cycle-settings`}
                title="Event settings"
                onClick={() => setOpen(false)}
                className="mr-1 shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] opacity-0 hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] group-hover/cycleitem:opacity-100"
              >
                <NavIcon name="gear" size={14} />
              </Link>
            </div>
          ))}
          {/* The two links below are destinations, not selections — the
              rows above change which event this whole view is scoped to,
              these two just go somewhere. A hairline separates them, so a
              click is never ambiguous about which kind of row it was.
              "Manage events" is the event-management half of the Events
              page (settings, phases, close, clone, start a new one) and
              deliberately follows the *current* selection rather than the
              member's persisted default: the whole menu is about the
              event you're looking at, so a link inside it that silently
              resolved to a different one would be a trap. The aggregate
              selection resolves to /active/participation, which is where
              "Start a new event" lives. */}
          <div className="my-1 border-t border-[var(--border)]" />
          <Link
            href={`/${currentScope}/participation`}
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

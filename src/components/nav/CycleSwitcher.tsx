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
export default function CycleSwitcher({
  ctx,
  urlScope,
  subPath,
  collapsed,
}: {
  ctx: NavContext["cycleSwitcher"];
  urlScope: string | null;
  subPath: "participation" | "budget";
  collapsed: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const currentScope = urlScope ?? ctx.defaultScopeSegment;

  if (!ctx.hasAnyOpenCycle) {
    if (collapsed) return null;
    return (
      <div className="border-b border-[var(--border)] px-3 py-2.5 text-[12px] text-[var(--text-muted)]">
        {ctx.canInitiateCycle ? (
          <Link href="/active/participation" className="text-[var(--accent-1)] hover:underline">
            Start a cycle
          </Link>
        ) : (
          "No cycle open yet"
        )}
      </div>
    );
  }

  async function selectScope(scope: string) {
    setOpen(false);
    await setViewScopeAction(scope);
    router.push(`/${scope}/${subPath}`);
  }

  const currentLabel =
    currentScope === "active"
      ? "All active cycles"
      : (ctx.openCycles.find((c) => c.id === currentScope)?.name ??
        (currentScope === ctx.defaultScopeSegment ? ctx.defaultScopeName : null) ??
        "Cycle");

  return (
    <div className="relative border-b border-[var(--border)] px-2 py-2">
      <button
        onClick={() => setOpen((v) => !v)}
        title={collapsed ? currentLabel : undefined}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-[13px] text-[var(--text)] hover:bg-[var(--surface-sunken)] ${
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
            className={`flex w-full items-center px-3 py-1.5 text-left text-[13px] hover:bg-[var(--surface-sunken)] ${
              currentScope === "active" ? "font-medium text-[var(--accent-1)]" : "text-[var(--text)]"
            }`}
          >
            All active cycles
          </button>
          {ctx.openCycles.map((c) => (
            <div key={c.id} className="group/cycleitem flex items-center">
              <button
                onClick={() => selectScope(c.id)}
                className={`flex flex-1 items-center truncate px-3 py-1.5 text-left text-[13px] hover:bg-[var(--surface-sunken)] ${
                  currentScope === c.id ? "font-medium text-[var(--accent-1)]" : "text-[var(--text)]"
                }`}
              >
                {c.name}
              </button>
              <Link
                href={`/${c.id}/participation#cycle-settings`}
                title="Cycle settings"
                onClick={() => setOpen(false)}
                className="mr-1 shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] opacity-0 hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] group-hover/cycleitem:opacity-100"
              >
                <NavIcon name="gear" size={14} />
              </Link>
            </div>
          ))}
          <Link
            href="/cycles"
            onClick={() => setOpen(false)}
            className="block px-3 py-1.5 text-[13px] text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
          >
            Other…
          </Link>
        </div>
      )}
    </div>
  );
}

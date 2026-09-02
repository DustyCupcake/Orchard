"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import {
  ALL_ITEMS,
  DASHBOARD_ITEM,
  NAV_GROUPS,
  SETTINGS_ITEM,
  isItemVisible,
  type NavGroup,
  type NavItem,
} from "./nav-config";
import type { NavContext } from "@/lib/nav";

const COLLAPSE_KEY = "orchard.sidebar.collapsed";

function GroupLabel({ label }: { label: string }) {
  return (
    <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
      {label}
    </div>
  );
}

function NavLink({
  item,
  collapsed,
  active,
  badge,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badge?: number;
}) {
  return (
    <li>
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={`flex items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors ${
          collapsed ? "justify-center" : ""
        } ${
          active
            ? "bg-neutral-200/70 font-medium text-neutral-900"
            : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
        }`}
      >
        <span className="relative shrink-0">
          <Icon name={item.icon} />
          {Boolean(badge) && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
              {badge}
            </span>
          )}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </li>
  );
}

function NavGroupBlock({
  group,
  collapsed,
  isActive,
}: {
  group: NavGroup;
  collapsed: boolean;
  isActive: (href: string) => boolean;
}) {
  if (collapsed) {
    const primary = group.items[0];
    const groupActive = group.items.some((item) => isActive(item.href));
    return (
      <ul className="space-y-0.5">
        <li>
          <Link
            href={primary.href}
            title={group.label}
            className={`flex items-center justify-center rounded-md px-2.5 py-2 text-sm transition-colors ${
              groupActive
                ? "bg-neutral-200/70 text-neutral-900"
                : "text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900"
            }`}
          >
            <Icon name={group.icon} />
          </Link>
        </li>
      </ul>
    );
  }

  return (
    <div>
      <GroupLabel label={group.label} />
      <ul className="space-y-0.5">
        {group.items.map((item) => (
          <NavLink key={item.key} item={item} collapsed={false} active={isActive(item.href)} />
        ))}
      </ul>
    </div>
  );
}

function SidebarNavList({
  collapsed,
  visibleGroups,
  pinnedItems,
  badgeCount,
  isActive,
}: {
  collapsed: boolean;
  visibleGroups: NavGroup[];
  pinnedItems: NavItem[];
  badgeCount: number;
  isActive: (href: string) => boolean;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      <ul className="space-y-0.5">
        <NavLink item={DASHBOARD_ITEM} collapsed={collapsed} active={isActive(DASHBOARD_ITEM.href)} badge={badgeCount} />
      </ul>

      {visibleGroups.map((group) => (
        <NavGroupBlock key={group.key} group={group} collapsed={collapsed} isActive={isActive} />
      ))}

      {pinnedItems.length > 0 && (
        <div>
          {!collapsed && <GroupLabel label="Pinned for you" />}
          <ul className="space-y-0.5">
            {pinnedItems.map((item) => (
              <NavLink key={item.key} item={item} collapsed={collapsed} active={isActive(item.href)} />
            ))}
          </ul>
        </div>
      )}

      <ul className="mt-auto space-y-0.5">
        <NavLink item={SETTINGS_ITEM} collapsed={collapsed} active={isActive(SETTINGS_ITEM.href)} />
      </ul>
    </nav>
  );
}

function SidebarHeader({
  collapsed,
  variant,
  onToggleCollapsed,
  onCloseMobile,
}: {
  collapsed: boolean;
  variant: "desktop" | "mobile";
  onToggleCollapsed?: () => void;
  onCloseMobile?: () => void;
}) {
  return (
    <div className={`flex items-center border-b border-neutral-200 px-3 py-3 ${collapsed ? "justify-center" : "justify-between"}`}>
      {!collapsed && <span className="text-sm font-semibold text-neutral-800">Orchard</span>}
      {variant === "desktop" ? (
        <button
          onClick={onToggleCollapsed}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        >
          <Icon name={collapsed ? "chevronRight" : "chevronLeft"} className="h-4 w-4" />
        </button>
      ) : (
        <button
          onClick={onCloseMobile}
          className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
          aria-label="Close menu"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function UserBlock({ memberName, collapsed }: { memberName: string; collapsed: boolean }) {
  const initial = memberName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="border-t border-neutral-200 p-2">
      <div className={`flex items-center gap-2 rounded-md px-1 py-1 ${collapsed ? "justify-center" : ""}`}>
        <Link
          href="/profile"
          title="Profile"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-neutral-800 text-sm font-semibold text-white"
        >
          {initial}
        </Link>
        {!collapsed && (
          <Link href="/profile" className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800 hover:underline">
            {memberName}
          </Link>
        )}
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            title="Log out"
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          >
            <Icon name="logout" className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AppShell({ ctx, children }: { ctx: NavContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      // localStorage unavailable (private browsing, etc.) — default expanded.
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // ignore — nothing to persist to
    }
  }, [collapsed]);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const pinnedItems = ctx.pinnedKeys
    .map((key) => ALL_ITEMS.find((item) => item.key === key))
    .filter((item): item is NavItem => Boolean(item));

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isItemVisible(item, ctx)),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center border-b border-neutral-200 bg-white px-3 md:hidden">
        <button onClick={() => setMobileOpen(true)} className="-ml-2 p-2 text-neutral-600" aria-label="Open menu">
          <Icon name="menu" />
        </button>
        <span className="ml-2 font-semibold text-neutral-800">Orchard</span>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex h-full w-72 max-w-[85vw] flex-col bg-white">
            <SidebarHeader collapsed={false} variant="mobile" onCloseMobile={() => setMobileOpen(false)} />
            <SidebarNavList
              collapsed={false}
              visibleGroups={visibleGroups}
              pinnedItems={pinnedItems}
              badgeCount={ctx.badgeCount}
              isActive={isActive}
            />
            <UserBlock memberName={ctx.memberName} collapsed={false} />
          </div>
          <div className="flex-1 bg-black/30" aria-hidden="true" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-neutral-200 bg-neutral-50 transition-[width] duration-150 md:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <SidebarHeader collapsed={collapsed} variant="desktop" onToggleCollapsed={() => setCollapsed((v) => !v)} />
        <SidebarNavList
          collapsed={collapsed}
          visibleGroups={visibleGroups}
          pinnedItems={pinnedItems}
          badgeCount={ctx.badgeCount}
          isActive={isActive}
        />
        <UserBlock memberName={ctx.memberName} collapsed={collapsed} />
      </div>

      <main
        className={`pt-14 transition-[margin] duration-150 md:pt-0 ${collapsed ? "md:ml-16" : "md:ml-64"}`}
      >
        {children}
      </main>
    </>
  );
}

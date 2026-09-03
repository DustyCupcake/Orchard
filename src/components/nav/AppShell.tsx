"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Eye, Warning } from "@phosphor-icons/react";
import { NavIcon } from "./phosphor-icon-map";
import {
  ALL_ITEMS,
  CALENDAR_ITEM,
  DASHBOARD_ITEM,
  NAV_GROUPS,
  SETTINGS_ITEM,
  isItemVisible,
  type NavGroup,
  type NavItem,
} from "./nav-config";
import type { NavContext } from "@/lib/nav";
import { toggleFavoriteNavItem, endViewAsAction } from "@/app/(app)/nav-actions";

const COLLAPSE_KEY = "orchard.sidebar.collapsed";
const CLOSED_GROUPS_KEY = "orchard.sidebar.closedGroups";
const PINNED_GROUP_KEY = "__pinned";

// Standalone icon-button chrome (collapse toggle, mobile open/close,
// logout) — the design conventions' "icon button" pattern: 36×36,
// bordered, radius-md.
const ICON_BUTTON =
  "flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:bg-[var(--neutral-100)] hover:text-[var(--text)]";

function GroupLabel({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className="flex w-full items-center gap-1 px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)] hover:text-[var(--text)]"
    >
      <NavIcon name="chevronDown" size={12} className={`shrink-0 transition-transform ${open ? "" : "-rotate-90"}`} />
      <span>{label}</span>
    </button>
  );
}

function NavLink({
  item,
  collapsed,
  active,
  badge,
  pinned,
  onTogglePin,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badge?: number;
  pinned?: boolean;
  onTogglePin?: () => void;
}) {
  return (
    <li className="group/navitem flex items-center">
      <Link
        href={item.href}
        title={collapsed ? item.label : undefined}
        className={`flex flex-1 items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 text-[13px] transition-colors ${
          collapsed ? "justify-center" : ""
        } ${
          active
            ? "bg-[var(--accent-1-soft)] font-medium text-[var(--accent-1)]"
            : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
        }`}
      >
        <span className="relative shrink-0">
          <NavIcon name={item.icon} weight={active ? "fill" : "regular"} />
          {Boolean(badge) && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
              {badge}
            </span>
          )}
        </span>
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
      {!collapsed && onTogglePin && (
        <button
          onClick={onTogglePin}
          title={pinned ? "Unpin" : "Pin to top"}
          className={`mr-1 shrink-0 rounded-[var(--radius-sm)] p-1.5 text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)] ${
            pinned ? "opacity-100" : "opacity-0 group-hover/navitem:opacity-100"
          }`}
        >
          <NavIcon name="pin" weight={pinned ? "fill" : "regular"} size={14} className={pinned ? "text-[var(--warning)]" : ""} />
        </button>
      )}
    </li>
  );
}

function NavGroupBlock({
  group,
  collapsed,
  isActive,
  open,
  onToggleOpen,
  manualPinnedKeys,
  onTogglePin,
}: {
  group: NavGroup;
  collapsed: boolean;
  isActive: (href: string) => boolean;
  open: boolean;
  onToggleOpen: () => void;
  manualPinnedKeys: string[];
  onTogglePin?: (key: string) => void;
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
            className={`flex items-center justify-center rounded-[var(--radius-sm)] px-2.5 py-2 text-[13px] transition-colors ${
              groupActive
                ? "bg-[var(--accent-1-soft)] text-[var(--accent-1)]"
                : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--text)]"
            }`}
          >
            <NavIcon name={group.icon} weight={groupActive ? "fill" : "regular"} />
          </Link>
        </li>
      </ul>
    );
  }

  return (
    <div>
      <GroupLabel label={group.label} open={open} onToggle={onToggleOpen} />
      {open && (
        <ul className="space-y-0.5">
          {group.items.map((item) => (
            <NavLink
              key={item.key}
              item={item}
              collapsed={false}
              active={isActive(item.href)}
              pinned={manualPinnedKeys.includes(item.key)}
              onTogglePin={onTogglePin ? () => onTogglePin(item.key) : undefined}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function SidebarNavList({
  collapsed,
  visibleGroups,
  pinnedItems,
  badgeCount,
  isActive,
  closedGroups,
  onToggleGroup,
  manualPinnedKeys,
  onTogglePin,
}: {
  collapsed: boolean;
  visibleGroups: NavGroup[];
  pinnedItems: NavItem[];
  badgeCount: number;
  isActive: (href: string) => boolean;
  closedGroups: Set<string>;
  onToggleGroup: (key: string) => void;
  manualPinnedKeys: string[];
  onTogglePin?: (key: string) => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-2 py-3">
      <ul className="space-y-0.5">
        <NavLink item={DASHBOARD_ITEM} collapsed={collapsed} active={isActive(DASHBOARD_ITEM.href)} badge={badgeCount} />
        <NavLink item={CALENDAR_ITEM} collapsed={collapsed} active={isActive(CALENDAR_ITEM.href)} />
      </ul>

      {visibleGroups.map((group) => (
        <NavGroupBlock
          key={group.key}
          group={group}
          collapsed={collapsed}
          isActive={isActive}
          open={!closedGroups.has(group.key)}
          onToggleOpen={() => onToggleGroup(group.key)}
          manualPinnedKeys={manualPinnedKeys}
          onTogglePin={onTogglePin}
        />
      ))}

      {pinnedItems.length > 0 && (
        <div>
          {!collapsed && (
            <GroupLabel
              label="Pinned for you"
              open={!closedGroups.has(PINNED_GROUP_KEY)}
              onToggle={() => onToggleGroup(PINNED_GROUP_KEY)}
            />
          )}
          {(collapsed || !closedGroups.has(PINNED_GROUP_KEY)) && (
            <ul className="space-y-0.5">
              {pinnedItems.map((item) => (
                <NavLink key={item.key} item={item} collapsed={collapsed} active={isActive(item.href)} />
              ))}
            </ul>
          )}
        </div>
      )}

      <ul className="mt-auto space-y-0.5">
        <NavLink item={SETTINGS_ITEM} collapsed={collapsed} active={isActive(SETTINGS_ITEM.href)} />
      </ul>
    </nav>
  );
}

function BrandMark({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- a community-supplied external URL, not an optimizable local/remote-pattern asset
    return <img src={logoUrl} alt={name} className="h-6 w-6 shrink-0 rounded-[var(--radius-sm)] object-cover" />;
  }
  return <span className="truncate text-sm font-semibold text-[var(--text)]">{name}</span>;
}

function SidebarHeader({
  collapsed,
  variant,
  communityName,
  communityLogoUrl,
  onToggleCollapsed,
  onCloseMobile,
}: {
  collapsed: boolean;
  variant: "desktop" | "mobile";
  communityName: string;
  communityLogoUrl: string | null;
  onToggleCollapsed?: () => void;
  onCloseMobile?: () => void;
}) {
  return (
    <div className={`flex items-center border-b border-[var(--border)] px-3 py-3 ${collapsed ? "justify-center" : "justify-between"}`}>
      {!collapsed && <BrandMark name={communityName} logoUrl={communityLogoUrl} />}
      {variant === "desktop" ? (
        <button onClick={onToggleCollapsed} className={ICON_BUTTON} aria-label={collapsed ? "Expand menu" : "Collapse menu"}>
          <NavIcon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
        </button>
      ) : (
        <button onClick={onCloseMobile} className={ICON_BUTTON} aria-label="Close menu">
          <NavIcon name="close" size={16} />
        </button>
      )}
    </div>
  );
}

function UserBlock({ memberName, collapsed }: { memberName: string; collapsed: boolean }) {
  const initial = memberName.trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="border-t border-[var(--border)] p-2">
      <div className={`flex items-center gap-2 rounded-[var(--radius-md)] px-1 py-1 ${collapsed ? "justify-center" : ""}`}>
        <Link
          href="/profile"
          title="Profile"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent-1)] text-sm font-semibold text-[var(--accent-1-fg)]"
        >
          {initial}
        </Link>
        {!collapsed && (
          <Link href="/profile" className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)] hover:underline">
            {memberName}
          </Link>
        )}
        <form action="/api/auth/logout" method="post">
          <button type="submit" title="Log out" className={ICON_BUTTON}>
            <NavIcon name="logout" size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}

export default function AppShell({ ctx, children }: { ctx: NavContext; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    try {
      if (window.localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
      const storedClosed = window.localStorage.getItem(CLOSED_GROUPS_KEY);
      if (storedClosed) setClosedGroups(new Set(JSON.parse(storedClosed)));
    } catch {
      // localStorage unavailable (private browsing, etc.) — default expanded/open.
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

  // Phase 54 (View-as) — "disabled at the UI layer," applied once here
  // rather than wrapping every write form on every page individually:
  // every page already renders exactly as the viewed member would see
  // it (src/lib/view-as.ts's getViewingContext), including its forms —
  // this sweep is what keeps those forms visible-but-inert instead of
  // needing each page to know about View-as. A MutationObserver rather
  // than a one-shot query since Server Component content can still be
  // streaming in when this effect first runs. Only forms scoped under
  // <main> (never the sidebar or the banner's own "End View-as"
  // button) and never a plain GET form (this app's one read-only
  // filter form, on /participation, stays interactive). The real
  // guarantee is server-side (assertNotViewingAs, called from every
  // Server Action this phase touched) — this is the UX half of "and
  // re-checked/rejected server-side regardless."
  useEffect(() => {
    if (!ctx.viewAs) return;

    function disableWriteForms() {
      const main = document.querySelector("main");
      if (!main) return;
      main.querySelectorAll<HTMLFormElement>("form:not([method='get' i])").forEach((form) => {
        form.style.pointerEvents = "none";
        form.style.opacity = "0.55";
        form.setAttribute("aria-disabled", "true");
        form.querySelectorAll<HTMLButtonElement | HTMLInputElement>('button, input[type="submit"]').forEach(
          (el) => {
            el.disabled = true;
          },
        );
      });
    }

    disableWriteForms();
    const main = document.querySelector("main");
    const observer = main ? new MutationObserver(disableWriteForms) : null;
    observer?.observe(main!, { childList: true, subtree: true });
    return () => observer?.disconnect();
  }, [ctx.viewAs, pathname]);

  function toggleGroup(key: string) {
    setClosedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(CLOSED_GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        // ignore — nothing to persist to
      }
      return next;
    });
  }

  async function togglePin(key: string) {
    await toggleFavoriteNavItem(key);
    router.refresh();
  }

  async function endViewAs() {
    await endViewAsAction();
    router.refresh();
  }

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const pinnedItems = ctx.pinnedKeys
    .map((key) => ALL_ITEMS.find((item) => item.key === key))
    .filter((item): item is NavItem => item !== undefined)
    .filter((item) => isItemVisible(item, ctx));

  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isItemVisible(item, ctx)),
  })).filter((group) => group.items.length > 0);

  const navListProps = {
    visibleGroups,
    pinnedItems,
    badgeCount: ctx.badgeCount,
    isActive,
    closedGroups,
    onToggleGroup: toggleGroup,
    manualPinnedKeys: ctx.manualPinnedKeys,
    // Pinning writes to the *real* member's own pinnedModuleKeys (see
    // nav-actions.ts's toggleFavoriteNavItem), but ctx here was built
    // against the View-as target — showing a pin toggle would silently
    // mutate the wrong member's preferences while looking like it
    // changed the viewed member's. Same "no writes while viewing as"
    // rule as everything else this phase touches, so the button just
    // doesn't render.
    onTogglePin: ctx.viewAs ? undefined : togglePin,
  };

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex h-14 items-center border-b border-[var(--border)] bg-[var(--surface)] px-3 md:hidden">
        <button onClick={() => setMobileOpen(true)} className="-ml-2 p-2 text-[var(--text-muted)]" aria-label="Open menu">
          <NavIcon name="menu" size={20} />
        </button>
        <span className="ml-2">
          <BrandMark name={ctx.communityName} logoUrl={ctx.communityLogoUrl} />
        </span>
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div className="flex h-full w-72 max-w-[85vw] flex-col bg-[var(--surface)]">
            <SidebarHeader
              collapsed={false}
              variant="mobile"
              communityName={ctx.communityName}
              communityLogoUrl={ctx.communityLogoUrl}
              onCloseMobile={() => setMobileOpen(false)}
            />
            <SidebarNavList collapsed={false} {...navListProps} />
            <UserBlock memberName={ctx.memberName} collapsed={false} />
          </div>
          <div className="flex-1 bg-black/30" aria-hidden="true" onClick={() => setMobileOpen(false)} />
        </div>
      )}

      <div
        className={`fixed inset-y-0 left-0 z-20 hidden flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-150 md:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <SidebarHeader
          collapsed={collapsed}
          variant="desktop"
          communityName={ctx.communityName}
          communityLogoUrl={ctx.communityLogoUrl}
          onToggleCollapsed={() => setCollapsed((v) => !v)}
        />
        <SidebarNavList collapsed={collapsed} {...navListProps} />
        <UserBlock memberName={ctx.memberName} collapsed={collapsed} />
      </div>

      <main
        className={`bg-[var(--bg)] pt-14 transition-[margin] duration-150 md:pt-0 ${collapsed ? "md:ml-16" : "md:ml-64"}`}
      >
        {ctx.viewAs && (
          <div className="flex flex-wrap items-center justify-center gap-2 border-b border-[var(--accent-1-border)] bg-[var(--accent-1-soft)] px-4 py-2 text-center text-sm text-[var(--accent-1)]">
            <Eye size={16} weight="regular" className="shrink-0" />
            <span>
              Viewing as <strong>{ctx.viewAs.targetName}</strong> — read-only. Every action below is
              disabled; this doesn&rsquo;t affect their real session.
            </span>
            <button
              onClick={endViewAs}
              className="rounded-[var(--radius-sm)] border border-[var(--accent-1-border)] bg-[var(--surface)] px-2 py-0.5 text-xs font-medium text-[var(--accent-1)] hover:bg-[var(--accent-1-softer)]"
            >
              End View-as
            </button>
          </div>
        )}
        {ctx.onsiteModeEnabled && (
          <div className="flex items-center justify-center gap-2 border-b border-[var(--warning-border)] bg-[var(--warning-soft)] px-4 py-2 text-center text-sm text-[var(--warning)]">
            <Warning size={16} weight="regular" className="shrink-0" />
            <span>
              On-site mode is on — settings, branches, tiers, cycle types, starting a new Cycle,
              Requirement changes, publishing the Event schedule, and Spatial-planning edits are all
              locked until it&rsquo;s turned off from Settings.
            </span>
          </div>
        )}
        {children}
      </main>
    </>
  );
}

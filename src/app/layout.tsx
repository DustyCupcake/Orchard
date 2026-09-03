import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getOrCreateCommunity } from "@/lib/community";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Orchard",
  description: "Task-based, distributed-effort coordination.",
};

const DEFAULT_ACCENT_1 = "#3a6cd9";
const DEFAULT_ACCENT_2 = "#8a3fa8";

// Reads a personal theme override before first paint, avoiding a
// light→dark (or vice versa) flash — see globals.css's own comment and
// design_handoff_conventions/README.md's "Theme is personal, not
// communal" note. localStorage-only (no DB round-trip): the control
// lives on /profile (src/app/(app)/profile/ThemeToggle.tsx) and writes
// the same key this reads. Absent/"system" leaves no attribute, so the
// existing prefers-color-scheme media query decides.
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem("orchard.theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t);}}catch(e){}})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Single-tenant deployment (see src/lib/community.ts) — every page,
  // authenticated or not (login, a public /invite or /apply link),
  // renders under this same community's branding. Falls back to the
  // documented defaults on a DB error rather than throwing: this layout
  // wraps every route including ones Next.js prerenders at build time
  // (e.g. /_not-found), when no database is reachable — a real build-
  // time failure caught rebuilding after this change. Every real page
  // in this app is force-dynamic and renders per-request against a live
  // DB regardless, so this fallback is only ever exercised at build
  // time, never for an actual visitor.
  let accentPrimary: string | null = null;
  let accentSecondary: string | null = null;
  try {
    const community = await getOrCreateCommunity();
    accentPrimary = community.accentPrimary;
    accentSecondary = community.accentSecondary;
  } catch {
    // no DB reachable (build time) — fall through to the defaults below
  }
  const accentStyle = {
    "--accent-1": accentPrimary || DEFAULT_ACCENT_1,
    "--accent-2": accentSecondary || DEFAULT_ACCENT_2,
  } as React.CSSProperties;

  return (
    <html lang="en" className={inter.variable} style={accentStyle}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-[var(--bg)] text-[var(--text)]">{children}</body>
    </html>
  );
}

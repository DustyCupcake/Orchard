import type { Metadata } from "next";
import { cache } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { getOrCreateCommunity } from "@/lib/community";
import "./globals.css";

// Three families, each with one job. Newsreader-style serif for anything
// that is a heading rather than a value, IBM Plex Sans for the interface
// itself, IBM Plex Mono for the few places a figure is an identifier
// (ids, paths, counts) rather than prose.
//
// Fraunces rather than Newsreader because it has a real optical-size axis,
// so the same family sets a 32px page title and a 15px card title without
// one of them looking like a shrunken copy of the other. WONK is pinned at
// 0 — the axis that gives Fraunces its character is also the axis that
// makes it read as a display face, and this is a tool people use all day,
// not a poster.
//
// Plex Sans rather than Inter is the single largest reason this stopped
// looking like every other app built in the last two years; see the
// typography section of docs/design_handoff_conventions/README.md.
// The next/font variable names are deliberately NOT --font-display /
// --font-body / --font-mono. Those are the semantic tokens globals.css
// resolves against them, and naming both the same thing makes each one
// self-reference: the class sets --font-display to the family, :root
// then sets --font-display to var(--font-fraunces) over the top, the
// reference dangles, and every heading silently falls back to the body
// font. The two namespaces have to stay distinct.
const display = Fraunces({
  subsets: ["latin"],
  weight: "variable",
  axes: ["opsz", "SOFT", "WONK"],
  variable: "--font-fraunces",
});

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: "variable",
  variable: "--font-plex-sans",
});

// Not variable — Plex Mono ships as a static family — and only the two
// weights the app actually reaches for. Six uses of font-mono exist in
// the codebase, so shipping all seven weights would be seven files for
// nothing.
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

// Wrapped so generateMetadata and the layout itself share one query per
// request rather than two — the same reason src/lib/session.ts caches
// getCurrentSession. Falls back to the generic title on a DB error for
// the same build-time reason the layout does (nothing is reachable at
// build, and _not-found is prerendered).
const getCommunity = cache(async () => {
  try {
    return await getOrCreateCommunity();
  } catch {
    return null;
  }
});

// The browser tab said "Orchard" for every community on every install.
// This is a single-tenant app whose whole premise is that a community
// runs its own instance, so the community's name is the thing someone
// should see in their tab strip and their history.
export async function generateMetadata(): Promise<Metadata> {
  const community = await getCommunity();
  const name = community?.name?.trim();
  return {
    title: name || "Orchard",
    description: "Task-based, distributed-effort coordination.",
  };
}

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
  const community = await getCommunity();
  const accentStyle = {
    "--accent-1": community?.accentPrimary || DEFAULT_ACCENT_1,
    "--accent-2": community?.accentSecondary || DEFAULT_ACCENT_2,
  } as React.CSSProperties;

  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${mono.variable}`}
      style={accentStyle}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="bg-[var(--bg)] text-[var(--text)]">{children}</body>
    </html>
  );
}

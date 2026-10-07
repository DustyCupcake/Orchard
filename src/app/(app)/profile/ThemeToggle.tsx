"use client";

import { useSyncExternalStore } from "react";

const THEME_KEY = "orchard.theme";
type ThemePref = "system" | "light" | "dark";

// Personal, client-only preference — no DB field, per
// design_handoff_conventions/README.md's own "simplest: client-only
// localStorage, no DB/round-trip needed unless cross-device sync
// matters." src/app/layout.tsx's inline THEME_INIT_SCRIPT reads the
// same key before first paint so there's no flash on later loads.
// The choice lives on <html data-theme>: THEME_INIT_SCRIPT sets it from
// localStorage before first paint and `choose` keeps it current, so reading
// it back is reading what the page is actually showing — and works when
// localStorage is unavailable, where the toggle still changes this tab. Read
// through useSyncExternalStore because the server has no document: it renders
// "system" and the client re-reads once hydrated.
function subscribeToTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

function currentTheme(): ThemePref {
  const attr = document.documentElement.getAttribute("data-theme");
  return attr === "light" || attr === "dark" ? attr : "system";
}

export default function ThemeToggle() {
  const pref = useSyncExternalStore<ThemePref>(subscribeToTheme, currentTheme, () => "system");

  function choose(next: ThemePref) {
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    try {
      if (next === "system") window.localStorage.removeItem(THEME_KEY);
      else window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // localStorage unavailable — the attribute above still updates this
      // tab's own view, just won't persist.
    }
  }

  const options: { key: ThemePref; label: string }[] = [
    { key: "system", label: "System" },
    { key: "light", label: "Light" },
    { key: "dark", label: "Dark" },
  ];

  return (
    <div className="inline-flex w-fit overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)]">
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          onClick={() => choose(o.key)}
          className={`px-3.5 py-1.5 text-[length:var(--text-body)] font-medium ${i > 0 ? "border-l border-[var(--border)]" : ""} ${
            pref === o.key ? "bg-[var(--surface-sunken)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

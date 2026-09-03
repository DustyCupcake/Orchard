"use client";

import { useEffect, useState } from "react";

const THEME_KEY = "orchard.theme";
type ThemePref = "system" | "light" | "dark";

// Personal, client-only preference — no DB field, per
// design_handoff_conventions/README.md's own "simplest: client-only
// localStorage, no DB/round-trip needed unless cross-device sync
// matters." src/app/layout.tsx's inline THEME_INIT_SCRIPT reads the
// same key before first paint so there's no flash on later loads.
export default function ThemeToggle() {
  const [pref, setPref] = useState<ThemePref>("system");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(THEME_KEY);
      if (stored === "light" || stored === "dark") setPref(stored);
    } catch {
      // localStorage unavailable — stay on "system"
    }
  }, []);

  function choose(next: ThemePref) {
    setPref(next);
    try {
      if (next === "system") {
        window.localStorage.removeItem(THEME_KEY);
        document.documentElement.removeAttribute("data-theme");
      } else {
        window.localStorage.setItem(THEME_KEY, next);
        document.documentElement.setAttribute("data-theme", next);
      }
    } catch {
      // localStorage unavailable — the in-memory toggle above still
      // updates this tab's own view, just won't persist.
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
          className={`px-3.5 py-1.5 text-[13px] font-medium ${i > 0 ? "border-l border-[var(--border)]" : ""} ${
            pref === o.key ? "bg-[var(--surface-sunken)] text-[var(--text)]" : "text-[var(--text-muted)] hover:bg-[var(--surface-sunken)]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

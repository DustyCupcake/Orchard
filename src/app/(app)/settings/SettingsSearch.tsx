"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { searchSettings, settingsEntryHref, type SettingsSearchEntry } from "./search";

// Opens whatever the URL's #fragment points at. The settings are collapsed
// cards (<details>) and groups (<fieldset> around one), and a browser only
// scrolls to a closed card — it won't open it — so a search result that
// landed on a collapsed card would show you its title and nothing else.
// Runs on load (a result on another tab is a full navigation) and on
// `hashchange` (a result on the same tab only changes the fragment).
function revealFragmentTarget() {
  const id = decodeURIComponent(window.location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  if (target instanceof HTMLDetailsElement) {
    target.open = true;
  } else if (target.tagName === "FIELDSET") {
    const inner = target.querySelector(":scope > details");
    if (inner instanceof HTMLDetailsElement) inner.open = true;
  }
  for (let el = target.parentElement; el; el = el.parentElement) {
    if (el instanceof HTMLDetailsElement) el.open = true;
  }
  target.scrollIntoView({ block: "start" });
}

export default function SettingsSearch({ entries }: { entries: SettingsSearchEntry[] }) {
  const [query, setQuery] = useState("");
  const inputId = useId();
  const listId = useId();

  useEffect(() => {
    revealFragmentTarget();
    window.addEventListener("hashchange", revealFragmentTarget);
    return () => window.removeEventListener("hashchange", revealFragmentTarget);
  }, []);

  const results = useMemo(() => searchSettings(entries, query), [entries, query]);
  const searching = query.trim().length > 0;

  return (
    <div role="search" className="relative">
      <label htmlFor={inputId} className="sr-only">
        Search settings
      </label>
      <input
        id={inputId}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setQuery("");
          // Enter goes to the best match. A plain navigation, like a click on
          // the link: a result can be on another tab.
          if (e.key === "Enter" && results[0]) {
            e.preventDefault();
            window.location.assign(settingsEntryHref(results[0]));
          }
        }}
        placeholder="Search settings — colours, sso, doors, diet…"
        autoComplete="off"
        aria-controls={listId}
        className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[length:var(--text-body)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none"
      />
      <div id={listId} aria-live="polite">
        {searching && results.length === 0 && (
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            No setting matches &ldquo;{query.trim()}&rdquo;.
          </p>
        )}
        {results.length > 0 && (
          <ul className="mt-2 flex flex-col overflow-hidden rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)]">
            {results.map((entry) => (
              <li key={`${entry.tab}#${entry.anchor ?? ""}`} className="border-b border-[var(--border)] last:border-b-0">
                {/* A plain <a>, not <Link>: a client-side navigation to
                    another tab wouldn't re-run the reveal above. */}
                <a
                  href={settingsEntryHref(entry)}
                  className="flex flex-col gap-0.5 px-3 py-2 hover:bg-[var(--surface-sunken)] focus-visible:bg-[var(--surface-sunken)] focus-visible:outline-none"
                >
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{entry.title}</span>
                    <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{entry.tabLabel}</span>
                  </span>
                  <span className="text-[length:var(--text-meta)] leading-snug text-[var(--text-muted)]">{entry.summary}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { BUTTON_SECONDARY } from "./ui/kit";

// docs/development-plan.md's Phase 66 — "gives sharing a way to route
// around" a cross-cycle-boundary mismatch. `path` is the exact URL to
// copy (callers control whether it carries a "?scope=" segment or
// not); this component only ever handles the clipboard write and the
// transient "Copied" feedback, never the scope logic itself.
export default function CopyLinkButton({ path, label }: { path: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);

  async function handleClick() {
    const fullUrl = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-write can be denied outright (no HTTPS, a strict
      // permissions policy) — fall back to a selectable URL rather
      // than failing silently with an uncaught rejection.
      setUrl(fullUrl);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={handleClick} className={BUTTON_SECONDARY}>
        {copied ? "Copied!" : label}
      </button>
      {url && (
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="w-56 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[12px] text-[var(--text)]"
        />
      )}
    </span>
  );
}

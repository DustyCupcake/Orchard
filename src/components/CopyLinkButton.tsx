"use client";

import { useState } from "react";

// Compact link-copy button. Clicking the main icon copies the default
// link; the small arrow opens a dropdown with the scoped-link option.
// docs/development-plan.md's Phase 66 — "gives sharing a way to route
// around" cross-cycle-boundary mismatches.
export default function CopyLinkButton({
  path,
  scopedPath,
  scopedLabel,
}: {
  path: string;
  scopedPath?: string;
  scopedLabel?: string;
}) {
  const [copied, setCopied] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function copy(targetPath: string) {
    const fullUrl = `${window.location.origin}${targetPath}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      setOpen(false);
    } catch {
      setUrl(fullUrl);
    }
  }

  return (
    <span className="inline-flex items-center gap-1">
      <span className="relative inline-flex items-center">
        <button
          type="button"
          onClick={() => copy(path)}
          title={copied ? "Copied!" : "Copy link"}
          className="inline-flex h-7 items-center gap-1 rounded-l-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <LinkIcon />
          {copied && <span className="text-[var(--success)]">✓</span>}
        </button>
        {scopedPath && scopedLabel && (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex h-7 items-center rounded-r-[var(--radius-md)] border border-l-0 border-[var(--border)] bg-[var(--surface)] px-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
              title="More link options"
            >
              ▼
            </button>
            {open && (
              <div className="absolute right-0 top-8 z-10 w-56 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-2 shadow-sm">
                <button
                  type="button"
                  onClick={() => copy(scopedPath)}
                  className="w-full rounded px-2 py-1 text-left text-[12px] text-[var(--text)] hover:bg-[var(--surface-sunken)]"
                >
                  Copy {scopedLabel} link
                </button>
              </div>
            )}
          </>
        )}
      </span>
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

function LinkIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

import type { ReactNode } from "react";

// Shared design-token primitives — see design_handoff_conventions/README.md.
// Extracted once real duplication showed up across dashboard/board/task
// pages (the same Tag markup, the same button class strings, repeated
// verbatim) rather than upfront — see each call site for how these get used.

export type Tone = "neutral" | "accent" | "accent2" | "warning" | "danger" | "success";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-[var(--neutral-100)] text-[var(--text-muted)]",
  accent: "bg-[var(--accent-1-soft)] text-[var(--accent-1)]",
  accent2: "bg-[var(--accent-2-soft)] text-[var(--accent-2)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)] border border-[var(--warning-border)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)] border border-[var(--danger-border)]",
  success: "bg-[var(--success-soft)] text-[var(--success)] border border-[var(--success-border)]",
};

// Task.attention_level → Tag tone, shared by every page that shows a
// task's attention state (dashboard, board, task detail).
export const ATTENTION_TONE: Record<string, Tone> = { soft: "warning", hard: "danger", escalated: "danger" };

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] font-medium tracking-wide ${TONE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

// A rounded, tone-colored notice box — the inline (not shell-banner)
// counterpart of AppShell's View-as/on-site banners, for a page's own
// error/success/notice messages.
export function Banner({ tone, children }: { tone: Exclude<Tone, "neutral" | "accent" | "accent2">; children: ReactNode }) {
  const toneVar = tone === "warning" ? "warning" : tone === "danger" ? "danger" : "success";
  return (
    <div
      className="mb-4 rounded-[var(--radius-md)] px-3.5 py-2.5 text-[13px]"
      style={{
        background: `var(--${toneVar}-soft)`,
        border: `1px solid var(--${toneVar}-border)`,
        color: `var(--${toneVar})`,
      }}
    >
      {children}
    </div>
  );
}

export const BUTTON_PRIMARY =
  "rounded-[var(--radius-md)] bg-[var(--accent-1)] px-3.5 py-1.5 text-[13px] font-medium text-[var(--accent-1-fg)] hover:bg-[var(--accent-1-hover)] active:bg-[var(--accent-1-active)] disabled:opacity-45 disabled:cursor-not-allowed";
export const BUTTON_SECONDARY =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-3.5 py-1.5 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)] disabled:opacity-45 disabled:cursor-not-allowed";
export const BUTTON_GHOST =
  "rounded-[var(--radius-md)] bg-transparent px-2.5 py-1.5 text-[13px] font-medium text-[var(--accent-1)] hover:bg-[var(--accent-1-softer)] disabled:opacity-45 disabled:cursor-not-allowed";
export const BUTTON_DESTRUCTIVE =
  "rounded-[var(--radius-md)] bg-[var(--danger)] px-3.5 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-45 disabled:cursor-not-allowed";

export const INPUT =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none";
export const SELECT = INPUT;
export const CARD = "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4";
export const LABEL = "text-[12px] font-medium text-[var(--text-muted)]";

"use client";

import type { ReactNode } from "react";

// The three controls LaneRulesEditor needs that the shared kit doesn't
// have. They are its own file rather than three more exports from
// components/ui/kit because they are *controlled* inputs — the editor
// owns the rules in React state so the consequence sentence can update as
// you change them — and the kit's TextField/CheckField are deliberately
// uncontrolled server-rendered inputs. Promoting controlled variants to
// the shared kit would put a `"use client"` boundary in the middle of a
// file every server page imports, so they stay here.

export function Select({
  label,
  name,
  value,
  onChange,
  options,
}: {
  label: ReactNode;
  name: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-medium text-[var(--text-muted)]">{label}</span>
      <select
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// The hidden-`off` pair, same reasoning as ToggleField in ./ui.tsx and
// for the same reason: the action needs to tell "off" from "not in this
// form" so it can write `false` rather than leaving the setting alone.
export function Toggle({
  label,
  name,
  checked,
  onChange,
}: {
  label: ReactNode;
  name: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
      <input type="hidden" name={name} value="off" />
      <input type="checkbox" name={name} value="on" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

export function Button({
  type,
  onClick,
  title,
  children,
}: {
  type: "button" | "submit";
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      title={title}
      className="rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent px-3 py-1 text-[13px] font-medium text-[var(--text)] hover:bg-[var(--neutral-100)]"
    >
      {children}
    </button>
  );
}

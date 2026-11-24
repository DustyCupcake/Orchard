"use client";

import type { ReactNode } from "react";
import { FunnelSimpleIcon, XIcon } from "@phosphor-icons/react";
import Modal from "./Modal";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL } from "./kit";

type Option = { value: string; label: string };

/**
 * One filter, described by its current value and how to change it. The bar
 * owns no state: the caller keeps it wherever it lives (React state on the
 * shift views, the URL on the task board) and passes the values and setters
 * in, so both pages get the same interaction.
 */
export type FilterField = { id: string; label: string } & (
  | {
      kind: "toggle";
      checked: boolean;
      onChange: (checked: boolean) => void;
      /** The chip's text when on; defaults to the label. */
      chipLabel?: string;
    }
  | {
      kind: "select";
      value: string | null;
      options: Option[];
      /** The "no filter" option's text. */
      anyLabel?: string;
      onChange: (value: string | null) => void;
    }
  | {
      kind: "multi";
      values: string[];
      options: Option[];
      onChange: (values: string[]) => void;
    }
  | {
      kind: "range";
      inputType: "date" | "time";
      from: string | null;
      to: string | null;
      /** How an end of the range reads in the chip. */
      format?: (value: string) => string;
      onChange: (range: { from: string | null; to: string | null }) => void;
    }
);

function optionLabel(options: Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** The chip for an active field, or null when the field is not filtering. */
export function chipFor(field: FilterField): { text: string; remove: () => void } | null {
  switch (field.kind) {
    case "toggle":
      return field.checked ? { text: field.chipLabel ?? field.label, remove: () => field.onChange(false) } : null;
    case "select":
      return field.value !== null
        ? { text: `${field.label}: ${optionLabel(field.options, field.value)}`, remove: () => field.onChange(null) }
        : null;
    case "multi":
      return field.values.length > 0
        ? {
            text: `${field.label}: ${field.values.map((v) => optionLabel(field.options, v)).join(", ")}`,
            remove: () => field.onChange([]),
          }
        : null;
    case "range": {
      if (!field.from && !field.to) return null;
      const f = field.format ?? ((v: string) => v);
      const span =
        field.from && field.to ? `${f(field.from)} – ${f(field.to)}` : field.from ? `from ${f(field.from)}` : `until ${f(field.to!)}`;
      return { text: `${field.label}: ${span}`, remove: () => field.onChange({ from: null, to: null }) };
    }
  }
}

function FieldControl({ field }: { field: FilterField }) {
  switch (field.kind) {
    case "toggle":
      return (
        <label className="flex items-center gap-2 text-[length:var(--text-body)]">
          <input type="checkbox" checked={field.checked} onChange={(e) => field.onChange(e.target.checked)} className="h-4 w-4" />
          {field.label}
        </label>
      );
    case "select":
      return (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>{field.label}</span>
          <select value={field.value ?? ""} onChange={(e) => field.onChange(e.target.value || null)} className={INPUT}>
            <option value="">{field.anyLabel ?? "Any"}</option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case "multi":
      return (
        <fieldset className="flex flex-col gap-1">
          <legend className={LABEL}>{field.label}</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {field.options.map((o) => (
              <label key={o.value} className="flex items-center gap-2 text-[length:var(--text-body)]">
                <input
                  type="checkbox"
                  checked={field.values.includes(o.value)}
                  onChange={(e) =>
                    field.onChange(e.target.checked ? [...new Set([...field.values, o.value])] : field.values.filter((v) => v !== o.value))
                  }
                  className="h-4 w-4"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
      );
    case "range":
      return (
        <div className="flex flex-col gap-1">
          <span className={LABEL}>{field.label}</span>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type={field.inputType}
              aria-label={`${field.label}, from`}
              value={field.from ?? ""}
              onChange={(e) => field.onChange({ from: e.target.value || null, to: field.to })}
              className={INPUT}
            />
            <span className="text-[var(--text-muted)]">to</span>
            <input
              type={field.inputType}
              aria-label={`${field.label}, to`}
              value={field.to ?? ""}
              onChange={(e) => field.onChange({ from: field.from, to: e.target.value || null })}
              className={INPUT}
            />
          </div>
        </div>
      );
  }
}

/**
 * The filter interaction both the shift views and the task board use: one
 * "Filters" button (with how many are on) that opens a dialog holding every
 * control, and a removable chip for each filter that is on. With nothing on,
 * the only thing taking space is the button — on a phone that is the whole
 * bar.
 *
 * Chips are rectangular, accent-soft, per the design conventions (no pill
 * shapes). Changes apply as they are made; "Done" just closes the dialog.
 */
export default function FilterBar({
  fields,
  onClear,
  clearable,
  trailing,
}: {
  fields: FilterField[];
  /** Resets every filter to the page's starting state. */
  onClear: () => void;
  /** Whether Clear does anything — false when the filters already sit at the starting state. Defaults to "any chip is showing". */
  clearable?: boolean;
  /** Extra controls after the chips (the board's sort link). */
  trailing?: ReactNode;
}) {
  const chips = fields.flatMap((f) => {
    const chip = chipFor(f);
    return chip ? [{ id: f.id, ...chip }] : [];
  });

  const canClear = clearable ?? chips.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Modal
        trigger={
          <span className="inline-flex items-center gap-1.5">
            <FunnelSimpleIcon size={16} />
            Filters
            {chips.length > 0 && (
              <span className="rounded-[var(--radius-sm)] bg-[var(--accent-1)] px-1.5 text-[length:var(--text-nano)] font-medium text-[var(--accent-1-fg)]">
                {chips.length}
              </span>
            )}
          </span>
        }
        triggerClassName={BUTTON_SECONDARY}
        title="Filters"
      >
        <div className="flex flex-col gap-4">
          {fields.map((f) => (
            <FieldControl key={f.id} field={f} />
          ))}
        </div>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={onClear} disabled={!canClear} className={BUTTON_GHOST}>
            Clear filters
          </button>
          <form method="dialog">
            <button type="submit" className={BUTTON_PRIMARY}>
              Done
            </button>
          </form>
        </div>
      </Modal>
      {chips.map((c) => (
        <span
          key={c.id}
          className="inline-flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--accent-1-border)] bg-[var(--accent-1-soft)] py-0.5 pl-2 pr-1 text-[length:var(--text-meta)] font-medium text-[var(--accent-1)]"
        >
          {c.text}
          <button
            type="button"
            onClick={c.remove}
            aria-label={`Remove filter: ${c.text}`}
            className="rounded-[var(--radius-sm)] p-0.5 hover:bg-[var(--accent-1-softer)]"
          >
            <XIcon size={12} weight="bold" />
          </button>
        </span>
      ))}
      {canClear && (
        <button type="button" onClick={onClear} className="text-[length:var(--text-meta)] text-[var(--text-muted)] hover:text-[var(--text)]">
          Clear
        </button>
      )}
      {trailing}
    </div>
  );
}

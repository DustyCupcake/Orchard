"use client";

import { useState } from "react";
import { BUTTON_GHOST, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";
import type { BudgetLineItem } from "@/lib/budget";

type Row = BudgetLineItem & { key: string };

// A row's key is generated once, when it's added, and never touched
// again — same reasoning FormBuilder's own generateFieldKey gives:
// it's a React list key, not a stored value, so nothing needs it to be
// stable across page loads, only across re-renders of this one editor.
function generateKey(): string {
  return `item_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyRow(): Row {
  return { key: generateKey(), label: "", amount: 0 };
}

function toLineItem(row: Row): BudgetLineItem {
  return {
    label: row.label,
    amount: row.amount,
    quantity: row.quantity,
    perAttendee: row.perAttendee,
    branchId: row.branchId,
  };
}

type MultiplierMode = "none" | "quantity" | "attendee";

function modeOf(row: Row): MultiplierMode {
  if (row.perAttendee) return "attendee";
  if (row.quantity) return "quantity";
  return "none";
}

// Structured entry for a BudgetCycle's fixed costs or a proposal's
// line items — see cycles.ts's lineItemInput for the shape this
// mirrors. Modeled on settings/FormBuilder.tsx + FieldShapeEditor.tsx
// (the codebase's existing dynamic add/remove-row pattern): local
// row state here, still submitted through the surrounding plain
// <form action={serverAction}> via one hidden JSON input, so the
// Server Action's own parsing/Zod validation stays the single source
// of truth — this component only has to produce the right shape, not
// re-implement validation.
//
// The quantity/per-attendee choice is one select, not two independent
// checkboxes — Splitwise's own team held off shipping quantity
// multipliers on itemized bills specifically because two ways to
// scale an item risked confusing the common (unmultiplied) case; one
// mutually-exclusive control sidesteps that by construction.
export default function LineItemsEditor({
  name,
  initialItems,
  branches,
  minItems = 0,
}: {
  name: string;
  initialItems: BudgetLineItem[];
  branches: { id: string; name: string }[];
  minItems?: number;
}) {
  const [rows, setRows] = useState<Row[]>(
    initialItems.length > 0 ? initialItems.map((item) => ({ ...item, key: generateKey() })) : [emptyRow()],
  );

  function updateRow(index: number, next: Partial<BudgetLineItem>) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...next } : r)));
  }

  function setMode(index: number, mode: MultiplierMode) {
    if (mode === "none") updateRow(index, { quantity: undefined, perAttendee: undefined });
    else if (mode === "attendee") updateRow(index, { quantity: undefined, perAttendee: true });
    else updateRow(index, { quantity: rows[index].quantity ?? 2, perAttendee: undefined });
  }

  function removeRow(index: number) {
    setRows((prev) => prev.filter((_, i) => i !== index));
  }

  // Blank/incomplete rows (still being typed into, or left empty)
  // never make it into the submitted payload — a half-filled row is a
  // draft, not a line item.
  const payload = rows.filter((r) => r.label.trim() && r.amount > 0).map(toLineItem);

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name={name} value={JSON.stringify(payload)} />
      {rows.map((row, i) => {
        const mode = modeOf(row);
        return (
          <div
            key={row.key}
            className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2"
          >
            <input
              type="text"
              placeholder="Label"
              value={row.label}
              onChange={(e) => updateRow(i, { label: e.target.value })}
              className={`${INPUT} min-w-0 flex-1 basis-40`}
            />
            <input
              type="number"
              min={1}
              placeholder="Amount"
              value={row.amount || ""}
              onChange={(e) => updateRow(i, { amount: Number(e.target.value) || 0 })}
              className={`${INPUT} w-24`}
            />
            <select
              value={mode}
              onChange={(e) => setMode(i, e.target.value as MultiplierMode)}
              className={`${INPUT} w-auto`}
              aria-label="Multiplier"
            >
              <option value="none">×1</option>
              <option value="quantity">fixed quantity…</option>
              <option value="attendee">× attendees</option>
            </select>
            {mode === "quantity" && (
              <input
                type="number"
                min={2}
                value={row.quantity}
                onChange={(e) => updateRow(i, { quantity: Number(e.target.value) || 2 })}
                className={`${INPUT} w-16`}
                aria-label="Quantity"
              />
            )}
            <select
              value={row.branchId ?? ""}
              onChange={(e) => updateRow(i, { branchId: e.target.value || undefined })}
              className={`${INPUT} w-auto`}
              aria-label="Branch"
            >
              <option value="">No branch</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            {rows.length > minItems && (
              <button type="button" onClick={() => removeRow(i)} className={BUTTON_GHOST}>
                Remove
              </button>
            )}
          </div>
        );
      })}
      <button type="button" onClick={() => setRows((prev) => [...prev, emptyRow()])} className={`${BUTTON_SECONDARY} w-fit`}>
        + Add line item
      </button>
    </div>
  );
}

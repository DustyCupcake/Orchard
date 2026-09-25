"use client";

import { useState } from "react";

type ReassignmentItem = {
  id: string;
  title: string;
  branchNameHint: string;
};

type BranchOption = {
  id: string;
  name: string;
};

/**
 * The board's bulk-selection idea, adapted to this one-time review
 * screen. The final server action accepts both the selected IDs and the
 * chosen destination, so a reviewer can either use "Apply to selected"
 * for immediate feedback or simply confirm the form after choosing a
 * bulk destination. Per-task selects still take precedence.
 */
export default function ReassignmentBulkSelect({
  items,
  branches,
}: {
  items: ReassignmentItem[];
  branches: BranchOption[];
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [branchId, setBranchId] = useState("");

  const allSelected = selected.size === items.length && items.length > 0;
  const toggle = (id: string, on: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };
  const setAll = (on: boolean) => {
    setSelected(on ? new Set(items.map((item) => item.id)) : new Set());
  };
  const applyToSelected = () => {
    if (!branchId) return;
    for (const item of items) {
      if (!selected.has(item.id)) continue;
      const select = document.getElementById(`item-branch-${item.id}`) as HTMLSelectElement | null;
      if (select) select.value = branchId;
    }
  };

  return (
    <fieldset
      style={{
        border: "1px solid #bbb",
        borderRadius: 6,
        padding: "0.75rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
      }}
    >
      <legend style={{ fontWeight: 600 }}>Bulk assign a branch</legend>
      <p style={{ color: "#666", fontSize: "0.85rem", margin: 0 }}>
        Choose a destination, select the tasks that belong there, then apply it or confirm the
        whole import. Individual choices below always win.
      </p>
      <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={(event) => setAll(event.target.checked)}
        />
        Select all tasks
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: "0.3rem", fontSize: "0.9rem" }}>
        Destination branch
        <select
          name="bulkBranchId"
          value={branchId}
          onChange={(event) => setBranchId(event.target.value)}
          style={{ padding: "0.3rem" }}
        >
          <option value="">Choose a branch</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </select>
      </label>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        {items.map((item) => (
          <label
            key={item.id}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.9rem" }}
          >
            <input
              type="checkbox"
              name="bulkItemIds"
              value={item.id}
              checked={selected.has(item.id)}
              onChange={(event) => toggle(item.id, event.target.checked)}
            />
            {item.title} <span style={{ color: "#666" }}>(was &ldquo;{item.branchNameHint}&rdquo;)</span>
          </label>
        ))}
      </div>
      <button
        type="button"
        onClick={applyToSelected}
        disabled={!branchId || selected.size === 0}
        style={{ padding: "0.4rem 1rem", width: "fit-content", opacity: !branchId || selected.size === 0 ? 0.5 : 1 }}
      >
        Apply to selected ({selected.size})
      </button>
    </fieldset>
  );
}

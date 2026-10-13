"use client";

import { useState } from "react";
import { INPUT, LABEL } from "@/components/ui/kit";

// What each backer of a budget proposal stands behind, with the figure's
// meaning worked out as it is typed: the right number depends on a community's
// currency and scale, which the app does not know, so a bare input would be a
// number chosen blind. See docs/plans/archive/budget-funds-plan.md D12.
export default function PerBackerField({ defaultValue }: { defaultValue: number | null }) {
  const [raw, setRaw] = useState(defaultValue ? String(defaultValue) : "");
  const per = Number(raw);
  const on = Number.isFinite(per) && per > 0;

  const examples = on ? [per / 2, per, per * 3].map((n) => Math.round(n)) : [];
  const backersFor = (amount: number) => Math.max(1, Math.ceil(amount / per));

  return (
    <label className="flex w-full max-w-[420px] flex-col gap-1">
      <span className={LABEL}>Each person behind a proposal stands behind</span>
      <input
        type="number"
        name="fundSupportPerBacker"
        min={0}
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        placeholder="Not set"
        className={INPUT}
      />
      <span className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
        The proposer is the first person behind it and everyone who supports it is another, so a proposal
        can be approved up to the number of people behind it times this. Leave it empty and nothing needs
        backing: the budget&rsquo;s owner decides alone.
      </span>
      {on && (
        <ul className="mt-1 flex flex-col gap-0.5 text-[length:var(--text-meta)] text-[var(--text)]">
          {examples.map((amount) => (
            <li key={amount}>
              A proposal for {amount} needs {backersFor(amount)} {backersFor(amount) === 1 ? "person" : "people"} behind
              it{backersFor(amount) === 1 ? " — just the proposer" : ""}.
            </li>
          ))}
        </ul>
      )}
    </label>
  );
}

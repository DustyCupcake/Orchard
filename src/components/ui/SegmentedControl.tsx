"use client";

// Buttons-stuck-together control — all options always visible, one
// active at a time (docs/design_handoff_conventions/README.md's Form
// fields entry names this pattern but nothing built it yet). Purely
// controlled/presentational: it has no name of its own and submits
// nothing — callers that need this choice in a form pair it with a
// hidden input carrying the real field name/value (see
// DateModeField.tsx for the pattern this was built for).
export default function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  size?: "md" | "sm";
}) {
  return (
    <div
      role="radiogroup"
      className="inline-flex w-fit rounded-[var(--radius-md)] border border-[var(--border)] p-0.5"
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="radio"
          aria-checked={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`rounded-[var(--radius-sm)] font-medium transition-colors ${
            size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[13px]"
          } ${
            value === opt.value
              ? "bg-[var(--accent-1)] text-[var(--accent-1-fg)]"
              : "text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--text)]"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

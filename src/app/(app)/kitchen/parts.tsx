import type { ReactNode } from "react";
import { BUTTON_PRIMARY, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ALLERGEN_FLAGS, ALLERGEN_FLAG_LABELS, type AllergenFlag } from "@/lib/kitchen/dietary";

// Small pieces the Kitchen's tabs share. Server components throughout; the
// recipe form and its ingredient rows are client components in their own files
// because they need to restore a refused submission.

export function SectionHeading({ children }: { children: ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

export function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  type = "text",
  rows,
  required,
  min,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  type?: string;
  rows?: number;
  required?: boolean;
  min?: number;
  hint?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      {rows ? (
        <textarea name={name} defaultValue={defaultValue} placeholder={placeholder} rows={rows} className={INPUT} />
      ) : (
        <input
          type={type}
          name={name}
          defaultValue={defaultValue}
          placeholder={placeholder}
          required={required}
          min={min}
          className={INPUT}
        />
      )}
      {hint && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

// The bounded flag vocabulary as checkboxes sharing one name — unchecked
// boxes simply don't submit (see actions.ts's allergenFlags). `allowNone`
// adds the "None known" statement, which a holder uses to say a dish has
// been checked and declares nothing; a suggester doesn't get it, because a
// suggestion only claims what its author knows.
export function FlagPicker({ defaultValue, allowNone = false }: { defaultValue: string[]; allowNone?: boolean }) {
  const flags = allowNone ? ALLERGEN_FLAGS : ALLERGEN_FLAGS.filter((f) => f !== "none_known");
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {flags.map((flag) => (
        <CheckField
          key={flag}
          name="allergenFlags"
          value={flag}
          label={ALLERGEN_FLAG_LABELS[flag]}
          defaultChecked={defaultValue.includes(flag)}
        />
      ))}
    </div>
  );
}

export function FlagTags({ flags }: { flags: string[] }) {
  const visible = flags.filter((f) => f !== "none_known");
  if (visible.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((f) => (
        <Tag key={f}>{ALLERGEN_FLAG_LABELS[f as AllergenFlag] ?? f}</Tag>
      ))}
    </div>
  );
}

// An amount as it should read: the numeric column hands back "400" or
// "0.5000", and null is a line with no amount ("to taste").
export function formatAmount(amount: string | number | null): string {
  if (amount === null || amount === undefined) return "";
  const n = Number(amount);
  return Number.isFinite(n) ? String(n) : String(amount);
}

export function ingredientText(ing: { amount: string | number | null; unit: string | null; name: string }): string {
  const measure = [formatAmount(ing.amount), ing.unit ?? ""].filter(Boolean).join(" ");
  return measure ? `${measure} ${ing.name}` : `${ing.name} — to taste`;
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] px-6 py-10 text-center">
      <p className="max-w-[460px] text-[length:var(--text-body)] text-[var(--text-muted)]">{children}</p>
      {action}
    </div>
  );
}

/**
 * A suggestion that isn't a recipe: a dish request ("something with beans")
 * or a preference ("fewer onions"). A title and a few words, because there
 * is nothing structured to ask — if the member has a recipe, the recipe form
 * is the better door.
 */
export function LightIdeaForm({
  action,
  hidden,
  kind,
  initial,
  submitLabel,
  cancel,
}: {
  action: (formData: FormData) => void | Promise<void>;
  hidden: Record<string, string>;
  kind: "dish_request" | "preference";
  initial?: { title: string; body: string | null };
  submitLabel: string;
  cancel?: ReactNode;
}) {
  const copy =
    kind === "dish_request"
      ? { label: "What would you like to see on the menu?", placeholder: "e.g. something with chickpeas", body: "Anything that helps — an occasion, who it's for" }
      : { label: "What should the kitchen know?", placeholder: "e.g. fewer onions, more fruit at breakfast", body: "Anything that helps" };
  return (
    <form action={action} className="flex max-w-[640px] flex-col gap-5">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="kind" value={kind} />
      <TextField label={copy.label} name="title" defaultValue={initial?.title} placeholder={copy.placeholder} required />
      <TextField label="Details (optional)" name="body" rows={3} defaultValue={initial?.body ?? ""} placeholder={copy.body} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        {cancel}
      </div>
    </form>
  );
}

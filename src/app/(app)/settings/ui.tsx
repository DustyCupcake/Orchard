import type { ReactNode } from "react";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, SELECT } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
// Aliased, because the settings screen has its own `SelectField` below and
// the two are genuinely different things. This one is a bare `<select>`
// that re-establishes its selection when the server's answer changes;
// that one is a label, a hint, and a list of `{value, label}` options
// wrapped around it.
import ValueKeyedSelect from "@/components/ui/SelectField";

// The settings screen's own vocabulary, extracted because the page grew
// to ten tabs of hand-rolled fieldset/label/div stacks and they had
// drifted apart: four different section-heading sizes, two different
// card paddings, a `w-32` div wrapped around some numbers and not
// others, and a JSON textarea with its example jammed into a hint.
//
// Three things are actually being fixed here, and each one is a
// decision rather than a tidy-up:
//
// 1. **One card, one subject, one Save.** The old tabs were single giant
//    forms, so a typo in the decision-rules JSON silently rolled back the
//    door toggles somebody had just changed, and every unrelated setting
//    on the tab had to be resubmitted to fix one number. Cards save
//    themselves, and a failure lands back on the card that failed.
// 2. **Every card says what the setting *does*.** A field called
//    `recruitmentWiderDiscussionHours` tells an admin nothing;
//    "how long a concern stays open before it becomes nobody's problem"
//    does. This is the same legibility rule the joining plan applies to
//    the admission rules themselves (§5.1: "make every rule legible…
//    rather than abstract cells"), and it is the same rule the permission
//    panel's per-module hints already follow.
// 3. **A non-admin can actually read it.** The old page wrapped every tab
//    body in one `<fieldset disabled>`, which greys out 60% of the
//    prose along with the controls — so a member reading the settings
//    they have a stake in saw a wall of faded text. The primitives here
//    disable their own control and leave the explanation alone.

// --- layout ---------------------------------------------------------------

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-[22px] font-semibold text-[var(--text)]">{title}</h2>
        {description && <p className="mt-1 max-w-[620px] text-[13px] text-[var(--text-muted)]">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function CardShell({
  title,
  description,
  children,
  aside,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      {(title || description) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-medium text-[var(--text)]">{title}</h3>}
            {description && (
              <p className="mt-0.5 max-w-[560px] text-[12px] text-[var(--text-muted)]">{description}</p>
            )}
          </div>
          {aside}
        </div>
      )}
      {children}
    </div>
  );
}

// A card that saves itself. `action` is a server action, `submitLabel`
// the button's own wording — deliberately per-card rather than a global
// "Save", because "Save" on a screen with nine cards has never once told
// anybody what they are about to save.
//
// `state` is the reason this is a disclosure rather than a bare form. The
// default view of this screen is supposed to be *the community's current
// configuration*, and a card that is only a form says none of it until you
// open it — you cannot read how many branches exist, or whether single
// sign-on is on, or what a question's audience is, without opening every
// card on the tab to find out. So the collapsed side states the setting in
// a sentence, and the controls are what you get for changing it.
//
// The structure is not incidental: a `<summary>` and a `<form>` cannot share
// a parent, so the header lives in the summary and the form is its sibling
// inside the same `<details>`. `aside` is deliberately *not* in the summary
// either — it carries destructive actions (a branch's Delete) and a nested
// form, and putting either in a summary row is both invalid and wrong.
export function SettingsCard({
  title,
  state,
  description,
  aside,
  action,
  submitLabel = "Save",
  affordance = "Edit",
  children,
}: {
  title?: ReactNode;
  state?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  action: (formData: FormData) => void | Promise<void>;
  submitLabel?: string;
  /** What the collapsed row invites you to do. "Create" for a card whose
   *  subject doesn't exist yet — a create card labelled "Edit" is asking
   *  you to open something there is nothing to edit. */
  affordance?: string;
  children: ReactNode;
}) {
  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1">
        {title && <h3 className="text-[15px] font-medium text-[var(--text)]">{title}</h3>}
        {state && (
          <div className="w-full text-[12px] leading-relaxed text-[var(--text-muted)]">{state}</div>
        )}
        <span className="ml-auto text-[12px] text-[var(--accent-1)]">{affordance}</span>
      </summary>
      {description && (
        <p className="mt-2 max-w-[560px] text-[12px] leading-relaxed text-[var(--text-muted)]">
          {description}
        </p>
      )}
      <form action={action} className="mt-3 flex flex-col gap-3">
        {children}
        <div>
          <SubmitButton className={BUTTON_PRIMARY}>{submitLabel}</SubmitButton>
        </div>
      </form>
      {aside && <div className="mt-3">{aside}</div>}
    </details>
  );
}

// The same card without a form, for a list row that is edited elsewhere
// or a read-only explainer.
export function SettingsPanel({
  title,
  description,
  aside,
  children,
}: {
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <CardShell title={title} description={description} aside={aside}>
      <div className="flex flex-col gap-3">{children}</div>
    </CardShell>
  );
}

// --- fields ---------------------------------------------------------------

export function SettingsField({
  label,
  hint,
  children,
  wide,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  // For a control that should not be squeezed into a column (a select of
  // long form titles, a textarea). The default is a comfortable reading
  // measure rather than the old ad-hoc `w-32` divs, which is what made
  // the numbers feel arbitrary.
  wide?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${wide ? "w-full" : "max-w-[420px]"}`}>
      <span className={LABEL}>{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-relaxed text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

export function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  type = "text",
  required,
  wide,
}: {
  label: ReactNode;
  name: string;
  defaultValue?: string | number;
  placeholder?: string;
  hint?: ReactNode;
  type?: string;
  required?: boolean;
  wide?: boolean;
}) {
  return (
    <SettingsField label={label} hint={hint} wide={wide}>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required={required}
        className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-60`}
      />
    </SettingsField>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  rows = 4,
  hint,
  mono,
  wide = true,
  required,
}: {
  label: ReactNode;
  name: string;
  defaultValue?: string;
  rows?: number;
  hint?: ReactNode;
  mono?: boolean;
  wide?: boolean;
  required?: boolean;
}) {
  return (
    <SettingsField label={label} hint={hint} wide={wide}>
      <textarea
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        required={required}
        className={`${INPUT} ${mono ? "font-mono" : ""} disabled:cursor-not-allowed disabled:opacity-60`}
      />
    </SettingsField>
  );
}

// The settings screen's dropdown shape — a label, a hint and a wide
// variant — wrapping the *shared* `SelectField` rather than a bare
// `<select defaultValue>` of its own.
//
// The bare version was in this file from the start of the settings
// rebuild, and it has a bug that `src/components/ui/SelectField.tsx` was
// written to fix repo-wide: React treats `defaultValue` on an
// uncontrolled `<select>` as a mount-time default, and an uncontrolled
// select is uncontrolled in both renders, so a Server Action's
// `revalidatePath` genuinely refetches and the component genuinely
// re-renders with the right answer while the browser keeps showing the
// pre-save selection. Read that file's comment for the react-dom
// `updateDOMProperties` walkthrough. Shipping a second, unfixed dropdown
// on the one screen that was rebuilt specifically because it was being
// misread would have been a quiet regression of a fix that already
// existed, so this delegates and adds only the chrome.
export function SelectField({
  label,
  name,
  defaultValue,
  options,
  hint,
  wide,
}: {
  label: ReactNode;
  name: string;
  defaultValue?: string;
  options: { value: string; label: string; disabled?: boolean }[];
  hint?: ReactNode;
  wide?: boolean;
}) {
  return (
    <SettingsField label={label} hint={hint} wide={wide}>
      <ValueKeyedSelect
        name={name}
        defaultValue={defaultValue ?? ""}
        className={`${SELECT} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </ValueKeyedSelect>
    </SettingsField>
  );
}

// A checkbox with an explanation, which the old CheckField had no room
// for — every checkbox on the old settings page was a bare label, so the
// page's own copy about what a toggle *does* lived in a paragraph
// somewhere below a group of unrelated toggles.
//
// The paired hidden field is the standard fix for the real problem this
// exposes: an unchecked checkbox submits *nothing*, so a per-card form
// could not tell "off" from "not in this form". The hidden `off` makes
// the key always present in the form that owns it, and
// checkboxOf() in ./form-values reads it. That is why a toggle can live
// in its own card now and still turn itself off.
export function ToggleField({
  label,
  name,
  value,
  defaultChecked,
  hint,
  disabledReason,
}: {
  label: ReactNode;
  name: string;
  // Only needed when several toggles share one name (a modulesEnabled
  // group) — each box has to carry its own value, because formData.get
  // returns the first match and formData.getAll is what collects them.
  value?: string;
  defaultChecked?: boolean;
  hint?: ReactNode;
  // Shown instead of the control when the setting can't currently be
  // changed, with the reason attached — rather than greying a box and
  // leaving the reader to guess why.
  disabledReason?: string;
}) {
  if (disabledReason) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] text-[var(--text-muted)]">{label}</span>
        <span className="text-[12px] text-[var(--text-muted)]">{disabledReason}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-2 text-[13px] text-[var(--text)]">
        <input type="hidden" name={name} value="off" />
        <input
          type="checkbox"
          name={name}
          value={value ?? "on"}
          defaultChecked={defaultChecked}
        />
        {label}
      </span>
      {hint && <span className="max-w-[560px] text-[12px] leading-relaxed text-[var(--text-muted)]">{hint}</span>}
    </div>
  );
}

// The old FieldSet, kept for the handful of places that genuinely want a
// bordered group *inside* a card. Borders inside borders read as noise
// everywhere else, which is most of the old page.
export function FieldGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
      <legend className="px-1 text-[12px] font-medium text-[var(--text-muted)]">{legend}</legend>
      {children}
    </fieldset>
  );
}

// A code sample. The decision-rules editor's example used to be inline
// `<code>` inside a hint sentence, which is unreadable at the length it
// needs; a block that can be scrolled and selected is the difference
// between a copyable example and a wall of escaped JSON.
export function CodeSample({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--neutral-100)] p-3 text-[12px] leading-relaxed text-[var(--text-muted)]">
      {children}
    </pre>
  );
}

// The read-only banner. Every tab is readable by any member and editable
// only by Admins (docs/spec.md:430 — foundational settings are
// something a community deliberates about), so the one thing a non-admin
// needs told is that what they're looking at is the real configuration and
// not a preview.
export function ReadOnlyNote({ authorized }: { authorized: boolean }) {
  if (authorized) return null;
  return (
    <Banner tone="warning">
      You&rsquo;re seeing this read-only. Only Admins can change community settings, and every change is
      written to the community&rsquo;s change log.
    </Banner>
  );
}

export { BUTTON_PRIMARY, BUTTON_SECONDARY };

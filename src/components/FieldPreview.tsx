import { INPUT } from "@/components/ui/kit";

// The one real render path for "what does answering this field look
// like" — shared by /apply, /feedback (real, submittable renders) and
// the settings Form/ProfileQuestion builders' own live preview
// (docs/development-plan.md's Phase 58, disabled). No "use client"
// needed: nothing here owns state or an event handler, so it's safe to
// render from a Server Component (the two real pages) or from inside a
// client component (the builder's preview pane) equally — the same
// component either way is what actually guarantees "exactly as a
// submitter would see it," not just a visual approximation of it.
export type FieldPreviewShape = {
  label: string;
  responseType: "free_text" | "single_choice" | "multi_choice" | "date";
  options: string[];
  required: boolean;
};

export default function FieldPreview({
  field,
  name,
  disabled,
}: {
  field: FieldPreviewShape;
  // Omitted in preview mode (disabled=true) — nothing there ever
  // submits, so there's no real field to name.
  name?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-[var(--text)]">
        {field.label || <span className="text-[var(--text-muted)]">(untitled field)</span>}
        {field.required ? " *" : ""}
      </span>
      {field.responseType === "free_text" && (
        <textarea name={name} required={field.required} disabled={disabled} rows={3} className={INPUT} />
      )}
      {field.responseType === "date" && (
        <input type="date" name={name} required={field.required} disabled={disabled} className={`${INPUT} w-fit`} />
      )}
      {field.responseType === "single_choice" && (
        <div className="flex flex-col gap-1">
          {field.options.length === 0 && <span className="text-[13px] text-[var(--text-muted)]">(no options yet)</span>}
          {field.options.map((o, i) => (
            <label key={`${o}-${i}`} className="flex items-center gap-2 text-[13px] font-normal text-[var(--text)]">
              <input type="radio" name={name} value={o} required={field.required} disabled={disabled} /> {o}
            </label>
          ))}
        </div>
      )}
      {field.responseType === "multi_choice" && (
        <div className="flex flex-col gap-1">
          {field.options.length === 0 && <span className="text-[13px] text-[var(--text-muted)]">(no options yet)</span>}
          {field.options.map((o, i) => (
            <label key={`${o}-${i}`} className="flex items-center gap-2 text-[13px] font-normal text-[var(--text)]">
              <input type="checkbox" name={name} value={o} disabled={disabled} /> {o}
            </label>
          ))}
        </div>
      )}
    </label>
  );
}

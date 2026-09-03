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
    <label>
      {field.label || <span style={{ color: "#999" }}>(untitled field)</span>}
      {field.required ? " *" : ""}
      <br />
      {field.responseType === "free_text" && (
        <textarea name={name} required={field.required} disabled={disabled} rows={3} style={{ padding: "0.5rem", width: "100%" }} />
      )}
      {field.responseType === "date" && (
        <input type="date" name={name} required={field.required} disabled={disabled} style={{ padding: "0.5rem" }} />
      )}
      {field.responseType === "single_choice" && (
        <div>
          {field.options.length === 0 && <span style={{ color: "#999", fontWeight: 400 }}>(no options yet)</span>}
          {field.options.map((o, i) => (
            <label key={`${o}-${i}`} style={{ display: "block", fontWeight: 400 }}>
              <input type="radio" name={name} value={o} required={field.required} disabled={disabled} /> {o}
            </label>
          ))}
        </div>
      )}
      {field.responseType === "multi_choice" && (
        <div>
          {field.options.length === 0 && <span style={{ color: "#999", fontWeight: 400 }}>(no options yet)</span>}
          {field.options.map((o, i) => (
            <label key={`${o}-${i}`} style={{ display: "block", fontWeight: 400 }}>
              <input type="checkbox" name={name} value={o} disabled={disabled} /> {o}
            </label>
          ))}
        </div>
      )}
    </label>
  );
}

"use client";

// The one reusable "edit a field's shape" row — docs/development-
// plan.md's Phase 58: "the exact same field shape" Form.fields and
// ProfileQuestion already share. Pure controlled component: no local
// form/submission concerns of its own, just value in, onChange out —
// FormBuilder.tsx (an N-row list) and ProfileQuestionEditor.tsx (a
// single row) each own how their own surrounding <form> actually
// serializes the result, so this same row works for both without
// knowing which one it's in.
export type EditableFieldShape = {
  label: string;
  responseType: "free_text" | "single_choice" | "multi_choice" | "date";
  options: string[];
  required: boolean;
  isNameField?: boolean;
  isEmailField?: boolean;
};

const RESPONSE_TYPE_LABELS: Record<EditableFieldShape["responseType"], string> = {
  free_text: "Free text",
  single_choice: "Single choice",
  multi_choice: "Multi choice",
  date: "Date",
};

function isChoiceType(responseType: EditableFieldShape["responseType"]) {
  return responseType === "single_choice" || responseType === "multi_choice";
}

export default function FieldShapeEditor({
  value,
  onChange,
  allowedResponseTypes,
  showRoleTags,
  fieldKey,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  value: EditableFieldShape;
  onChange: (next: EditableFieldShape) => void;
  allowedResponseTypes: EditableFieldShape["responseType"][];
  // Form-only: "at most one field can be tagged as the name/email
  // field" (src/lib/forms.ts) — ProfileQuestion has no such concept.
  showRoleTags?: boolean;
  // Transparency only, never editable — src/lib/forms.ts's own
  // field.key is generated once when a field is added (see
  // FormBuilder.tsx) and never changes afterward, so existing
  // FormResponse.values lookups never silently break underneath an
  // edited label.
  fieldKey?: string;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const optionsError = isChoiceType(value.responseType) && value.options.filter((o) => o.trim()).length === 0;

  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          placeholder="Field label"
          style={{ padding: "0.3rem", flex: 1, minWidth: "10rem" }}
        />
        <select
          value={value.responseType}
          onChange={(e) =>
            onChange({
              ...value,
              responseType: e.target.value as EditableFieldShape["responseType"],
              // Stale options from a previous choice-type don't carry
              // forward once the field stops being choice-based.
              options: isChoiceType(e.target.value as EditableFieldShape["responseType"]) ? value.options : [],
            })
          }
          style={{ padding: "0.3rem" }}
        >
          {allowedResponseTypes.map((rt) => (
            <option key={rt} value={rt}>
              {RESPONSE_TYPE_LABELS[rt]}
            </option>
          ))}
        </select>
        <label style={{ fontSize: "0.8rem" }}>
          <input
            type="checkbox"
            checked={value.required}
            onChange={(e) => onChange({ ...value, required: e.target.checked })}
          />{" "}
          required
        </label>
        {showRoleTags && (
          <>
            <label style={{ fontSize: "0.8rem" }}>
              <input
                type="checkbox"
                checked={value.isNameField ?? false}
                onChange={(e) => onChange({ ...value, isNameField: e.target.checked })}
              />{" "}
              name field
            </label>
            <label style={{ fontSize: "0.8rem" }}>
              <input
                type="checkbox"
                checked={value.isEmailField ?? false}
                onChange={(e) => onChange({ ...value, isEmailField: e.target.checked })}
              />{" "}
              email field
            </label>
          </>
        )}
        {(onMoveUp || onMoveDown || onRemove) && (
          <span style={{ marginLeft: "auto", display: "flex", gap: "0.25rem" }}>
            {onMoveUp && (
              <button type="button" onClick={onMoveUp} title="Move up">
                ↑
              </button>
            )}
            {onMoveDown && (
              <button type="button" onClick={onMoveDown} title="Move down">
                ↓
              </button>
            )}
            {onRemove && (
              <button type="button" onClick={onRemove} title="Remove field">
                Remove
              </button>
            )}
          </span>
        )}
      </div>

      {isChoiceType(value.responseType) && (
        <div style={{ marginTop: "0.4rem", paddingLeft: "0.5rem" }}>
          {value.options.map((o, i) => (
            <div key={i} style={{ display: "flex", gap: "0.4rem", marginBottom: "0.25rem" }}>
              <input
                type="text"
                value={o}
                onChange={(e) => {
                  const next = [...value.options];
                  next[i] = e.target.value;
                  onChange({ ...value, options: next });
                }}
                placeholder={`Option ${i + 1}`}
                style={{ padding: "0.25rem", flex: 1 }}
              />
              <button
                type="button"
                onClick={() => onChange({ ...value, options: value.options.filter((_, j) => j !== i) })}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onChange({ ...value, options: [...value.options, ""] })}>
            + Add option
          </button>
          {optionsError && (
            <p style={{ color: "crimson", fontSize: "0.8rem", margin: "0.25rem 0 0" }}>
              A {RESPONSE_TYPE_LABELS[value.responseType].toLowerCase()} field needs at least one option.
            </p>
          )}
        </div>
      )}

      {fieldKey && (
        <p style={{ margin: "0.3rem 0 0", fontSize: "0.7rem", color: "#999" }}>key: {fieldKey}</p>
      )}
    </div>
  );
}

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
  mapsToProfileQuestionId?: string;
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
  profileQuestionOptions,
  fieldKey,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  value: EditableFieldShape;
  onChange: (next: EditableFieldShape) => void;
  allowedResponseTypes: EditableFieldShape["responseType"][];
  showRoleTags?: boolean;
  profileQuestionOptions?: { id: string; label: string }[];
  fieldKey?: string;
  onRemove?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const optionsError = isChoiceType(value.responseType) && value.options.filter((o) => o.trim()).length === 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={value.label}
          onChange={(e) => onChange({ ...value, label: e.target.value })}
          placeholder="Field label"
          className="min-w-[10rem] flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none"
        />
        <select
          value={value.responseType}
          onChange={(e) =>
            onChange({
              ...value,
              responseType: e.target.value as EditableFieldShape["responseType"],
              options: isChoiceType(e.target.value as EditableFieldShape["responseType"]) ? value.options : [],
            })
          }
          className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px] text-[var(--text)]"
        >
          {allowedResponseTypes.map((rt) => (
            <option key={rt} value={rt}>
              {RESPONSE_TYPE_LABELS[rt]}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
          <input
            type="checkbox"
            checked={value.required}
            onChange={(e) => onChange({ ...value, required: e.target.checked })}
          />{" "}
          required
        </label>
        {showRoleTags && (
          <>
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
              <input
                type="checkbox"
                checked={value.isNameField ?? false}
                onChange={(e) => onChange({ ...value, isNameField: e.target.checked })}
              />{" "}
              name field
            </label>
            <label className="flex items-center gap-1.5 text-[12px] text-[var(--text)]">
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
          <span className="ml-auto flex gap-1">
            {onMoveUp && (
              <button
                type="button"
                onClick={onMoveUp}
                title="Move up"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--text)]"
              >
                ↑
              </button>
            )}
            {onMoveDown && (
              <button
                type="button"
                onClick={onMoveDown}
                title="Move down"
                className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--text)]"
              >
                ↓
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                title="Remove field"
                className="inline-flex h-7 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] px-2 text-[12px] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--danger)]"
              >
                ✕
              </button>
            )}
          </span>
        )}
      </div>

      {isChoiceType(value.responseType) && (
        <div className="mt-2 flex flex-col gap-1.5 pl-1">
          {value.options.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                type="text"
                value={o}
                onChange={(e) => {
                  const next = [...value.options];
                  next[i] = e.target.value;
                  onChange({ ...value, options: next });
                }}
                placeholder={`Option ${i + 1}`}
                className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => onChange({ ...value, options: value.options.filter((_, j) => j !== i) })}
                title="Remove option"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--neutral-100)] hover:text-[var(--danger)]"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...value, options: [...value.options, ""] })}
            className="mt-0.5 w-fit text-[12px] font-medium text-[var(--accent-1)] hover:underline"
          >
            + Add option
          </button>
          {optionsError && (
            <p className="mt-0.5 text-[12px] text-[var(--danger)]">
              A {RESPONSE_TYPE_LABELS[value.responseType].toLowerCase()} field needs at least one option.
            </p>
          )}
        </div>
      )}

      {profileQuestionOptions && profileQuestionOptions.length > 0 && (
        <div className="mt-2">
          <label className="flex items-center gap-2 text-[12px] text-[var(--text)]">
            Maps to profile question
            <select
              value={value.mapsToProfileQuestionId ?? ""}
              onChange={(e) =>
                onChange({ ...value, mapsToProfileQuestionId: e.target.value || undefined })
              }
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[13px] text-[var(--text)]"
            >
              <option value="">— none —</option>
              {profileQuestionOptions.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {fieldKey && (
        <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">key: {fieldKey}</p>
      )}
    </div>
  );
}

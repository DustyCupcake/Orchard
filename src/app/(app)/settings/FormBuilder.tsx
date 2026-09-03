"use client";

import { useState } from "react";
import FieldPreview from "@/components/FieldPreview";
import FieldShapeEditor, { type EditableFieldShape } from "./FieldShapeEditor";

type BuilderField = EditableFieldShape & { key: string };

const FORM_RESPONSE_TYPES: EditableFieldShape["responseType"][] = ["free_text", "single_choice", "multi_choice"];

// A field's key is generated once, here, when it's added — and never
// touched again for the life of the field, even as its label/type/
// options are edited afterward. This is what lets "fully edit" an
// existing Form's fields (docs/development-plan.md's Phase 58) stay
// safe: an existing FormResponse.values lookup is keyed on this same
// string, so silently regenerating it from the (now-different) label
// would orphan every past answer under the old key. It also sidesteps
// "a field key must be unique within the same Form" by construction —
// random suffixes don't collide, so there's nothing for the builder to
// catch and flag here.
function generateFieldKey(): string {
  return `field_${Math.random().toString(36).slice(2, 10)}`;
}

function emptyField(): BuilderField {
  return { key: generateFieldKey(), label: "", responseType: "free_text", options: [], required: false };
}

export default function FormBuilder({
  action,
  mode,
  formId,
  initialTitle,
  initialDescription,
  initialAllowAnonymous,
  initialFields,
  submitLabel,
}: {
  action: (formData: FormData) => void;
  mode: "create" | "edit";
  formId?: string;
  initialTitle: string;
  initialDescription: string;
  initialAllowAnonymous: boolean;
  initialFields: BuilderField[];
  submitLabel: string;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [fields, setFields] = useState<BuilderField[]>(initialFields.length > 0 ? initialFields : [emptyField()]);

  // Enforces "at most one field can be tagged as the name/email field"
  // client-side too — src/lib/forms.ts's requireValidFields is the
  // real, load-bearing check; this just keeps the builder itself from
  // ever producing what that check would reject, by clearing the same
  // tag on every other row the instant one row's is checked.
  function updateFieldAt(index: number, next: EditableFieldShape) {
    setFields((prev) =>
      prev.map((f, i) => {
        if (i === index) return { ...next, key: f.key };
        return {
          ...f,
          isNameField: next.isNameField ? false : f.isNameField,
          isEmailField: next.isEmailField ? false : f.isEmailField,
        };
      }),
    );
  }

  function removeFieldAt(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index));
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((prev) => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  return (
    <form
      action={action}
      style={{ display: "flex", flexDirection: "row", gap: "1.5rem", flexWrap: "wrap", alignItems: "flex-start" }}
    >
      {formId && <input type="hidden" name="formId" value={formId} />}
      <input type="hidden" name="fieldsJson" value={JSON.stringify(fields)} />

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1, minWidth: "20rem" }}>
        <input
          type="text"
          name="title"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Form title"
          style={{ padding: "0.4rem" }}
        />
        <textarea
          name="description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="description (optional)"
          style={{ padding: "0.4rem" }}
        />

        {mode === "create" ? (
          <label>
            <input type="checkbox" name="allowAnonymous" defaultChecked={initialAllowAnonymous} /> allow anonymous
            submissions
          </label>
        ) : (
          <p style={{ fontSize: "0.8rem", color: "#666", margin: 0 }}>
            {initialAllowAnonymous ? "Anonymous submissions allowed" : "Anonymous submissions not allowed"} — set
            at creation, not editable here.
          </p>
        )}

        <p style={{ fontSize: "0.75rem", color: "#666", margin: "0.25rem 0" }}>
          Tag at most one field each as the name/email field if this form should be able to convert
          its submissions into real members (e.g. a Recruitment application form).
        </p>
        <div>
          {fields.map((f, i) => (
            <FieldShapeEditor
              key={f.key}
              value={f}
              onChange={(next) => updateFieldAt(i, next)}
              allowedResponseTypes={FORM_RESPONSE_TYPES}
              showRoleTags
              fieldKey={f.key}
              onRemove={fields.length > 1 ? () => removeFieldAt(i) : undefined}
              onMoveUp={i > 0 ? () => moveField(i, -1) : undefined}
              onMoveDown={i < fields.length - 1 ? () => moveField(i, 1) : undefined}
            />
          ))}
          <button type="button" onClick={() => setFields((prev) => [...prev, emptyField()])}>
            + Add field
          </button>
        </div>

        <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
          {submitLabel}
        </button>
      </div>

      <div style={{ flex: 1, minWidth: "18rem", border: "1px dashed #ccc", borderRadius: 6, padding: "0.75rem" }}>
        <p style={{ margin: "0 0 0.5rem", fontSize: "0.75rem", color: "#999", textTransform: "uppercase" }}>
          Preview — not submittable
        </p>
        <h3 style={{ margin: "0 0 0.25rem" }}>{title || "(untitled form)"}</h3>
        {description && <p style={{ color: "#666", margin: "0 0 0.75rem" }}>{description}</p>}
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          {fields.map((f) => (
            <FieldPreview key={f.key} field={f} disabled />
          ))}
        </div>
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import FieldShapeEditor from "./FieldShapeEditor";
import { RESPONSE_TYPES, type EditableFieldShape, type ResponseType } from "@/lib/field-shape";

const PROFILE_QUESTION_RESPONSE_TYPES: ResponseType[] = [...RESPONSE_TYPES];

export default function ProfileQuestionEditor({
  initial,
}: {
  initial: Omit<EditableFieldShape, "isNameField" | "isEmailField" | "mapsToProfileQuestionId">;
}) {
  const [field, setField] = useState<EditableFieldShape>(initial);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <input type="hidden" name="responseType" value={field.responseType} />
      {field.options.map((o, i) => (
        <input type="hidden" key={i} name="options" value={o} />
      ))}
      {/* The field-shape flags are serialized here rather than inside
          FieldShapeEditor, which is deliberately presentation-only (value
          in, onChange out) so FormBuilder can drive N rows of it. This
          component owns exactly one field, so it owns the form. */}
      <input type="hidden" name="multiline" value={field.multiline ? "on" : ""} />
      <input type="hidden" name="validation" value={field.validation} />
      <input type="hidden" name="allowOther" value={field.allowOther ? "on" : ""} />
      <input type="hidden" name="min" value={field.min ?? ""} />
      <input type="hidden" name="max" value={field.max ?? ""} />
      <input type="hidden" name="step" value={field.step ?? ""} />

      <div className="min-w-[16rem] flex-1">
        <input
          type="text"
          name="label"
          required
          value={field.label}
          onChange={(e) => setField({ ...field, label: e.target.value })}
          placeholder="Question label"
          className="mb-2 w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none"
        />
        <FieldShapeEditor
          value={field}
          onChange={setField}
          allowedResponseTypes={PROFILE_QUESTION_RESPONSE_TYPES}
        />
        {/* required lives inside FieldShapeEditor's own row, so the
            surrounding form still needs a real "required" input for
            native submission to pick up. */}
        <input type="hidden" name="required" value={field.required ? "on" : ""} />
      </div>

      <div className="min-w-[14rem] flex-1 rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
        <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
          Preview — not submittable
        </p>
        <FieldPreview field={toPreviewShape(field)} disabled />
      </div>
    </div>
  );
}

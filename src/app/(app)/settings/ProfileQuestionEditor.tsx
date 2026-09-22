"use client";

import { useState } from "react";
import FieldPreview from "@/components/FieldPreview";
import FieldShapeEditor, { type EditableFieldShape } from "./FieldShapeEditor";

const PROFILE_QUESTION_RESPONSE_TYPES: EditableFieldShape["responseType"][] = [
  "free_text",
  "single_choice",
  "multi_choice",
  "date",
];

export default function ProfileQuestionEditor({ initial }: { initial: EditableFieldShape }) {
  const [field, setField] = useState<EditableFieldShape>(initial);

  return (
    <div className="flex flex-wrap items-start gap-4">
      <input type="hidden" name="responseType" value={field.responseType} />
      {field.options.map((o, i) => (
        <input type="hidden" key={i} name="options" value={o} />
      ))}

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
        <FieldPreview field={field} disabled />
      </div>
    </div>
  );
}

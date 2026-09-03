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

// The single-field counterpart to FormBuilder.tsx — a ProfileQuestion
// IS one field (one row per question, per src/db/schema/profile-
// question.ts), not an array of them, so there's no add/remove/reorder
// here, just the same reusable FieldShapeEditor plus a live preview of
// what answering this one question actually looks like. Renders as a
// plain child inside the existing server-rendered create/update
// <form> in settings/page.tsx — it only needs to emit its own named
// inputs for that surrounding form to pick up on submit, not own a
// <form> of its own the way FormBuilder does.
export default function ProfileQuestionEditor({ initial }: { initial: EditableFieldShape }) {
  const [field, setField] = useState<EditableFieldShape>(initial);

  return (
    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
      <input type="hidden" name="responseType" value={field.responseType} />
      {field.options.map((o, i) => (
        <input type="hidden" key={i} name="options" value={o} />
      ))}

      <div style={{ flex: 1, minWidth: "16rem" }}>
        <input
          type="text"
          name="label"
          required
          value={field.label}
          onChange={(e) => setField({ ...field, label: e.target.value })}
          placeholder="Question label"
          style={{ padding: "0.4rem", width: "100%", marginBottom: "0.4rem" }}
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

      <div style={{ flex: 1, minWidth: "14rem", border: "1px dashed #ccc", borderRadius: 6, padding: "0.6rem" }}>
        <p style={{ margin: "0 0 0.4rem", fontSize: "0.7rem", color: "#999", textTransform: "uppercase" }}>
          Preview — not submittable
        </p>
        <FieldPreview field={field} disabled />
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import type { ResponseType } from "@/lib/field-shape";

type PrefilledAnswer = {
  question: {
    id: string;
    label: string;
    responseType: ResponseType;
    options: string[];
    multiline: boolean;
    validation: "none" | "email" | "phone" | "url";
    allowOther: boolean;
    min: number | null;
    max: number | null;
    step: number | null;
  };
  answer: { value: unknown };
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  // A boolean and a number are both real answers now that the field
  // shapes include them, and "—" would be a lie for either.
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return typeof value === "string" && value.trim() ? value : "—";
}

// A compact "here's what we already have" summary for once-ever
// ProfileQuestions this member already has a real answer for going
// into onboarding — in practice, almost always seeded by a Form
// field's mapsToProfileQuestionId at applicant→Member conversion (see
// src/lib/recruitment/decisions.ts). Not re-asked as open input the
// way a genuinely outstanding question is (src/lib/forms.ts's own
// "surfacing" comment: an already-answered question just doesn't need
// asking again) — the edit affordance is a deliberate confirmation-
// step pattern instead, so a member can correct a field without
// hunting for it on /profile, but isn't forced to touch it either.
export default function PrefilledAnswersReview({
  answers,
  action,
}: {
  answers: PrefilledAnswer[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  async function handleSubmit(formData: FormData) {
    await action(formData);
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="mb-5 flex items-start justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-[13px] text-[var(--text)]">
          <span className="font-medium">Already on file from your application — </span>
          {answers.map(({ question, answer }) => `${question.label}: ${formatValue(answer.value)}`).join(" · ")}
        </p>
        <button
          type="button"
          onClick={() => setEditing(true)}
          aria-label="Edit these answers"
          className={`${BUTTON_ICON} h-7 w-7`}
        >
          <PencilSimple size={14} />
        </button>
      </div>
    );
  }

  return (
    <form
      action={handleSubmit}
      className="mb-5 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
    >
      <p className="text-[13px] font-medium text-[var(--text)]">Review your application answers</p>
      {answers.map(({ question, answer }) => (
        <div key={question.id}>
          <input type="hidden" name="questionId" value={question.id} />
          {/* The same FieldPreview every other field renders through, and
              the reason this component doesn't need its own per-type
              branch: it used to have a fourth copy of this switch, which
              is exactly the kind of thing that silently stops covering
              new types. */}
          <FieldPreview
            field={toPreviewShape({ ...question, label: question.label, required: false })}
            name={`value_${question.id}`}
            defaultValue={answer.value}
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button type="submit" className={BUTTON_PRIMARY}>
          Apply
        </button>
        <button type="button" onClick={() => setEditing(false)} className={BUTTON_SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}

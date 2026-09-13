"use client";

import { useState } from "react";
import { PencilSimple } from "@phosphor-icons/react";
import { BUTTON_ICON, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";

type PrefilledAnswer = {
  question: {
    id: string;
    label: string;
    responseType: "free_text" | "single_choice" | "multi_choice" | "date";
    options: string[];
  };
  answer: { value: unknown };
};

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
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
          <p className="mb-1 text-[13px] text-[var(--text)]">{question.label}</p>
          {question.responseType === "free_text" && (
            <input
              type="text"
              name={`value_${question.id}`}
              defaultValue={typeof answer.value === "string" ? answer.value : ""}
              className={INPUT}
            />
          )}
          {question.responseType === "date" && (
            <input
              type="date"
              name={`value_${question.id}`}
              defaultValue={typeof answer.value === "string" ? answer.value : ""}
              className={`${INPUT} w-fit`}
            />
          )}
          {question.responseType === "single_choice" && (
            <div className="flex flex-col gap-1">
              {question.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                  <input type="radio" name={`value_${question.id}`} value={o} defaultChecked={answer.value === o} /> {o}
                </label>
              ))}
            </div>
          )}
          {question.responseType === "multi_choice" && (
            <div className="flex flex-col gap-1">
              {question.options.map((o) => (
                <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                  <input
                    type="checkbox"
                    name={`value_multi_${question.id}`}
                    value={o}
                    defaultChecked={Array.isArray(answer.value) && answer.value.includes(o)}
                  />{" "}
                  {o}
                </label>
              ))}
            </div>
          )}
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

"use client";

import { useState } from "react";
import { INPUT } from "./ui/kit";

// Shared by every form that sets a task's effort (ProposalCard.tsx's
// activation form, /propose's own advanced section, tasks/[id]/page.tsx's
// "Split off a subtask" form) — only one of Duration/hours-per-week is
// ever actually used depending on which Effort is picked, so this swaps
// which one shows instead of always rendering both side by side with a
// "(if one-off)"/"(if ongoing/owns-a-thing)" caption. Field names are
// unchanged from the old inline markup, so no server action needed any
// change: a field simply isn't in the submitted formData when its select
// isn't the one showing, which every existing parser already tolerates.
export default function EffortFields({
  defaultEffort = "one_off",
  defaultDuration = "few_hours",
  defaultHoursPerWeek,
}: {
  defaultEffort?: string;
  defaultDuration?: string;
  defaultHoursPerWeek?: number;
}) {
  const [effort, setEffort] = useState(defaultEffort);
  return (
    <>
      <select
        name="effort"
        required
        defaultValue={defaultEffort}
        onChange={(e) => setEffort(e.target.value)}
        className={INPUT}
      >
        <option value="one_off">One-off</option>
        <option value="ongoing">Ongoing</option>
        <option value="owns_a_thing">Owns-a-thing</option>
      </select>
      {effort === "one_off" ? (
        <select name="duration" defaultValue={defaultDuration} className={INPUT}>
          <option value="under_hour">Under an hour</option>
          <option value="few_hours">A few hours</option>
          <option value="half_day">Half a day</option>
          <option value="multi_day">Multi-day</option>
        </select>
      ) : (
        <input
          type="number"
          name="hoursPerWeek"
          placeholder="hours/week"
          min={0}
          defaultValue={defaultHoursPerWeek}
          className={`${INPUT} w-32`}
        />
      )}
    </>
  );
}

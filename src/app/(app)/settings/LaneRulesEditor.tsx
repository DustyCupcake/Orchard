"use client";

import { useMemo, useState } from "react";
import {
  describeLaneConsequence,
  JOINING_LANE_COPY,
  JOINING_LANE_PRESETS,
  summarizeLaneRule,
  type JoiningLaneRule,
} from "@/lib/recruitment/lanes";
import type { JoinLaneKind } from "@/db/schema";
import { Button, Select, Toggle } from "./LaneEditorControls";

// §5.1's lane cards, the one part of the settings screen that has to be
// a client component: the plan's whole legibility argument is that a rule
// reads as a *consequence sentence* rather than a set of cells, and a
// sentence that only appears after a save is not a consequence, it's a
// changelog. So the sentence is derived on every keystroke from
// describeLaneConsequence — one function, shared with the tests and with
// the inviter's own "what will happen if I tick this" hints — and what
// the community reads while configuring is exactly what an applicant will
// be told.
//
// Everything else on the settings screen is still a plain server-rendered
// form; this is the only place the page spends a client bundle, and it is
// worth it.
//
// Imports only the *pure* half of the lane model (../lanes), which has no
// runtime dependency on the db — see that module's first comment for why
// that split exists.
export type InitialLaneRules = Record<JoinLaneKind, JoiningLaneRule>;

const VERIFICATION_OPTIONS: { value: JoiningLaneRule["verificationMode"]; label: string; blurb: string }[] = [
  {
    value: "basic",
    label: "One member's word",
    blurb: "Whoever invited them has already vouched. Nothing else to check.",
  },
  {
    value: "nomination",
    label: "One more member's word",
    blurb: "Somebody else in the community has to back it up before they can carry on. They are never turned away for want of a second — they can skip the wait, and if nobody seconded in time it lapses and they carry on anyway.",
  },
  {
    value: "consensus",
    label: "The whole community sees them arrive",
    blurb: "Their arrival is announced, and any member can raise a concern. A concern doesn't disappear on a timer — the mediation team talks it through, and by default it stands.",
  },
];

export default function LaneRulesEditor({ initial }: { initial: InitialLaneRules }) {
  const [rules, setRules] = useState<InitialLaneRules>(initial);

  // Which preset the current configuration matches, if any — shown as a
  // "matches: Welcoming" read-out rather than a select value, because a
  // select that silently snaps back to the first option the moment
  // somebody edits a card is how a community ends up unsure what it
  // chose. The select itself is a *starting point*, exactly as §5.1
  // describes ("fills all four lanes, still editable per card
  // afterwards").
  const matchingPreset = useMemo(
    () => JOINING_LANE_PRESETS.find((p) => (Object.keys(p.rules) as JoinLaneKind[]).every((lane) => sameRule(p.rules[lane], rules[lane]))),
    [rules],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
        <p className="text-[12px] font-medium text-[var(--text-muted)]">Start from a preset</p>
        <p className="mt-1 max-w-[560px] text-[12px] text-[var(--text-muted)]">
          A preset fills all four lanes at once. Everything stays editable afterwards — nothing here
          is a mode you&rsquo;re locked into, and a community that relaxes one lane after picking a
          preset is in exactly the configuration the cards below describe.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {JOINING_LANE_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              onClick={() => setRules(structuredClone(preset.rules))}
              title={preset.blurb}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">
          {matchingPreset
            ? `Right now this matches “${matchingPreset.label}”.`
            : "Right now this is a mix — which is a perfectly good answer, and the cards below say what it means."}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {(Object.keys(JOINING_LANE_COPY) as JoinLaneKind[]).map((lane) => (
          <LaneCard
            key={lane}
            lane={lane}
            rule={rules[lane]}
            onChange={(next) => setRules((prev) => ({ ...prev, [lane]: next }))}
          />
        ))}
      </div>
    </div>
  );
}

function LaneCard({
  lane,
  rule,
  onChange,
}: {
  lane: JoinLaneKind;
  rule: JoiningLaneRule;
  onChange: (next: JoiningLaneRule) => void;
}) {
  const copy = JOINING_LANE_COPY[lane];
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[15px] font-medium text-[var(--text)]">{copy.title}</h3>
        <span className="text-[12px] text-[var(--text-muted)]">{summarizeLaneRule(rule)}</span>
      </div>
      <p className="mt-1 max-w-[560px] text-[12px] text-[var(--text-muted)]">{copy.who}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Select
          label="How much proof"
          name={`lane.${lane}.verificationMode`}
          value={rule.verificationMode}
          onChange={(value) =>
            onChange({ ...rule, verificationMode: value as JoiningLaneRule["verificationMode"] })
          }
          options={VERIFICATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />
        {rule.verificationMode === "nomination" && (
          <div className="flex flex-col gap-1">
            <label className="text-[12px] font-medium text-[var(--text-muted)]" htmlFor={`lane.${lane}.supportCount`}>
              How many people have to back it up
            </label>
            <input
              id={`lane.${lane}.supportCount`}
              name={`lane.${lane}.supportCount`}
              type="number"
              min={1}
              max={50}
              defaultValue={rule.supportCount}
              className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
            />
            <span className="text-[12px] text-[var(--text-muted)]">
              One is the usual answer. More than one only makes sense if the community is large enough
              that one person&rsquo;s word about someone they&rsquo;ve never met is worth checking.
            </span>
          </div>
        )}
      </div>

      <p className="mt-2 text-[12px] text-[var(--text-muted)]">
        {VERIFICATION_OPTIONS.find((o) => o.value === rule.verificationMode)?.blurb}
      </p>

      <div className="mt-3 flex flex-col gap-2">
        <Toggle
          label="They fill in the application form"
          name={`lane.${lane}.applicationRequired`}
          checked={rule.applicationRequired}
          onChange={(v) => onChange({ ...rule, applicationRequired: v })}
        />
        <Toggle
          label="They have an interview"
          name={`lane.${lane}.interviewRequired`}
          checked={rule.interviewRequired}
          onChange={(v) => onChange({ ...rule, interviewRequired: v })}
        />
        {rule.verificationMode === "nomination" && (
          <Toggle
            label="They can skip the wait and do the application instead"
            name={`lane.${lane}.applyInsteadAvailable`}
            checked={rule.applyInsteadAvailable}
            onChange={(v) => onChange({ ...rule, applyInsteadAvailable: v })}
          />
        )}
      </div>

      <p className="mt-3 border-t border-dashed border-[var(--border)] pt-2 text-[13px] text-[var(--text)]">
        <span className="text-[var(--text-muted)]">What actually happens: </span>
        {describeLaneConsequence(rule)}
      </p>
    </div>
  );
}

function sameRule(a: JoiningLaneRule, b: JoiningLaneRule) {
  return (
    a.verificationMode === b.verificationMode &&
    a.supportCount === b.supportCount &&
    a.applicationRequired === b.applicationRequired &&
    a.interviewRequired === b.interviewRequired &&
    a.applyInsteadAvailable === b.applyInsteadAvailable
  );
}

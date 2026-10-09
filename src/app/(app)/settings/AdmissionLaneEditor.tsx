"use client";

import { useMemo, useState } from "react";
import { describeLaneConsequence, type AdmissionLaneRule, createEmptyLane } from "@/lib/recruitment/admission-lanes";
import type { AdmissionVerification } from "@/db/schema";
import { Button, Select, Toggle } from "./LaneEditorControls";

// TextField component for the lane editor
function TextField({
  label,
  name,
  value,
  onChange,
  type = "text",
  placeholder,
  hint,
  min,
  max,
}: {
  label: string;
  name: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: "text" | "number";
  placeholder?: string;
  hint?: string;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        placeholder={placeholder}
        min={min}
        max={max}
        className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
      />
      {hint && <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{hint}</p>}
    </label>
  );
}

// Presets that match the old four lanes, so existing communities can
// migrate without rethinking everything. The plan is explicit that
// "the set reproduces the three doors this module had before" — the
// defaults are the documented default, not a new opinion.
const LANE_PRESETS: {
  key: string;
  label: string;
  blurb: string;
  rules: { kind: "invite" | "public"; rule: AdmissionLaneRule }[];
}[] = [
  {
    key: "legacy",
    label: "Legacy four lanes",
    blurb: "The four lanes the old plan described. Preserves today's behaviour exactly.",
    rules: [
      {
        kind: "invite",
        rule: {
          name: "Invited — knows personally",
          kind: "invite",
          handlesKnowsPersonally: true,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: null,
          applicationRequired: false,
          interviewRequired: false,
          verification: "none",
          reportsNeeded: null,
          supportShortcutCount: null,
        },
      },
      {
        kind: "invite",
        rule: {
          name: "Invited — vouches (good fit)",
          kind: "invite",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: true,
          handlesNeither: false,
          publicSlug: null,
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
      {
        kind: "invite",
        rule: {
          name: "Invited — neither mark",
          kind: "invite",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: false,
          handlesNeither: true,
          publicSlug: null,
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
      {
        kind: "public",
        rule: {
          name: "Open application",
          kind: "public",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: "",
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
    ],
  },
  {
    key: "welcoming",
    label: "Welcoming",
    blurb: "One lane for everyone who knows someone. Public applications open.",
    rules: [
      {
        kind: "invite",
        rule: {
          name: "Anyone who knows someone",
          kind: "invite",
          handlesKnowsPersonally: true,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: null,
          applicationRequired: false,
          interviewRequired: false,
          verification: "none",
          reportsNeeded: null,
          supportShortcutCount: null,
        },
      },
      {
        kind: "invite",
        rule: {
          name: "Anyone else",
          kind: "invite",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: true,
          handlesNeither: true,
          publicSlug: null,
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
      {
        kind: "public",
        rule: {
          name: "Open application",
          kind: "public",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: "",
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
    ],
  },
  {
    key: "strict",
    label: "Strict",
    blurb: "Every lane has an application and interview. Community checks on invites.",
    rules: [
      {
        kind: "invite",
        rule: {
          name: "Knows personally",
          kind: "invite",
          handlesKnowsPersonally: true,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: null,
          applicationRequired: true,
          interviewRequired: true,
          verification: "community_check",
          reportsNeeded: 2,
          supportShortcutCount: 1,
        },
      },
      {
        kind: "invite",
        rule: {
          name: "Vouches or neither",
          kind: "invite",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: true,
          handlesNeither: true,
          publicSlug: null,
          applicationRequired: true,
          interviewRequired: true,
          verification: "community_check",
          reportsNeeded: 2,
          supportShortcutCount: 1,
        },
      },
      {
        kind: "public",
        rule: {
          name: "Open application",
          kind: "public",
          handlesKnowsPersonally: false,
          handlesGoodFitOnly: false,
          handlesNeither: false,
          publicSlug: "",
          applicationRequired: true,
          interviewRequired: true,
          verification: "none",
          reportsNeeded: 2,
          supportShortcutCount: null,
        },
      },
    ],
  },
];

function sameRule(a: AdmissionLaneRule, b: AdmissionLaneRule): boolean {
  return (
    a.kind === b.kind &&
    a.name === b.name &&
    a.handlesKnowsPersonally === b.handlesKnowsPersonally &&
    a.handlesGoodFitOnly === b.handlesGoodFitOnly &&
    a.handlesNeither === b.handlesNeither &&
    a.publicSlug === b.publicSlug &&
    a.applicationRequired === b.applicationRequired &&
    a.interviewRequired === b.interviewRequired &&
    a.verification === b.verification &&
    a.reportsNeeded === b.reportsNeeded &&
    a.supportShortcutCount === b.supportShortcutCount
  );
}

const VERIFICATION_OPTIONS: { value: AdmissionVerification; label: string; blurb: string }[] = [
  {
    value: "none",
    label: "None",
    blurb: "No community check. The lane proceeds straight to its process.",
  },
  {
    value: "community_check",
    label: "Community check",
    blurb: "The arrival is announced. Any member can raise a concern. The mediation body talks it through. A concern never disappears on a timer.",
  },
];

export default function AdmissionLaneEditor({ initial }: { initial: Array<AdmissionLaneRule & { id?: string }> }) {
  const [rules, setRules] = useState<Array<AdmissionLaneRule & { id?: string }>>(initial);

  // Which preset the current configuration matches, if any — shown as a
  // "matches: Welcoming" read-out rather than a select value, because a
  // select that silently snaps back to the first option the moment
  // somebody edits a card is how a community ends up unsure what it
  // chose. The select itself is a *starting point*, exactly as the plan
  // describes ("fills all lanes, still editable per card afterwards").
  const matchingPreset = useMemo(
    () => LANE_PRESETS.find((p) =>
      p.rules.every(({ kind, rule }, i) => sameRule(rule, rules.find((r) => r.kind === kind) ?? ({} as AdmissionLaneRule)))
    ),
    [rules],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--border)] p-3">
        <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Start from a preset</p>
        <p className="mt-1 max-w-[560px] text-[length:var(--text-meta)] text-[var(--text-muted)]">
          A preset fills all lanes at once. Everything stays editable afterwards — nothing here
          is a mode you&apos;re locked into, and a community that relaxes one lane after picking a
          preset is in exactly the configuration the cards below describe.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {LANE_PRESETS.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              onClick={() => setRules(structuredClone(preset.rules.map(({ rule }) => rule)))}
              title={preset.blurb}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {matchingPreset
            ? `Right now this matches "${matchingPreset.label}".`
            : "Right now this is a mix — which is a perfectly good answer, and the cards below say what it means."}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {rules.map((rule, index) => (
          <LaneCard
            key={rule.id ?? index}
            index={index}
            rule={rule}
            onChange={(next) => setRules((prev) => prev.map((r, i) => (i === index ? next : r)))}
            onDelete={() => setRules((prev) => prev.filter((_, i) => i !== index))}
            canDelete={rules.length > 1}
          />
        ))}
        <Button type="button" onClick={() => setRules((prev) => [...prev, createEmptyLane()])}>
          Add lane
        </Button>
      </div>
    </div>
  );
}


function LaneCard({
  rule,
  index,
  onChange,
  onDelete,
  canDelete,
}: {
  rule: AdmissionLaneRule;
  index: number;
  onChange: (next: AdmissionLaneRule) => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const hasProcess = rule.applicationRequired || rule.interviewRequired;
  const hasEvaluation = hasProcess;
  const needsReports = hasEvaluation;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">
            {rule.name}
          </h3>
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)] capitalize">{rule.kind}</span>
        </div>
        <div className="flex items-baseline gap-2">
          {canDelete && (
            <Button type="button" onClick={onDelete}>
              Delete lane
            </Button>
          )}
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {describeLaneConsequence(rule)}
          </span>
        </div>
      </div>

      <p className="mt-1 max-w-[560px] text-[length:var(--text-meta)] text-[var(--text-muted)]">
        {rule.kind === "invite"
          ? `This lane matches an invite where the inviter declared: ${[
              rule.handlesKnowsPersonally && "I know them personally",
              rule.handlesGoodFitOnly && "I think they'd fit",
              rule.handlesNeither && "neither mark",
            ].filter(Boolean).join(", ")}.`
          : `This lane is served at /apply${rule.publicSlug ? `/${rule.publicSlug}` : ""}.`}
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {/* Kind and arrival matching */}
        <div className="sm:col-span-2">
          <Select
            label="What kind of lane is this?"
            name={`lanes[${index}].kind`}
            value={rule.kind}
            onChange={(value) => onChange({ ...rule, kind: value as "invite" | "public" })}
            options={[
              { value: "invite", label: "Invite lane" },
              { value: "public", label: "Public lane" },
            ]}
          />
        </div>

        {/* Invite matching — only for invite lanes */}
        {rule.kind === "invite" && (
          <div className="sm:col-span-2">
            <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)] mb-1">
              Which inviter declaration picks this lane?
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Toggle
                label="I know them personally"
                name={`lanes[${index}].handlesKnowsPersonally`}
                checked={rule.handlesKnowsPersonally}
                onChange={(v) => onChange({ ...rule, handlesKnowsPersonally: v })}
              />
              <Toggle
                label="I think they'd fit (good fit only)"
                name={`lanes[${index}].handlesGoodFitOnly`}
                checked={rule.handlesGoodFitOnly}
                onChange={(v) => onChange({ ...rule, handlesGoodFitOnly: v })}
              />
              <Toggle
                label="Neither mark"
                name={`lanes[${index}].handlesNeither`}
                checked={rule.handlesNeither}
                onChange={(v) => onChange({ ...rule, handlesNeither: v })}
              />
            </div>
            <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Exactly one lane must handle each declaration. The panel will prevent saving
              if a declaration is left unmatched or if two lanes claim the same one.
            </p>
          </div>
        )}

        {/* Public slug — only for public lanes */}
        {rule.kind === "public" && (
          <TextField
            label="URL slug (after /apply/)"
            name={`lanes[${index}].publicSlug`}
            value={rule.publicSlug ?? ""}
            onChange={(value: string) => onChange({ ...rule, publicSlug: value || null })}
            placeholder="leave blank for /apply"
            hint="The first public lane is served at /apply. Additional lanes are served at /apply/<slug>."
          />
        )}

        {/* Lane name */}
        <TextField
          label="Lane name"
          name={`lanes[${index}].name`}
          value={rule.name}
          onChange={(value: string) => onChange({ ...rule, name: value })}
          placeholder="e.g. Invited — knows personally"
        />

        {/* Verification */}
        <Select
          label="Verification"
          name={`lanes[${index}].verification`}
          value={rule.verification}
          onChange={(value) => onChange({ ...rule, verification: value as "none" | "community_check" })}
          options={VERIFICATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
        />

        {/* Process */}
        <div className="flex flex-col gap-2">
          <Toggle
            label="Application form required"
            name={`lanes[${index}].applicationRequired`}
            checked={rule.applicationRequired}
            onChange={(v) => onChange({ ...rule, applicationRequired: v })}
          />
          <Toggle
            label="Interview required"
            name={`lanes[${index}].interviewRequired`}
            checked={rule.interviewRequired}
            onChange={(v) => onChange({ ...rule, interviewRequired: v })}
          />
        </div>

        {/* Reports needed — only if there's something to evaluate */}
        {hasEvaluation && (
          <TextField
            label="Reports needed"
            name={`lanes[${index}].reportsNeeded`}
            type="number"
            min={1}
            max={50}
            value={rule.reportsNeeded ?? 2}
            onChange={(value: string) => onChange({ ...rule, reportsNeeded: parseInt(value) || null })}
            hint="How many reports are needed before the decision is made."
          />
        )}

        {/* Support shortcut — only if there's a process to skip */}
        {hasProcess && (
          <TextField
            label="Support shortcut (member supports to skip the rest)"
            name={`lanes[${index}].supportShortcutCount`}
            type="number"
            min={1}
            max={50}
            value={rule.supportShortcutCount ?? 1}
            onChange={(value: string) => onChange({ ...rule, supportShortcutCount: parseInt(value) || null })}
            hint="When this many members support the arrival, the rest of the process is skipped and they're admitted."
          />
        )}

        {/* Community check blurb */}
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {VERIFICATION_OPTIONS.find((o) => o.value === rule.verification)?.blurb}
        </p>
      </div>

      <p className="mt-3 border-t border-dashed border-[var(--border)] pt-2 text-[length:var(--text-body)] text-[var(--text)]">
        <span className="text-[var(--text-muted)]">What actually happens: </span>
        {describeLaneConsequence(rule)}
      </p>
    </div>
  );
}


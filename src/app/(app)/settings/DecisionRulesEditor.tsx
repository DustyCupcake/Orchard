"use client";

import { useState } from "react";
import type { RecruitmentDecisionRule } from "@/lib/recruitment/evaluations";
import { Button } from "./LaneEditorControls";

// The decision rules were a raw JSON textarea with an example printed
// underneath it. The invariant that makes them dangerous — the LAST rule
// must have no conditions, and a `wider_discussion` rule must say which way
// it resolves — was a sentence in the field's hint, enforced on the server,
// and a mismatch meant an error page rather than a marked-up field. So the
// two facts that make the field hard to use were both true: it was the only
// place on the settings screen where the community's own logic had to be
// written in a syntax nobody but a developer has, and the one thing that
// makes a wrong rule invisible is that a wrong rule looks exactly like a
// right one.
//
// What this replaces it with keeps the ordering and the server-side
// validation exactly as they were, and drops the JSON. The consequence
// sentence at the top of each rule is the *same* function
// `describeDecisionRules` used for the collapsed card's state line, so what
// a reader is shown while editing is what they will read afterwards, and
// what an applicant will be told.
//
// The rules still submit as JSON in one hidden input. That is not a
// concession to the old design — the form field is `recruitmentDecisionRulesRaw`
// and `updateRecruitmentDecisionRulesAction` still parses it with the same
// zod schema and the same `requireValidDecisionRules`. One code path means
// the server cannot end up accepting a shape the UI cannot produce, and the
// REST routes keep working. What changed is that a person no longer has to
// type it.

const OUTCOMES: { value: RecruitmentDecisionRule["outcome"]; label: string }[] = [
  { value: "proceed", label: "They're in" },
  { value: "wider_discussion", label: "Announce to the community" },
  { value: "decline", label: "Decline" },
];

const RECOMMENDATIONS = [
  { key: "proceed", label: "said proceed" },
  { key: "decline", label: "said decline" },
  { key: "unsure", label: "were unsure" },
] as const;

/** One rule as a sentence, the reading an applicant will be given.
 *
 *  This is a reworded `describeDecisionRules` rather than a call to it,
 *  because the two render differently on purpose: the collapsed state line
 *  has to fit on one line under the card title, so it reads "if two say
 *  proceed, they're in" and joins the rules with semicolons, while the
 *  editor gives each rule its own line and leads with "If". The
 *  *condition* half — how a minCount or an inviter mark becomes words — is
 *  the part where a disagreement would be a real bug, so that part is
 *  shared: `describeRuleCondition` below, called from both.
 */
function sentence(rule: RecruitmentDecisionRule): string {
  const when = describeRuleCondition(rule.conditions);
  if (rule.outcome === "wider_discussion") {
    return `If ${when} → announce to the community, ${
      rule.defaultResolution === "proceed" ? "admitting them" : "declining them"
    } if nobody objects.`;
  }
  if (rule.outcome === "proceed") return `If ${when} → they're in.`;
  return `If ${when} → decline.`;
}

/** The condition half, shared with the tab's one-line state so the editor
 *  and the collapsed card cannot describe the same rule differently. */
export function describeRuleCondition(c: RecruitmentDecisionRule["conditions"]): string {
  const bits: string[] = [];
  if (c.minCounts) {
    for (const r of RECOMMENDATIONS) {
      const n = c.minCounts[r.key];
      if (n !== undefined) bits.push(`at least ${n} ${r.label}`);
    }
  }
  if (c.inviterKnowsPersonally !== undefined) {
    bits.push(c.inviterKnowsPersonally ? "inviter knows them personally" : "inviter doesn't know them personally");
  }
  if (c.inviterThinksGoodFit !== undefined) {
    bits.push(c.inviterThinksGoodFit ? "inviter vouches" : "inviter doesn't vouch");
  }
  return bits.length ? bits.join(", ") : "anything else";
}

const STARTERS: RecruitmentDecisionRule[] = [
  { conditions: { minCounts: { proceed: 2 } }, outcome: "proceed" },
  { conditions: {}, outcome: "wider_discussion", defaultResolution: "proceed" },
];

export default function DecisionRulesEditor({ initial }: { initial: RecruitmentDecisionRule[] }) {
  // An empty array means "not configured", which is a state the editor has
  // to start from rather than a state it can save — the server treats empty
  // as not-yet-set (see requireValidDecisionRules), so opening the editor
  // on a community that has never configured rules shows the two starters
  // to edit rather than an empty box.
  const [rules, setRules] = useState<RecruitmentDecisionRule[]>(
    initial.length > 0 ? initial : STARTERS,
  );
  const [showJson, setShowJson] = useState(false);

  const set = (i: number, patch: Partial<RecruitmentDecisionRule>) =>
    setRules((prev) => prev.map((r, n) => (n === i ? { ...r, ...patch } : r)));

  const setMinCount = (i: number, key: (typeof RECOMMENDATIONS)[number]["key"], raw: string) =>
    setRules((prev) =>
      prev.map((r, n) => {
        if (n !== i) return r;
        const next = { ...(r.conditions.minCounts ?? {}) };
        if (raw === "") delete next[key];
        else next[key] = Math.max(0, parseInt(raw, 10) || 0);
        // An empty object is dropped rather than written, so a condition
        // the reader has cleared reads as unconditional to the server's
        // `isUnconditional` rather than as a rule with an empty minCounts.
        const minCounts = Object.keys(next).length > 0 ? next : undefined;
        const conditions = { ...r.conditions, minCounts };
        if (!minCounts) delete conditions.minCounts;
        return { ...r, conditions };
      }),
    );

  const setInviterMark = (
    i: number,
    key: "inviterKnowsPersonally" | "inviterThinksGoodFit",
    value: string,
  ) =>
    setRules((prev) =>
      prev.map((r, n) => {
        if (n !== i) return r;
        const conditions = { ...r.conditions };
        if (value === "") delete conditions[key];
        else conditions[key] = value === "yes";
        return { ...r, conditions };
      }),
    );

  const move = (i: number, delta: number) =>
    setRules((prev) => {
      const next = [...prev];
      const j = i + delta;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  // The last rule is the fallback and must be unconditional. Rather than
  // preventing the mistake, this marks it: the server refuses it either
  // way, but a field that says why is a field somebody can fix, where an
  // error page on Save is a field somebody gives up on.
  const lastHasConditions = rules.length > 0 && !isFallbackShaped(rules[rules.length - 1]);
  const missingResolution = rules.some(
    (r) => r.outcome === "wider_discussion" && !r.defaultResolution,
  );

  return (
    <div className="flex flex-col gap-3">
      {rules.map((rule, i) => {
        const isLast = i === rules.length - 1;
        return (
          <div
            key={i}
            className="flex flex-col gap-2.5 rounded-[var(--radius-md)] border border-[var(--border)] p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                Rule {i + 1}
                {isLast ? " — the fallback" : ""}
              </span>
              <div className="flex items-center gap-1">
                <Button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move rule ${i + 1} up`}>
                  ↑
                </Button>
                <Button
                  onClick={() => move(i, 1)}
                  disabled={isLast}
                  aria-label={`Move rule ${i + 1} down`}
                >
                  ↓
                </Button>
                <Button
                  onClick={() => setRules((prev) => prev.filter((_, n) => n !== i))}
                  disabled={rules.length <= 1}
                  aria-label={`Remove rule ${i + 1}`}
                >
                  Remove
                </Button>
              </div>
            </div>

            {/* The sentence is the field's real output; the controls below
                it are how you get there. Putting it first means a reader
                who has skimmed the whole page has still read every rule. */}
            <p className="text-[length:var(--text-body)] leading-relaxed text-[var(--text)]">{sentence(rule)}</p>

            <div className="flex flex-wrap items-end gap-2">
              {RECOMMENDATIONS.map((r) => (
                <NumberField
                  key={r.key}
                  label={`At least this many ${r.label}`}
                  name={`rule.${i}.minCounts.${r.key}`}
                  value={rule.conditions.minCounts?.[r.key]?.toString() ?? ""}
                  onChange={(v) => setMinCount(i, r.key, v)}
                />
              ))}
              <MarkField
                label="Inviter knows them personally"
                name={`rule.${i}.inviterKnowsPersonally`}
                value={rule.conditions.inviterKnowsPersonally}
                onChange={(v) => setInviterMark(i, "inviterKnowsPersonally", v)}
              />
              <MarkField
                label="Inviter vouches"
                name={`rule.${i}.inviterThinksGoodFit`}
                value={rule.conditions.inviterThinksGoodFit}
                onChange={(v) => setInviterMark(i, "inviterThinksGoodFit", v)}
              />
            </div>

            <label className="flex items-center gap-2">
              <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Then</span>
              <select
                name={`rule.${i}.outcome`}
                value={rule.outcome}
                onChange={(e) => {
                  const outcome = e.target.value as RecruitmentDecisionRule["outcome"];
                  // Switching away from a community check drops the
                  // resolution, which is meaningless on the other two
                  // outcomes and would otherwise be submitted as a stray
                  // field the schema accepts.
                  set(i, outcome === "wider_discussion"
                    ? { outcome, defaultResolution: rule.defaultResolution ?? "proceed" }
                    : { outcome, defaultResolution: undefined });
                }}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
              >
                {OUTCOMES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            {rule.outcome === "wider_discussion" && (
              <label className="flex items-center gap-2">
                <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                  If nobody objects in the check window
                </span>
                <select
                  name={`rule.${i}.defaultResolution`}
                  value={rule.defaultResolution ?? ""}
                  onChange={(e) =>
                    set(i, {
                      defaultResolution:
                        (e.target.value || undefined) as RecruitmentDecisionRule["defaultResolution"],
                    })
                  }
                  className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
                >
                  <option value="">— pick one —</option>
                  <option value="proceed">Admit them</option>
                  <option value="decline">Decline them</option>
                </select>
              </label>
            )}
          </div>
        );
      })}

      <div className="flex items-center gap-2">
        <Button
          onClick={() =>
            setRules((prev) => [
              ...prev,
              { conditions: {}, outcome: "wider_discussion", defaultResolution: "proceed" },
            ])
          }
        >
          Add a rule
        </Button>
        <Button onClick={() => setShowJson((v) => !v)}>
          {showJson ? "Hide the JSON" : "Show the JSON"}
        </Button>
      </div>

      {lastHasConditions && (
        <p className="text-[length:var(--text-meta)] text-[var(--text)]">
          The last rule has conditions on it, so it can&rsquo;t be the fallback — every application
          that matches nothing would go undecided. Clear its conditions, or add a rule after it with
          none.
        </p>
      )}
      {missingResolution && (
        <p className="text-[length:var(--text-meta)] text-[var(--text)]">
          A rule that announces to the community has to say what happens if nobody objects.
        </p>
      )}

      {/* The one input the server reads, and the reason the whole editor is
          safe to trust: it submits the exact shape the old textarea
          produced, so `updateRecruitmentDecisionRulesAction` and
          `requireValidDecisionRules` are unchanged and still the only thing
          that decides whether a rule set is valid. */}
      <input type="hidden" name="recruitmentDecisionRulesRaw" value={JSON.stringify(rules)} />

      {showJson && (
        <pre className="overflow-x-auto rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--neutral-100)] p-3 text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
          {JSON.stringify(rules, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Mirrors `isUnconditional` in src/lib/recruitment/evaluations.ts, which
 *  is not exported. Duplicated rather than exported because the server's
 *  copy is the gate and this one is only here to mark a mistake before the
 *  round trip — if the two ever disagree, the server is what counts and
 *  the field is wrong, which is the safe direction to be wrong in. */
function isFallbackShaped(rule: RecruitmentDecisionRule): boolean {
  const c = rule.conditions;
  const hasMinCounts = c.minCounts && Object.keys(c.minCounts).length > 0;
  return !hasMinCounts && c.inviterThinksGoodFit === undefined && c.inviterKnowsPersonally === undefined;
}

function NumberField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{label}</span>
      <input
        // No `name` on the visible input: these values are already in the
        // hidden JSON, and two inputs with the same meaning is how a form
        // ends up submitting one of them.
        type="number"
        min={0}
        aria-label={label}
        data-field={name}
        value={value}
        placeholder="—"
        onChange={(e) => onChange(e.target.value)}
        className="w-20 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
      />
    </label>
  );
}

function MarkField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: boolean | undefined;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{label}</span>
      <select
        name={name}
        value={value === undefined ? "" : value ? "yes" : "no"}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none"
      >
        <option value="">Any</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </label>
  );
}

"use client";

import { useState } from "react";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  starterChoiceField,
  type DefaultQuestionSeed,
} from "@/lib/profile-questions/defaults-table";
// The parser in defaults.ts and this form must spell these names
// identically, so both go through the one function that builds them. A
// literal here and a literal there is how the form and its parser came to
// disagree once already.
// Type-only, so nothing here reaches permissions.ts at runtime — that
// module imports `@/db`, and a client component importing it fails the
// build on `postgres`/`tls`/`fs`. The labels arrive as a prop from the
// server page for the same reason.
import type { PermissionModuleKey } from "@/lib/permissions";

/**
 * The starter set, as a form the admin walks through before anything is
 * created.
 *
 * This exists because the alternative was: one button, twenty questions,
 * and then an archive button pressed nineteen times. Nobody can have
 * answered a seeded question — the community has no members yet — so
 * archiving them loses nothing, which makes it a pure waste of the one
 * moment at which the set is cheap to decline. Ticking a box is the same
 * amount of work as archiving, twenty seconds earlier, and it leaves a
 * question list the community actually chose.
 *
 * It is also the only place an audience can be picked. "Sensitive" is
 * refused until a rule names the question (assertSensitiveAllowed), and a
 * rule can only be created for a question that exists — a two-way
 * dependency with no reachable start, resolved here by doing all three
 * steps in one action in the only order that works. An admin who has to
 * leave this form to go and hand-write a rule, then come back and tick a
 * box, is an admin who ends up with a public question they meant to
 * restrict.
 */

type Route = "none" | "tier" | "grant" | "task";

type RowState = {
  include: boolean;
  label: string;
  /** Whether the answer is restricted at all. Distinct from having an
   *  audience: "restricted to the owner and emergencies" is a real state,
   *  and the emergency contact needs to be expressible without inventing
   *  a reader for it. */
  sensitive: boolean;
  route: Route;
  tierId: string;
  grantModuleKey: PermissionModuleKey | null;
  taskId: string;
  emergencyAccess: boolean;
};

function initialRow(seed: DefaultQuestionSeed): RowState {
  return {
    include: true,
    label: seed.label,
    // Pre-set from the table's suggestion, because a restricted question
    // arriving with its audience already attached is the useful default
    // and the admin can widen or narrow it here.
    sensitive: Boolean(seed.accessRuleModuleKey) || Boolean(seed.needsChosenAudience),
    // A seed whose audience the platform may not choose gets no
    // preselection at all, so the Admin has to name a group — which is
    // the entire reason that flag exists.
    route: seed.accessRuleModuleKey ? "grant" : "none",
    // No Tier preselected: a brand-new community may not have one yet, and
    // a preselect that resolves to nothing would fail the submission with
    // the admin having done nothing wrong.
    tierId: "",
    grantModuleKey: seed.accessRuleModuleKey ?? null,
    taskId: "",
    emergencyAccess: Boolean(seed.emergencyAccess),
  };
}

const selectClass =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none";
const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none";

export default function StarterQuestionPicker({
  tiers,
  permissionModuleKeys,
  permissionModuleLabels,
}: {
  tiers: { id: string; name: string }[];
  permissionModuleKeys: PermissionModuleKey[];
  permissionModuleLabels: Record<PermissionModuleKey, string>;
}) {
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) =>
        g.questions.map((q) => [q.key, initialRow(q)] as const),
      ),
    ),
  );

  const set = (key: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const all = DEFAULT_PROFILE_QUESTION_GROUPS.flatMap((g) => g.questions);
  const chosen = all.filter((q) => rows[q.key].include).length;

  return (
    <div className="mt-3 flex flex-col gap-4">
      <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
        {chosen} of {all.length} selected. Unticking one leaves it out entirely — a
        question you don&rsquo;t add is better than one you add and then archive, and
        everything you keep stays editable afterwards.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="text-[length:var(--text-meta)] text-[var(--accent-1)] hover:underline"
          onClick={() =>
            setRows(Object.fromEntries(all.map((q) => [q.key, { ...rows[q.key], include: true }])))
          }
        >
          Select all
        </button>
        <button
          type="button"
          className="text-[length:var(--text-meta)] text-[var(--accent-1)] hover:underline"
          onClick={() =>
            setRows(Object.fromEntries(all.map((q) => [q.key, { ...rows[q.key], include: false }])))
          }
        >
          Select none
        </button>
      </div>

      {DEFAULT_PROFILE_QUESTION_GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-2">
          <legend className="text-[length:var(--text-body)] font-semibold text-[var(--text)]">{group.title}</legend>
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{group.blurb}</p>
          {group.questions.map((seed) => {
            const row = rows[seed.key];
            return (
              <div
                key={seed.key}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
                style={{ opacity: row.include ? 1 : 0.55 }}
              >
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) => set(seed.key, { include: e.target.checked })}
                    className="mt-1"
                  />
                  <input
                    type="text"
                    value={row.label}
                    disabled={!row.include}
                    onChange={(e) => set(seed.key, { label: e.target.value })}
                    placeholder="Question label"
                    className={`${inputClass} flex-1`}
                  />
                </label>
                <p className="mt-1 pl-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">{seed.why}</p>
                <p className="mt-1 pl-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Answers once, for good &mdash; not re-asked per event.
                  {!seed.allowPreferNotToSay &&
                    " No “prefer not to say” button, so a member has to answer this one."}
                </p>

                {row.include && (
                  <div className="mt-2 flex flex-col gap-2 pl-6">
                    <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={row.sensitive}
                        onChange={(e) =>
                          set(seed.key, {
                            sensitive: e.target.checked,
                            // Un-ticking restricted has to clear the route
                            // and the emergency box, or the form would
                            // submit an audience for a question that isn't
                            // restricted and quietly create a rule doing
                            // nothing. Ticking it again restores the
                            // previous route and emergency setting rather
                            // than losing them — an admin who unticks by
                            // mistake and puts it back should get the
                            // question they had, not a downgraded one.
                            route: e.target.checked ? row.route || "none" : "none",
                            emergencyAccess: e.target.checked ? row.emergencyAccess : false,
                          })
                        }
                        className="mt-1"
                      />
                      restricted
                      <span className="text-[var(--text-muted)]">
                        &mdash; not readable by the whole Community
                      </span>
                    </label>
                    {row.sensitive && (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            Who may read it in the ordinary course
                          </span>
                          {/* No "nobody" option, and that is the point: a
                              sensitive question is restricted *by* an
                              audience, so the write side refuses the
                              pair and an empty picker is a refusal
                              waiting to happen rather than a state the
                              Admin can reach by accident. */}
                          <select
                            value={row.route}
                            onChange={(e) => set(seed.key, { route: e.target.value as Route })}
                            className={`${selectClass} max-w-[28rem]`}
                          >
                            <option value="none">&mdash; pick who may read it &mdash;</option>
                            <option value="grant">anyone holding a permission grant</option>
                            <option value="tier">anyone in a Tier</option>
                            <option value="task">anyone holding one Task</option>
                          </select>
                        </label>
                        {row.route === "grant" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Permission</span>
                            <select
                              value={row.grantModuleKey ?? ""}
                              onChange={(e) =>
                                set(seed.key, {
                                  grantModuleKey: (e.target.value || null) as PermissionModuleKey | null,
                                })
                              }
                              className={`${selectClass} max-w-[28rem]`}
                            >
                              <option value="">— pick a permission —</option>
                              {permissionModuleKeys.map((k) => (
                                <option key={k} value={k}>
                                  {permissionModuleLabels[k]}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {row.route === "tier" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Tier</span>
                            <select
                              value={row.tierId}
                              onChange={(e) => set(seed.key, { tierId: e.target.value })}
                              className={`${selectClass} max-w-[28rem]`}
                            >
                              <option value="">— pick a Tier —</option>
                              {tiers.map((t) => (
                                <option key={t.id} value={t.id}>
                                  {t.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        {row.route === "task" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Task ID</span>
                            <input
                              type="text"
                              value={row.taskId}
                              onChange={(e) => set(seed.key, { taskId: e.target.value })}
                              placeholder="paste the task's ID from its /tasks/… URL"
                              className={`${inputClass} max-w-[28rem]`}
                            />
                          </label>
                        )}
                        <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                          <input
                            type="checkbox"
                            checked={row.emergencyAccess}
                            onChange={(e) => set(seed.key, { emergencyAccess: e.target.checked })}
                            className="mt-1"
                          />
                          also readable in an emergency
                          <span className="text-[var(--text-muted)]">
                            &mdash; whoever activates Emergency access on someone&rsquo;s page
                          </span>
                        </label>
                        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          {row.route === "none"
                            ? seed.needsChosenAudience
                              ? "Pick who should have this. The platform won't guess: none of the permissions means \u201cresponds to emergencies\u201d, and the person who manages settings isn't automatically the person who should hold someone's welfare details. Or untick restricted and leave it out of the set."
                              : "Pick who should have this, or untick \u201crestricted\u201d to leave it readable by the whole Community."
                            : "Everyone who satisfies the audience above can read it, and so can the person who answered. They can switch off sharing it to anyone else without removing it from their own profile."}
                        </p>
                      </>
                    )}
                  </div>
                )}

                {/* Serialized here rather than read off the widgets above, so
                    an excluded row contributes nothing and a row whose
                    widgets are hidden still submits a coherent decision. */}
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "include")}
                  value={row.include ? "on" : ""}
                />
                <input type="hidden" name={starterChoiceField(seed.key, "label")} value={row.label} />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "restricted")}
                  value={row.sensitive ? "on" : ""}
                />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "emergencyAccess")}
                  value={row.sensitive && row.emergencyAccess ? "on" : ""}
                />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "route")}
                  value={row.sensitive ? row.route : "none"}
                />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "tierId")}
                  value={row.sensitive && row.route === "tier" ? row.tierId : ""}
                />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "grantModuleKey")}
                  value={row.sensitive && row.route === "grant" ? (row.grantModuleKey ?? "") : ""}
                />
                <input
                  type="hidden"
                  name={starterChoiceField(seed.key, "taskId")}
                  value={row.sensitive && row.route === "task" ? row.taskId.trim() : ""}
                />
              </div>
            );
          })}
        </fieldset>
      ))}
    </div>
  );
}

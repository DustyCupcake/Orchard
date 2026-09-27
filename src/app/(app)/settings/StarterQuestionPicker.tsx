"use client";

import { useState } from "react";
import {
  DEFAULT_PROFILE_QUESTION_GROUPS,
  type DefaultQuestionSeed,
} from "@/lib/profile-questions/defaults-table";
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
  sensitive: boolean;
  route: Route;
  tierId: string;
  grantModuleKey: PermissionModuleKey | null;
  taskId: string;
};

function initialRow(seed: DefaultQuestionSeed): RowState {
  return {
    include: true,
    label: seed.label,
    // Pre-set from the table's suggestion, because a restricted question
    // arriving with its audience already attached is the useful default
    // and the admin can widen or narrow it here.
    sensitive: Boolean(seed.accessRuleModuleKey),
    route: seed.accessRuleModuleKey ? "grant" : "none",
    // No Tier preselected: a brand-new community may not have one yet, and
    // a preselect that resolves to nothing would fail the submission with
    // the admin having done nothing wrong.
    tierId: "",
    grantModuleKey: seed.accessRuleModuleKey ?? null,
    taskId: "",
  };
}

const selectClass =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] focus:border-[var(--accent-1)] focus:outline-none";
const inputClass =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[13px] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-1)] focus:outline-none";

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
      <p className="text-[13px] text-[var(--text-muted)]">
        {chosen} of {all.length} selected. Unticking one leaves it out entirely — a
        question you don&rsquo;t add is better than one you add and then archive, and
        everything you keep stays editable afterwards.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="text-[12px] text-[var(--accent-1)] hover:underline"
          onClick={() =>
            setRows(Object.fromEntries(all.map((q) => [q.key, { ...rows[q.key], include: true }])))
          }
        >
          Select all
        </button>
        <button
          type="button"
          className="text-[12px] text-[var(--accent-1)] hover:underline"
          onClick={() =>
            setRows(Object.fromEntries(all.map((q) => [q.key, { ...rows[q.key], include: false }])))
          }
        >
          Select none
        </button>
      </div>

      {DEFAULT_PROFILE_QUESTION_GROUPS.map((group) => (
        <fieldset key={group.title} className="flex flex-col gap-2">
          <legend className="text-[13px] font-semibold text-[var(--text)]">{group.title}</legend>
          <p className="text-[12px] text-[var(--text-muted)]">{group.blurb}</p>
          {group.questions.map((seed) => {
            const row = rows[seed.key];
            return (
              <div
                key={seed.key}
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
                style={{ opacity: row.include ? 1 : 0.55 }}
              >
                <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
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
                <p className="mt-1 pl-6 text-[12px] text-[var(--text-muted)]">{seed.why}</p>
                <p className="mt-1 pl-6 text-[12px] text-[var(--text-muted)]">
                  Answers once, for good &mdash; not re-asked per event.
                  {!seed.allowPreferNotToSay &&
                    " No “prefer not to say” button, so a member has to answer this one."}
                </p>

                {row.include && (
                  <div className="mt-2 flex flex-col gap-2 pl-6">
                    <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
                      <input
                        type="checkbox"
                        checked={row.sensitive}
                        onChange={(e) =>
                          set(seed.key, {
                            sensitive: e.target.checked,
                            // Un-ticking restricted has to clear the route,
                            // or the form would submit an audience for a
                            // question that isn't restricted and quietly
                            // create a rule doing nothing.
                            route: e.target.checked ? row.route : "none",
                          })
                        }
                        className="mt-1"
                      />
                      restricted
                      <span className="text-[var(--text-muted)]">
                        &mdash; only the audience below may read the answer
                      </span>
                    </label>
                    {row.sensitive && (
                      <>
                        <label className="flex flex-col gap-1">
                          <span className="text-[12px] text-[var(--text-muted)]">
                            Who may read it
                          </span>
                          <select
                            value={row.route}
                            onChange={(e) => set(seed.key, { route: e.target.value as Route })}
                            className={`${selectClass} max-w-[24rem]`}
                          >
                            <option value="none">— pick an audience —</option>
                            <option value="grant">anyone holding a permission grant</option>
                            <option value="tier">anyone in a Tier</option>
                            <option value="task">anyone holding one Task</option>
                          </select>
                        </label>
                        {row.route === "grant" && (
                          <label className="flex flex-col gap-1">
                            <span className="text-[12px] text-[var(--text-muted)]">
                              Permission
                            </span>
                            <select
                              value={row.grantModuleKey ?? ""}
                              onChange={(e) =>
                                set(seed.key, {
                                  grantModuleKey: (e.target.value || null) as PermissionModuleKey | null,
                                })
                              }
                              className={`${selectClass} max-w-[24rem]`}
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
                            <span className="text-[12px] text-[var(--text-muted)]">Tier</span>
                            <select
                              value={row.tierId}
                              onChange={(e) => set(seed.key, { tierId: e.target.value })}
                              className={`${selectClass} max-w-[24rem]`}
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
                            <span className="text-[12px] text-[var(--text-muted)]">
                              Task ID
                            </span>
                            <input
                              type="text"
                              value={row.taskId}
                              onChange={(e) => set(seed.key, { taskId: e.target.value })}
                              placeholder="paste the task's ID from its /tasks/… URL"
                              className={`${inputClass} max-w-[24rem]`}
                            />
                          </label>
                        )}
                        <p className="text-[12px] text-[var(--text-muted)]">
                          A restricted question with no audience is restricted to nobody, so
                          these are attached together rather than as two steps. Every answer
                          still belongs to the person who gave it — they can see it whatever
                          you pick here, and can switch off sharing it.
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
                  name={`choice.${seed.key}.include`}
                  value={row.include ? "on" : ""}
                />
                <input type="hidden" name={`choice.${seed.key}.label`} value={row.label} />
                <input
                  type="hidden"
                  name={`choice.${seed.key}.route`}
                  value={row.sensitive ? row.route : "none"}
                />
                <input
                  type="hidden"
                  name={`choice.${seed.key}.tierId`}
                  value={row.sensitive && row.route === "tier" ? row.tierId : ""}
                />
                <input
                  type="hidden"
                  name={`choice.${seed.key}.grantModuleKey`}
                  value={row.sensitive && row.route === "grant" ? (row.grantModuleKey ?? "") : ""}
                />
                <input
                  type="hidden"
                  name={`choice.${seed.key}.taskId`}
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

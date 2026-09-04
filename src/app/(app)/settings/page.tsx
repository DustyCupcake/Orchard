import { inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, listCycleTypes, listPendingBranches, listTiers, requireAdmins } from "@/lib/settings";
import {
  allowsMultipleGrants,
  listGrantsWithTaskInfo,
  PERMISSION_MODULE_KEYS,
  PERMISSION_MODULE_HINTS,
  PERMISSION_MODULE_LABELS,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { listTasks } from "@/lib/tasks";
import { listCycles } from "@/lib/cycles";
import { listProfileQuestions } from "@/lib/profile-questions";
import { listTaskPacks } from "@/lib/task-packs";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { SENSITIVE_FIELD_KEYS, SENSITIVE_FIELD_LABELS, listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { listForms } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
import { listConsentPurposes } from "@/lib/consent";
import { ForbiddenError } from "@/lib/errors";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import {
  addPermissionGrantAction,
  archiveFormAction,
  archiveProfileQuestionAction,
  confirmBulkMemberImportAction,
  confirmPendingBranchAction,
  createBranchAction,
  createConsentPurposeAction,
  createCycleTypeAction,
  createFormAction,
  createProfileQuestionAction,
  createSensitiveFieldAccessRuleAction,
  createTierAction,
  deleteBranchAction,
  deleteConsentPurposeAction,
  deleteCycleTypeAction,
  deleteSensitiveFieldAccessRuleAction,
  deleteTierAction,
  rejectPendingBranchAction,
  removePermissionGrantAction,
  reviewBulkMemberImportAction,
  setPermissionGrantAction,
  unarchiveFormAction,
  unarchiveProfileQuestionAction,
  updateBranchAction,
  updateCoordinationSettingsAction,
  updateCycleTypeAction,
  updateFormAction,
  updateGeneralSettingsAction,
  updateModulesSettingsAction,
  updateProfileQuestionAction,
  updateRecruitmentSettingsAction,
  updateTierAction,
} from "./actions";
import { decodeBulkMemberState } from "./bulk-members-state";
import FormBuilder from "./FormBuilder";
import ProfileQuestionEditor from "./ProfileQuestionEditor";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "general", label: "General" },
  { key: "permissions", label: "Access & permissions" },
  { key: "coordination", label: "Coordination" },
  { key: "modules", label: "Modules" },
  { key: "recruitment", label: "Recruitment" },
  { key: "branches", label: "Branches" },
  { key: "cycles-tiers", label: "Cycles & Tiers" },
  { key: "profile-privacy", label: "Profile & Privacy" },
  { key: "forms", label: "Forms" },
  { key: "members", label: "Members" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS = TABS.map((t) => t.key) as readonly string[];

function TabBar({ active }: { active: TabKey }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-[var(--border)]">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`/settings?tab=${t.key}`}
          className={`border-b-2 pb-2.5 text-[13px] font-medium transition-colors ${
            active === t.key
              ? "border-[var(--accent-1)] text-[var(--accent-1)]"
              : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}

function FieldSet({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3.5">
      <legend className="px-1 text-[12px] font-medium text-[var(--text-muted)]">{legend}</legend>
      <div className="flex flex-col gap-3">{children}</div>
    </fieldset>
  );
}

function TextField({
  label,
  name,
  defaultValue,
  placeholder,
  hint,
  type = "text",
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string | number;
  placeholder?: string;
  hint?: React.ReactNode;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} required={required} className={INPUT} />
      {hint && <span className="text-[12px] text-[var(--text-muted)]">{hint}</span>}
    </label>
  );
}

// Every access gate — single- or multi-cardinality alike — renders
// through this one component now (docs/development-plan.md's Phase
// 64), replacing Phase 63's two separate stopgap components
// (SingleGrantField/MultiGrantField) that each tab used to render
// its own scattered field with. A single-cardinality module
// (allowsMultipleGrants === false) still enforces at most one
// grantee — the Add form posts to setPermissionGrantAction (delete-
// then-insert) instead of addPermissionGrantAction, with a static
// warning next to it once a grantee already exists, rather than the
// old pre-filled-input-doubling-as-replace UX. The Add input's
// `list` attribute wires it to the shared task datalist rendered once
// for the whole tab (see the "permissions" tab body below) — a
// zero-JS "search by title" picker; the datalist's own <option value>
// is still the raw taskId (that's how HTML datalists work), so the
// input's text collapses to the ID once a suggestion is picked, but
// the human-readable label is what's actually searched/matched while
// typing.
function GrantField({
  moduleKey,
  grants,
}: {
  moduleKey: PermissionModuleKey;
  grants: { taskId: string; title: string; branchName: string }[];
}) {
  const multi = allowsMultipleGrants(moduleKey);
  return (
    <FieldSet legend={PERMISSION_MODULE_LABELS[moduleKey]}>
      <p className="text-[12px] text-[var(--text-muted)]">{PERMISSION_MODULE_HINTS[moduleKey]}</p>
      {grants.length === 0 && <p className="text-[13px] text-[var(--text-muted)]">No task grants this yet.</p>}
      {grants.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {grants.map((g) => (
            <li key={g.taskId} className="flex flex-wrap items-center gap-2 text-[13px] text-[var(--text)]">
              {g.title} — {g.branchName}
              <form action={removePermissionGrantAction}>
                <input type="hidden" name="moduleKey" value={moduleKey} />
                <input type="hidden" name="taskId" value={g.taskId} />
                <input type="hidden" name="tab" value="permissions" />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {!multi && grants.length > 0 && (
        <p className="text-[12px] text-[var(--text-muted)]">
          Only one task can hold this — adding another below moves it here instead of alongside it.
        </p>
      )}
      <form
        action={multi ? addPermissionGrantAction : setPermissionGrantAction}
        className="flex flex-wrap items-center gap-2"
      >
        <input type="hidden" name="moduleKey" value={moduleKey} />
        <input type="hidden" name="tab" value="permissions" />
        <input
          type="text"
          name="taskId"
          list="permissions-community-tasks"
          placeholder="search by task title…"
          className={`${INPUT} min-w-[18rem] flex-1`}
        />
        <button type="submit" className={BUTTON_SECONDARY}>
          {multi ? "Add" : grants.length > 0 ? "Replace" : "Grant"}
        </button>
      </form>
    </FieldSet>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; bulkStage?: string; bulkState?: string; bulkAdded?: string; tab?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, bulkStage, bulkState: bulkStateRaw, bulkAdded, tab: tabRaw } = await searchParams;
  const activeTab: TabKey = TAB_KEYS.includes(tabRaw ?? "") ? (tabRaw as TabKey) : "general";
  const bulkReview = bulkStage === "review" && bulkStateRaw ? decodeBulkMemberState(bulkStateRaw) : null;

  let authorized = true;
  try {
    await requireAdmins(viewing);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      authorized = false;
    } else {
      throw err;
    }
  }

  const [
    communityRow,
    branches,
    tiers,
    cycleTypes,
    cyclesForPicker,
    profileQuestions,
    sensitiveFieldRules,
    forms,
    consentPurposes,
    pendingBranches,
    taskPacks,
    communityTasksRaw,
  ] = await Promise.all([
    getCommunity(viewing),
    listBranches(viewing),
    listTiers(viewing),
    listCycleTypes(viewing),
    authorized ? listCycles(viewing) : Promise.resolve([]),
    authorized ? listProfileQuestions(viewing, { includeArchived: true }) : Promise.resolve([]),
    authorized ? listSensitiveFieldAccessRules(viewing) : Promise.resolve([]),
    authorized ? listForms(viewing, { includeArchived: true }) : Promise.resolve([]),
    authorized ? listConsentPurposes(viewing) : Promise.resolve([]),
    authorized ? listPendingBranches(viewing) : Promise.resolve([]),
    listTaskPacks(viewing),
    authorized ? listTasks(viewing) : Promise.resolve([]),
  ]);
  const confirmedBranches = branches.filter((b) => b.status === "confirmed");
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // Every access gate this screen configures reads from one real table
  // now (docs/development-plan.md's Phase 63) — one query, grouped by
  // module in JS, rather than nine separate lookups. Branch name is
  // resolved from the branch list this page already has in hand
  // (branchNameById, above) rather than joined a second time.
  const allGrants = await listGrantsWithTaskInfo(communityRow.id);
  const grantsByModule = new Map<PermissionModuleKey, { taskId: string; title: string; branchName: string }[]>();
  for (const g of allGrants) {
    const list = grantsByModule.get(g.moduleKey) ?? [];
    list.push({ taskId: g.taskId, title: g.title, branchName: branchNameById.get(g.branchId) ?? "—" });
    grantsByModule.set(g.moduleKey, list);
  }
  const grantsFor = (moduleKey: PermissionModuleKey) => grantsByModule.get(moduleKey) ?? [];
  const communityTasksForPicker = communityTasksRaw.map((t) => ({
    id: t.id,
    title: t.title,
    branchName: branchNameById.get(t.branchId) ?? "—",
  }));

  const ruleTaskIds = [
    ...new Set(sensitiveFieldRules.map((r) => r.unlockedByTaskId).filter((id): id is string => Boolean(id))),
  ];
  const ruleTasks =
    ruleTaskIds.length > 0
      ? await db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, ruleTaskIds))
      : [];
  const ruleTaskNameById = new Map(ruleTasks.map((t) => [t.id, t.title]));
  const tierNameById = new Map(tiers.map((t) => [t.id, t.name]));

  if (!authorized) {
    return (
      <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Community settings</h1>
        <div className="mt-4">
          <Banner tone="danger">
            Only a current holder of an Admins-granting task can view or change these — see its
            detail page to put yourself forward or endorse a candidate.
          </Banner>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Community settings</h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        {communityRow.adminsEverClaimed
          ? "Editable by whoever currently holds the Admins task."
          : "No Admins task has ever been claimed in this Community yet, so any member can change these — including granting Admin access to a community_endorsed task below to start gating this screen for real."}
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="mt-6">
        <TabBar active={activeTab} />
      </div>

      <div className="mt-6">
        {activeTab === "general" && (
          <div className="flex flex-col gap-5">
            <form action={updateGeneralSettingsAction} className="flex flex-col gap-4">
              <TextField label="Name" name="name" defaultValue={communityRow.name} required />

              <FieldSet legend="Branding">
                <div className="flex flex-wrap items-end gap-4">
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Accent 1 · primary</span>
                    <input
                      type="color"
                      name="accentPrimary"
                      defaultValue={communityRow.accentPrimary ?? "#3a6cd9"}
                      className="h-9 w-9 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Accent 2 · secondary</span>
                    <input
                      type="color"
                      name="accentSecondary"
                      defaultValue={communityRow.accentSecondary ?? "#8a3fa8"}
                      className="h-9 w-9 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface)] p-0.5"
                    />
                  </label>
                  <label className="flex min-w-[12rem] flex-1 flex-col gap-1">
                    <span className={LABEL}>Logo URL</span>
                    <input type="text" name="logoUrl" defaultValue={communityRow.logoUrl ?? ""} placeholder="https://…" className={INPUT} />
                  </label>
                </div>
                <span className="text-[12px] text-[var(--text-muted)]">
                  The logo replaces the sidebar&rsquo;s text wordmark when set. Leave blank to show the community name instead.
                </span>
              </FieldSet>

              <FieldSet legend="Single sign-on (OIDC)">
                <div className="flex flex-wrap gap-3">
                  <div className="min-w-[14rem] flex-1">
                    <TextField label="Issuer URL" name="oidcIssuerUrl" defaultValue={communityRow.oidcIssuerUrl ?? ""} placeholder="https://your-instance.zitadel.cloud" />
                  </div>
                  <div className="min-w-[12rem] flex-1">
                    <TextField label="Client ID" name="oidcClientId" defaultValue={communityRow.oidcClientId ?? ""} />
                  </div>
                  <div className="min-w-[12rem] flex-1">
                    <TextField label="Required role" name="oidcRequiredRole" defaultValue={communityRow.oidcRequiredRole ?? ""} placeholder="orchard_user" />
                  </div>
                </div>
                <span className="text-[12px] text-[var(--text-muted)]">
                  A login without this Zitadel project role never creates an account, even for an otherwise-valid
                  login. All three fields are required together — leave the issuer URL blank to keep OIDC off and
                  magic-link-only. The client secret itself is set via this deployment&rsquo;s{" "}
                  <code>OIDC_CLIENT_SECRET</code> environment variable, never here.
                </span>
              </FieldSet>

              <CheckField label="Cycles on (multiple named production runs over time)" name="cyclesEnabled" defaultChecked={communityRow.cyclesEnabled} />
              <CheckField label="Phases on (a cycle can define a named phase spine)" name="phasesEnabled" defaultChecked={communityRow.phasesEnabled} />
              {communityRow.phasesEnabled && (
                <CheckField
                  label="On-site mode (while on, structural changes across settings, branches, tiers, cycle types, starting a new Cycle, Requirement changes, publishing the Event schedule, and Spatial-planning edits are all locked; everyday task/wiki/shift work stays live)"
                  name="onsiteModeEnabled"
                  defaultChecked={communityRow.onsiteModeEnabled}
                />
              )}

              <label className="flex flex-col gap-1">
                <span className={LABEL}>Who may start a cycle</span>
                <select name="cycleInitiationTierId" defaultValue={communityRow.cycleInitiationTierId ?? ""} className={INPUT}>
                  <option value="">Any member</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} members only
                    </option>
                  ))}
                </select>
              </label>

              <FieldSet legend="Call defaults (a Branch's own default overrides these — see Branches tab)">
                <CheckField label="Open agenda" name="defaultCallHasAgenda" defaultChecked={communityRow.defaultCallHasAgenda} />
                <CheckField label="Expected summary" name="defaultCallNeedsSummary" defaultChecked={communityRow.defaultCallNeedsSummary} />
                <CheckField label="Require read-confirmation" name="defaultCallRequireRead" defaultChecked={communityRow.defaultCallRequireRead} />
              </FieldSet>

              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Save
              </button>
            </form>
          </div>
        )}

        {activeTab === "permissions" && (
          <div className="flex flex-col gap-5">
            <p className="text-[13px] text-[var(--text-muted)]">
              Every access-gated capability in the app, in one place — who currently holds it, and a
              search-by-title picker to add or replace a grant. See a task&rsquo;s own detail or
              proposal-activation screen for the identical checkbox-driven equivalent.
            </p>
            <datalist id="permissions-community-tasks">
              {communityTasksForPicker.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} — {t.branchName}
                </option>
              ))}
            </datalist>
            {PERMISSION_MODULE_KEYS.map((moduleKey) => (
              <GrantField key={moduleKey} moduleKey={moduleKey} grants={grantsFor(moduleKey)} />
            ))}
          </div>
        )}

        {activeTab === "coordination" && (
          <div className="flex flex-col gap-5">
          <form action={updateCoordinationSettingsAction} className="flex flex-col gap-4">
            <div className="w-32">
              <TextField label="Acknowledgment window (hours)" name="conflictAckWindowHours" type="number" defaultValue={communityRow.conflictAckWindowHours} />
            </div>
            <TextField
              label="Task nomination response window (days)"
              name="taskNominationResponseDays"
              type="number"
              defaultValue={communityRow.taskNominationResponseDays}
              hint="How long a nominated member has to accept, decline, or say not-now before it auto-releases back to Unclaimed."
            />

            <FieldSet legend="Response tracking">
              <p className="text-[12px] text-[var(--text-muted)]">
                How many still-open non-responses (an expired nomination, an ignored Waiting nudge, an unread call
                summary) before a member&rsquo;s pattern shows as a soft flag, then a real pattern — visible to
                coordination, never an automatic consequence.
              </p>
              <div className="flex flex-wrap gap-3">
                <div className="w-28">
                  <TextField label="Soft flag at" name="engagementSoftFlagThreshold" type="number" defaultValue={communityRow.engagementSoftFlagThreshold} />
                </div>
                <div className="w-28">
                  <TextField label="Pattern at" name="engagementPatternThreshold" type="number" defaultValue={communityRow.engagementPatternThreshold} />
                </div>
                <div className="w-40">
                  <TextField label="Call summary read window (days)" name="callSummaryReadWindowDays" type="number" defaultValue={communityRow.callSummaryReadWindowDays} />
                </div>
              </div>
            </FieldSet>

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
          </div>
        )}

        {activeTab === "modules" && (
          <div className="flex flex-col gap-5">
          <form action={updateModulesSettingsAction} className="flex flex-col gap-4">
            <FieldSet legend="Modules">
              {MODULE_DEFINITIONS.map((m) => (
                <CheckField key={m.key} label={m.label} name="modulesEnabled" value={m.key} defaultChecked={communityRow.modulesEnabled.includes(m.key)} />
              ))}
            </FieldSet>

            <FieldSet legend="Post-cycle feedback">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Feedback form</span>
                <select name="postCycleFeedbackFormId" defaultValue={communityRow.postCycleFeedbackFormId ?? ""} className={INPUT}>
                  <option value="">— none configured —</option>
                  {forms.filter((f) => !f.archivedAt).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[var(--text-muted)]">Define the form itself under the Forms tab, then pick it here.</span>
              </label>
            </FieldSet>

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
          </div>
        )}

        {activeTab === "recruitment" && (
          <div className="flex flex-col gap-5">
          <form action={updateRecruitmentSettingsAction} className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Application form</span>
              <select name="recruitmentApplicationFormId" defaultValue={communityRow.recruitmentApplicationFormId ?? ""} className={INPUT}>
                <option value="">— none configured —</option>
                {forms.filter((f) => !f.archivedAt).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </select>
              <span className="text-[12px] text-[var(--text-muted)]">
                Define the form itself under the Forms tab, then pick it here — this is what renders at the public /apply page.
              </span>
            </label>
            <div className="w-32">
              <TextField label="Evaluators needed per application" name="recruitmentEvaluatorCount" type="number" defaultValue={communityRow.recruitmentEvaluatorCount} />
            </div>
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Decision rules (JSON)</span>
              <textarea
                name="recruitmentDecisionRulesRaw"
                rows={6}
                defaultValue={JSON.stringify(communityRow.recruitmentDecisionRules, null, 2)}
                className={`${INPUT} font-mono`}
              />
              <span className="text-[12px] text-[var(--text-muted)]">
                An ordered list of <code>{"{conditions, outcome}"}</code> — first match wins. Example:{" "}
                <code>{'[{"conditions":{"minCounts":{"proceed":2}},"outcome":"proceed"},{"conditions":{},"outcome":"wider_discussion"}]'}</code>{" "}
                — the last rule must have empty conditions (the required fallback). <code>outcome</code> is one of{" "}
                <code>proceed</code>/<code>wider_discussion</code>/<code>decline</code>.
              </span>
            </label>
            <div className="w-32">
              <TextField label="Subscription auto-lapse threshold" name="recruitmentSubscriptionLapseThreshold" type="number" defaultValue={communityRow.recruitmentSubscriptionLapseThreshold} />
            </div>
            <TextField
              label="Wider-discussion window (hours)"
              name="recruitmentWiderDiscussionHours"
              type="number"
              defaultValue={communityRow.recruitmentWiderDiscussionHours}
              hint="How long a wider_discussion outcome stays open for a subscribed member to raise an objection before auto-resolving."
            />
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rejection template</span>
              <textarea name="recruitmentRejectionTemplate" rows={4} defaultValue={communityRow.recruitmentRejectionTemplate ?? ""} className={INPUT} />
              <span className="text-[12px] text-[var(--text-muted)]">
                A starting point shown on /applications wherever a decline is about to be sent — never sent automatically.
              </span>
            </label>

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Save
            </button>
          </form>
          </div>
        )}

        {activeTab === "branches" && (
          <div className="flex flex-col gap-8">
            {pendingBranches.length > 0 && (
              <section>
                <h2 className="text-[18px] font-semibold text-[var(--text)]">Pending branches</h2>
                <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                  Created by a Task Pack import from someone who didn&rsquo;t hold Admins at the time. Tasks are
                  already attached and claimable; confirming just locks the branch in, rejecting re-points them to a
                  real branch instead.
                </p>
                <div className="mt-3 flex flex-col gap-2">
                  {pendingBranches.map((b) => (
                    <div key={b.id} className="rounded-[var(--radius-md)] p-3" style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border)" }}>
                      <div className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-[var(--text)]">{b.name}</span>
                        <Tag tone="warning">pending</Tag>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <form action={confirmPendingBranchAction}>
                          <input type="hidden" name="branchId" value={b.id} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            Confirm
                          </button>
                        </form>
                        <form action={rejectPendingBranchAction} className="flex items-center gap-2">
                          <input type="hidden" name="branchId" value={b.id} />
                          <select name="reassignToBranchId" required defaultValue="" className={INPUT}>
                            <option value="" disabled>
                              Reject — reassign its tasks to…
                            </option>
                            {confirmedBranches.map((cb) => (
                              <option key={cb.id} value={cb.id}>
                                {cb.name}
                              </option>
                            ))}
                          </select>
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Reject
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Branches</h2>
              {confirmedBranches.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {confirmedBranches.map((b) => (
                  <div key={b.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <form action={updateBranchAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="branchId" value={b.id} />
                      <input type="text" name="name" defaultValue={b.name} className={`${INPUT} w-32`} />
                      <input type="text" name="description" defaultValue={b.description ?? ""} placeholder="description" className={`${INPUT} flex-1`} />
                      {(
                        [
                          ["defaultCallHasAgenda", "Agenda", b.defaultCallHasAgenda],
                          ["defaultCallNeedsSummary", "Summary", b.defaultCallNeedsSummary],
                          ["defaultCallRequireRead", "Read-confirm", b.defaultCallRequireRead],
                        ] as const
                      ).map(([name, label, value]) => (
                        <label key={name} className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
                          {label}
                          <select name={name} defaultValue={value === null ? "inherit" : value ? "on" : "off"} className={INPUT}>
                            <option value="inherit">Inherit</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </select>
                        </label>
                      ))}
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Save
                      </button>
                    </form>
                    <form action={deleteBranchAction} className="mt-2">
                      <input type="hidden" name="branchId" value={b.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createBranchAction} className="mt-3 flex flex-wrap gap-2">
                <input type="text" name="name" required placeholder="New branch name" className={INPUT} />
                <input type="text" name="description" placeholder="description (optional)" className={`${INPUT} flex-1`} />
                <button type="submit" className={BUTTON_PRIMARY}>
                  Add branch
                </button>
              </form>
            </section>
          </div>
        )}

        {activeTab === "cycles-tiers" && (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Cycle types</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Optional labels for grouping Cycles (Season, Reunion, Workday) — mainly so a Tier&rsquo;s cycle-type-count
                criterion can count occurrences of one kind of cycle. A Community that never uses this just leaves
                every Cycle untyped.
              </p>
              {cycleTypes.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {cycleTypes.map((ct) => (
                  <div key={ct.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <form action={updateCycleTypeAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="cycleTypeId" value={ct.id} />
                      <input type="text" name="name" defaultValue={ct.name} className={`${INPUT} flex-1`} />
                      <select name="defaultSourceCycleId" defaultValue={ct.defaultSourceCycleId ?? ""} className={INPUT}>
                        <option value="">No suggested starting cycle</option>
                        {cyclesForPicker.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      <select name="defaultPackId" defaultValue={ct.defaultPackId ?? ""} className={INPUT}>
                        <option value="">No suggested Task Pack</option>
                        {taskPacks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Save
                      </button>
                    </form>
                    <form action={deleteCycleTypeAction} className="mt-2">
                      <input type="hidden" name="cycleTypeId" value={ct.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createCycleTypeAction} className="mt-3 flex flex-wrap gap-2">
                <input type="text" name="name" required placeholder="New cycle type (e.g. Season)" className={INPUT} />
                <select name="defaultSourceCycleId" defaultValue="" className={INPUT}>
                  <option value="">No suggested starting cycle</option>
                  {cyclesForPicker.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <select name="defaultPackId" defaultValue="" className={INPUT}>
                  <option value="">No suggested Task Pack</option>
                  {taskPacks.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className={BUTTON_PRIMARY}>
                  Add cycle type
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Tiers</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Manual assignment is set from a member&rsquo;s own profile page. Cycle-type count is computed live off
                Participation. Tenure/completion/cohort aren&rsquo;t computed yet.
              </p>
              {tiers.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {tiers.map((t) => {
                  const config = t.criterionConfig as { cycleTypeId?: string; minCount?: number };
                  return (
                    <div key={t.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                      <form action={updateTierAction} className="flex flex-wrap items-center gap-2">
                        <input type="hidden" name="tierId" value={t.id} />
                        <input type="text" name="name" defaultValue={t.name} className={`${INPUT} flex-1`} />
                        <Tag>{t.criterionType}</Tag>
                        {t.criterionType === "cycle_type_count" && (
                          <>
                            <select name="cycleTypeId" defaultValue={config.cycleTypeId ?? ""} className={INPUT}>
                              <option value="">Pick a cycle type</option>
                              {cycleTypes.map((ct) => (
                                <option key={ct.id} value={ct.id}>
                                  {ct.name}
                                </option>
                              ))}
                            </select>
                            <input type="number" name="minCount" min={1} defaultValue={config.minCount ?? ""} placeholder="min count" className={`${INPUT} w-24`} />
                          </>
                        )}
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Save
                        </button>
                      </form>
                      <form action={deleteTierAction} className="mt-2">
                        <input type="hidden" name="tierId" value={t.id} />
                        <button type="submit" className={BUTTON_SECONDARY}>
                          Delete
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>

              <form action={createTierAction} className="mt-3 flex flex-wrap gap-2">
                <input type="text" name="name" required placeholder="New tier name" className={INPUT} />
                <select name="criterionType" defaultValue="manual" className={INPUT}>
                  <option value="manual">Manual</option>
                  <option value="tenure">Tenure (not yet computed)</option>
                  <option value="completion">Completion (not yet computed)</option>
                  <option value="cohort">Cohort (not yet computed)</option>
                  <option value="cycle_type_count">Cycle-type count (computed)</option>
                </select>
                <select name="cycleTypeId" defaultValue="" className={INPUT}>
                  <option value="">Cycle type (if cycle-type count)</option>
                  {cycleTypes.map((ct) => (
                    <option key={ct.id} value={ct.id}>
                      {ct.name}
                    </option>
                  ))}
                </select>
                <input type="number" name="minCount" min={1} placeholder="min count" className={`${INPUT} w-28`} />
                <button type="submit" className={BUTTON_PRIMARY}>
                  Add tier
                </button>
              </form>
            </section>
          </div>
        )}

        {activeTab === "profile-privacy" && (
          <div className="flex flex-col gap-8">
            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Profile questions</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Standing facts about a member — once-ever (e.g. emergency contact), per-cycle, or tied to one phase
                name (e.g. &ldquo;Availability &mdash; Build&rdquo;). A phase-scoped question with &ldquo;feeds
                capacity signal&rdquo; on powers the Coordination view&rsquo;s fitted-ask flags and non-response list
                for whichever cycle phase matches its name.
              </p>
              {profileQuestions.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {profileQuestions.map((q) => (
                  <div key={q.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3" style={{ opacity: q.archivedAt ? 0.6 : 1 }}>
                    <form action={updateProfileQuestionAction} className="flex flex-col gap-2">
                      <input type="hidden" name="questionId" value={q.id} />
                      <span className="text-[12px] text-[var(--text-muted)]">
                        {q.scope}
                        {q.scope === "phase" ? ` (${q.phaseNameHint})` : ""} — scope is set at creation, not editable here.
                      </span>
                      <ProfileQuestionEditor
                        initial={{ label: q.label, responseType: q.responseType, options: q.options, required: q.required }}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        {q.scope === "phase" && (
                          <CheckField label="feeds capacity signal" name="feedsCapacitySignal" defaultChecked={q.feedsCapacitySignal} />
                        )}
                        <CheckField label="surface during onboarding" name="onboardingSurface" defaultChecked={q.surfaces.includes("onboarding")} />
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Save
                        </button>
                      </div>
                    </form>
                    <form action={q.archivedAt ? unarchiveProfileQuestionAction : archiveProfileQuestionAction} className="mt-2">
                      <input type="hidden" name="questionId" value={q.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        {q.archivedAt ? "Unarchive" : "Archive"}
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createProfileQuestionAction} className="mt-3 flex max-w-[600px] flex-col gap-2">
                <ProfileQuestionEditor initial={{ label: "", responseType: "free_text", options: [], required: false }} />
                <select name="scope" defaultValue="once_ever" className={INPUT}>
                  <option value="once_ever">Once ever</option>
                  <option value="per_cycle">Per cycle</option>
                  <option value="phase">Tied to one phase name</option>
                </select>
                <input type="text" name="phaseNameHint" placeholder="phase name (only if scope is 'phase'), e.g. Build" className={INPUT} />
                <CheckField label="feeds capacity signal (phase-scoped only)" name="feedsCapacitySignal" />
                <CheckField label="surface during onboarding" name="onboardingSurface" />
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add profile question
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Sensitive data access</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Purpose-bound, not role-bound: pick which task or tier unlocks each field for <em>other</em>{" "}
                members&rsquo; values on <code>/sensitive-data</code>. A member can always see and edit their own
                values regardless of these rules. Only takes effect once &ldquo;Sensitive data&rdquo; is checked
                under the Modules tab.
              </p>
              {sensitiveFieldRules.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No rules yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {sensitiveFieldRules.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="flex-1 text-[13px] text-[var(--text)]">
                      {SENSITIVE_FIELD_LABELS[r.fieldKey]} — unlocked by{" "}
                      {r.unlockedByTaskId
                        ? `holding "${ruleTaskNameById.get(r.unlockedByTaskId) ?? "—"}"`
                        : `Tier "${tierNameById.get(r.unlockedByTierId!) ?? "—"}"`}
                    </span>
                    <form action={deleteSensitiveFieldAccessRuleAction}>
                      <input type="hidden" name="ruleId" value={r.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createSensitiveFieldAccessRuleAction} className="mt-3 flex max-w-[420px] flex-col gap-2">
                <select name="fieldKey" defaultValue={SENSITIVE_FIELD_KEYS[0]} className={INPUT}>
                  {SENSITIVE_FIELD_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {SENSITIVE_FIELD_LABELS[k]}
                    </option>
                  ))}
                </select>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Unlock via a Tier</span>
                  <select name="unlockedByTierId" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {tiers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField label="Or unlock via a Task ID (pick exactly one of Tier/Task)" name="unlockedByTaskId" placeholder="paste the task's ID from its /tasks/… URL" />
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add rule
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Consent purposes</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                One row per distinct purpose needing a member&rsquo;s consent — ordinary/operational processing gets
                no row here at all. Optionally pin a purpose to one Sensitive-data field: once set, that field only
                populates or shows once the owning member has granted this purpose, and stops the moment they
                withdraw it.
              </p>
              {consentPurposes.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No purposes yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {consentPurposes.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex-1">
                      <span className="text-[13px] font-medium text-[var(--text)]">{p.label}</span>{" "}
                      <code className="text-[12px] text-[var(--text-muted)]">{p.key}</code>
                      {p.gatesSensitiveField && (
                        <span className="text-[12px] text-[var(--text-muted)]"> — gates {SENSITIVE_FIELD_LABELS[p.gatesSensitiveField]}</span>
                      )}
                      {p.requiresExplicit && <span className="text-[12px] text-[var(--text-muted)]"> (explicit)</span>}
                      <div className="text-[12px] text-[var(--text-muted)]">{p.noticeText}</div>
                    </div>
                    <form action={deleteConsentPurposeAction}>
                      <input type="hidden" name="purposeId" value={p.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Delete
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createConsentPurposeAction} className="mt-3 flex max-w-[420px] flex-col gap-2">
                <input type="text" name="key" placeholder="key (e.g. sensitive_health)" required className={INPUT} />
                <input type="text" name="label" placeholder="label" required className={INPUT} />
                <textarea name="noticeText" placeholder="notice text shown to the member" required rows={2} className={INPUT} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Gates a Sensitive-data field (optional)</span>
                  <select name="gatesSensitiveField" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {SENSITIVE_FIELD_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {SENSITIVE_FIELD_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <CheckField label="requires explicit consent (required if gating a field)" name="requiresExplicit" />
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add purpose
                </button>
              </form>
            </section>
          </div>
        )}

        {activeTab === "forms" && (
          <section>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">Forms</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              A community-defined set of fields collected together as one submission — infrastructure other things
              lean on, starting with post-cycle feedback. Editing an existing form&rsquo;s fields never touches its
              past responses — a response keeps whatever it recorded under a field&rsquo;s original key even if that
              field is later renamed, retyped, or removed.
            </p>
            {forms.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
            <div className="mt-3 flex flex-col gap-2">
              {forms.map((f) => (
                <details key={f.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3" style={{ opacity: f.archivedAt ? 0.6 : 1 }}>
                  <summary className="cursor-pointer text-[14px] font-medium text-[var(--text)]">
                    {f.title}
                    {f.allowAnonymous && <span className="ml-1 text-[12px] font-normal text-[var(--text-muted)]">· anonymous allowed</span>}
                    <span className="ml-1 text-[12px] font-normal text-[var(--text-muted)]">
                      — {(f.fields as { label: string }[]).map((field) => field.label).join(", ")}
                    </span>
                  </summary>
                  <div className="mt-3">
                    <FormBuilder
                      action={updateFormAction}
                      mode="edit"
                      formId={f.id}
                      initialTitle={f.title}
                      initialDescription={f.description ?? ""}
                      initialAllowAnonymous={f.allowAnonymous}
                      initialFields={(f.fields as FormField[]).map((field) => ({
                        key: field.key,
                        label: field.label,
                        responseType: field.responseType,
                        options: field.options ?? [],
                        required: field.required ?? false,
                        isNameField: field.isNameField,
                        isEmailField: field.isEmailField,
                      }))}
                      submitLabel="Save"
                    />
                    <form action={f.archivedAt ? unarchiveFormAction : archiveFormAction} className="mt-2">
                      <input type="hidden" name="formId" value={f.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        {f.archivedAt ? "Unarchive" : "Archive"}
                      </button>
                    </form>
                  </div>
                </details>
              ))}
            </div>

            <div className="mt-4">
              <h3 className="text-[15px] font-medium text-[var(--text)]">New form</h3>
              <div className="mt-2">
                <FormBuilder action={createFormAction} mode="create" initialTitle="" initialDescription="" initialAllowAnonymous={false} initialFields={[]} submitLabel="Create form" />
              </div>
            </div>
          </section>
        )}

        {activeTab === "members" && (
          <section>
            <h2 className="text-[18px] font-semibold text-[var(--text)]">Bulk-add members</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              For an existing group&rsquo;s already-known roster — each person lands exactly where a magic-link
              first login would, with no Recruitment application required. A public invite link stays the right tool
              for anyone not already vouched for.
            </p>

            {bulkAdded !== undefined && (
              <div className="mt-3">
                <Banner tone="success">
                  Added {bulkAdded} member{bulkAdded === "1" ? "" : "s"}.
                </Banner>
              </div>
            )}

            {bulkReview ? (
              <>
                {bulkReview.newRows.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[14px] font-medium text-[var(--text)]">Will be created ({bulkReview.newRows.length})</h3>
                    <ul className="mt-1 text-[13px] text-[var(--text)]">
                      {bulkReview.newRows.map((r) => (
                        <li key={r.email}>
                          {r.name} — {r.email}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {bulkReview.alreadyExistsRows.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[14px] font-medium text-[var(--text-muted)]">
                      Already a member, skipped ({bulkReview.alreadyExistsRows.length})
                    </h3>
                    <ul className="mt-1 text-[13px] text-[var(--text-muted)]">
                      {bulkReview.alreadyExistsRows.map((r) => (
                        <li key={r.email}>
                          {r.name} — {r.email}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {bulkReview.malformedLines.length > 0 && (
                  <div className="mt-4">
                    <h3 className="text-[14px] font-medium text-[var(--danger)]">Couldn&rsquo;t parse, skipped ({bulkReview.malformedLines.length})</h3>
                    <ul className="mt-1 text-[13px] text-[var(--danger)]">
                      {bulkReview.malformedLines.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {bulkReview.newRows.length > 0 ? (
                  <form action={confirmBulkMemberImportAction} className="mt-4">
                    <input type="hidden" name="state" value={bulkStateRaw} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Confirm — create {bulkReview.newRows.length} member{bulkReview.newRows.length === 1 ? "" : "s"}
                    </button>
                  </form>
                ) : (
                  <p className="mt-4 text-[13px] text-[var(--text-muted)]">Nothing new to create.</p>
                )}
                <Link href="/settings?tab=members" className="mt-2 inline-block text-[13px] font-medium text-[var(--accent-1)] hover:underline">
                  Start over
                </Link>
              </>
            ) : (
              <form action={reviewBulkMemberImportAction} encType="multipart/form-data" className="mt-3 flex max-w-[480px] flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Paste one per line — Name, email@example.com</span>
                  <textarea name="pastedText" rows={6} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Or upload a .csv with the same shape (no header row)</span>
                  <input type="file" name="file" accept=".csv,text/csv,text/plain" />
                </label>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Review
                </button>
              </form>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

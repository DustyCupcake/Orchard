import { inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, listCycleTypes, listPendingBranches, listTiers, requireAdmins } from "@/lib/settings";
import Tabs from "@/components/ui/Tabs";
import {
  allowsMultipleGrants,
  describeGrantScope,
  isMisplacedCommunityGrant,
  isOpenableModule,
  listGrantsWithTaskInfo,
  listHoldersByTaskId,
  listOpenModuleKeys,
  PERMISSION_MODULE_HINTS,
  PERMISSION_MODULE_KEYS,
  PERMISSION_MODULE_LABELS,
  PERMISSION_MODULE_SECTIONS,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { listTasks } from "@/lib/tasks";
import { listCycles } from "@/lib/cycles";
import { listProfileQuestions } from "@/lib/profile-questions";
import {
  INDICATOR_FAMILY_LABELS,
  canPublishAsIndicator,
  indicatorBlocker,
  indicatorFamilyFor,
} from "@/lib/profile-questions/indicators";
import { listTraitAxes } from "@/lib/trait-axes";
import { listTaskPacks } from "@/lib/task-packs";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { SENSITIVE_FIELD_KEYS, SENSITIVE_FIELD_LABELS, listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { listForms } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
import { listConsentPurposes } from "@/lib/consent";
import { ForbiddenError } from "@/lib/errors";
import { getFoundersAssemblyPromptState } from "@/lib/assemblies";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import {
  addPermissionGrantAction,
  archiveFormAction,
  archiveProfileQuestionAction,
  archiveTraitAxisAction,
  confirmBulkMemberImportAction,
  confirmPendingBranchAction,
  createBranchAction,
  createConsentPurposeAction,
  createCycleTypeAction,
  createFormAction,
  createProfileQuestionAction,
  seedDefaultProfileQuestionsAction,
  createSensitiveFieldAccessRuleAction,
  createTierAction,
  createTraitAxisAction,
  deleteBranchAction,
  deleteConsentPurposeAction,
  deleteCycleTypeAction,
  deleteSensitiveFieldAccessRuleAction,
  deleteTierAction,
  rejectPendingBranchAction,
  removePermissionGrantAction,
  setModuleOpenAction,
  reviewBulkMemberImportAction,
  setPermissionGrantAction,
  unarchiveFormAction,
  unarchiveProfileQuestionAction,
  unarchiveTraitAxisAction,
  updateBranchAction,
  updateCoordinationSettingsAction,
  updateCycleTypeAction,
  updateFormAction,
  updateGeneralSettingsAction,
  updateModulesSettingsAction,
  updateProfileQuestionAction,
  updateRecruitmentSettingsAction,
  updateTierAction,
  updateTraitAxisAction,
} from "./actions";
import { decodeBulkMemberState } from "./bulk-members-state";
import FoundersAssemblyPrompt from "./FoundersAssemblyPrompt";
import FormBuilder from "./FormBuilder";
import { toEditableFieldShape } from "@/lib/field-shape";
import ProfileQuestionEditor from "./ProfileQuestionEditor";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "general", label: "General" },
  { key: "permissions", label: "Access & permissions" },
  { key: "coordination", label: "Coordination" },
  { key: "modules", label: "Modules" },
  { key: "recruitment", label: "Recruitment" },
  { key: "branches", label: "Branches" },
  { key: "cycles-tiers", label: "Events & Tiers" },
  { key: "profile-privacy", label: "Profile & Privacy" },
  { key: "forms", label: "Forms" },
  { key: "members", label: "Members" },
] as const;
type TabKey = (typeof TABS)[number]["key"];
const TAB_KEYS = TABS.map((t) => t.key) as readonly string[];

function TabBar({ active }: { active: TabKey }) {
  return <Tabs tabs={TABS} active={active} hrefFor={(key) => `/settings?tab=${key}`} />;
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
// (allowsMultipleGrants === false) still enforces at most one grantee
// *per scope* — the Add form posts to setPermissionGrantAction
// (replaces the same scope's existing grant) instead of
// addPermissionGrantAction, with a static warning next to it once the
// same scope already has a grantee, rather than the old pre-filled-
// input-doubling-as-replace UX. Each row shows the granted task plus
// its derived scope — task — branch — {cycle name | Community-wide |
// Evergreen} via describeGrantScope (docs/cycle-scope-remediation-
// plan.md §2.1/§5.1: the grant row itself carries no cycle; the
// granting task's own placement *is* the scope, so there is nothing
// else to pick). A community-shaped module's task that sits in a cycle
// renders a warning rather than being silently ignored
// (isMisplacedCommunityGrant). The field itself carries no scope
// language — the section header it sits under (PERMISSION_MODULE_SECTIONS)
// states the placement rule for every module in it, and this module's
// hint only says what holding the role does. The Add input's `list`
// attribute wires it to the shared task datalist rendered once for the
// whole tab (see the "permissions" tab body below) — a zero-JS "search
// by title" picker; the datalist's own <option value> is still the raw
// taskId (that's how HTML datalists work), so the input's text
// collapses to the ID once a suggestion is picked, but the
// human-readable label is what's actually searched/matched while
// typing.
function GrantField({
  moduleKey,
  grants,
  open,
  openable,
  holdersByTaskId,
  sensitiveFieldsGatedByThisModule,
}: {
  moduleKey: PermissionModuleKey;
  grants: { taskId: string; title: string; branchName: string; cycleId: string | null; cycleName: string | null }[];
  open: boolean;
  openable: boolean;
  holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
  // Which sensitive fields are unlocked by *this module's* grant — surfaced
  // so the person ticking the box can see the coupling exists. Opening a
  // module does NOT unlock them (D9), so this is information, not a warning
  // about behaviour change.
  sensitiveFieldsGatedByThisModule: string[];
}) {
  const multi = allowsMultipleGrants(moduleKey);
  const label = PERMISSION_MODULE_LABELS[moduleKey];
  // D13: the two highest-blast-radius modules, which stay openable because a
  // small Community may genuinely want them, but say plainly what ticking
  // the box means. Warn rather than hard-confirm — this surface is
  // deliberately zero-JS (the grant picker is a datalist, Remove is a plain
  // form), and a real confirm() would be the one control here that changes
  // access the instant it's pressed.
  const blastRadius =
    moduleKey === "support"
      ? "Every member will be able to view the platform exactly as any other member would, read-only — including as the people who hold sensitive-data and permission access."
      : moduleKey === "admin"
        ? "Every member will be able to change every Community setting, including who holds which permissions."
        : null;
  const holders = grants.reduce((n, g) => n + (holdersByTaskId.get(g.taskId)?.length ?? 0), 0);
  const unheld = open && grants.length > 0 && holders === 0;

  return (
    <FieldSet legend={label}>
      <p className="text-[12px] text-[var(--text-muted)]">{PERMISSION_MODULE_HINTS[moduleKey]}</p>

      {/* The open checkbox, above the grant list so it reads as the primary
          fact when set and as a relaxation of the task list when not. */}
      {openable ? (
        <form action={setModuleOpenAction} className="flex flex-col gap-1.5">
          <input type="hidden" name="moduleKey" value={moduleKey} />
          <input type="hidden" name="tab" value="permissions" />
          <label className="flex items-start gap-2 text-[13px] text-[var(--text)]">
            <input type="checkbox" name="open" defaultChecked={open} className="mt-0.5" />
            <span>
              Everyone has this permission
              {open ? (
                <span className="block text-[12px] text-[var(--text-muted)]">
                  Every member can do this. The task below is no longer required — keep it if you
                  want someone named as responsible.
                </span>
              ) : null}
            </span>
          </label>
          {blastRadius && (
            <p className="text-[12px] text-[var(--text-muted)]">{blastRadius}</p>
          )}
          {sensitiveFieldsGatedByThisModule.length > 0 && (
            <p className="text-[12px] text-[var(--text-muted)]">
              Unlocking {sensitiveFieldsGatedByThisModule.join(", ")} is a separate setting, keyed
              to whoever <em>holds</em> this module&apos;s task. Opening the module does not change
              that.
            </p>
          )}
          <div>
            <button type="submit" className={BUTTON_SECONDARY}>
              {open ? "Turn off" : "Turn on"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-[12px] text-[var(--text-muted)]">
          This one can&rsquo;t be open to everyone — when nobody is named, there is nobody to
          notify. It needs a holder.
        </p>
      )}

      {unheld && (
        <Banner tone="warning">
          {label} is open to everyone and no task grants it, so nobody is named as responsible —
          anything that routes work to a named person has no one to route to.
        </Banner>
      )}

      {grants.length === 0 && !open && (
        <p className="text-[13px] text-[var(--text-muted)]">No task grants this yet.</p>
      )}
      {grants.length === 0 && open && (
        <p className="text-[13px] text-[var(--text-muted)]">
          No task grants this — which is fine while it&rsquo;s open, since no one needs to be
          named for it to work.
        </p>
      )}
      {grants.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {grants.map((g) => {
            const taskHolders = holdersByTaskId.get(g.taskId) ?? [];
            return (
            <li key={g.taskId} className="flex flex-col gap-1 text-[13px] text-[var(--text)]">
              <div className="flex flex-wrap items-center gap-2">
                {g.title} — {g.branchName}
                <span className="text-[var(--text-muted)]">
                  {" "}
                  — {describeGrantScope(moduleKey, g.cycleId, g.cycleName)}
                </span>
                <form action={removePermissionGrantAction}>
                  <input type="hidden" name="moduleKey" value={moduleKey} />
                  <input type="hidden" name="taskId" value={g.taskId} />
                  <input type="hidden" name="tab" value="permissions" />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Remove
                  </button>
                </form>
              </div>
              {/* D14. `capacity` is the real control on how many people hold a
                  role and nothing in the permission layer read it, so a
                  single-cardinality module could be handed to five people with
                  no indication here. Names at three or fewer, count above, and
                  the count always links to the task — which already renders
                  "Held by …" ungated, so it resolves for any admin here. */}
              {taskHolders.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)]">
                  Nobody is holding this{" "}
                  <Link href={`/tasks/${g.taskId}`} className="text-[var(--accent-1)] hover:underline">
                    open the task
                  </Link>{" "}
                  to put yourself forward.
                </p>
              ) : (
                <p className="text-[12px] text-[var(--text-muted)]">
                  {taskHolders.length <= 3 ? (
                    <>
                      Held by {taskHolders.map((h) => h.name).join(", ")} ({taskHolders.length})
                    </>
                  ) : (
                    <>
                      Held by{" "}
                      <Link
                        href={`/tasks/${g.taskId}`}
                        className="text-[var(--accent-1)] hover:underline"
                      >
                        {taskHolders.length} people
                      </Link>
                    </>
                  )}
                </p>
              )}
              {isMisplacedCommunityGrant(moduleKey, g.cycleId) && (
                <Banner tone="warning">
                  This task sits in an event, but {PERMISSION_MODULE_LABELS[moduleKey]} is a community-wide
                  role — keep its event unset. It still grants community-wide access (the server is the
                  source of truth), so it isn&rsquo;t silently ignored.
                </Banner>
              )}
            </li>
            );
          })}
        </ul>
      )}
      {!multi && grants.length > 0 && (
        <p className="text-[12px] text-[var(--text-muted)]">
          Only one task can hold this per scope — adding a task placed in the same scope (the same
          event, or community-wide for an event-independent task) moves it here instead of alongside it.
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

/**
 * The "publish this as a community indicator" control for one profile
 * question, with the rule that governs it attached.
 *
 * The display form is deliberately *not* offered as a choice. It's
 * derived from the question's answer type in indicators.ts, because the
 * alternatives are worse in a specific way each: a hand-picked chart
 * option lets someone put a pick-any question in a pie, and a pie of
 * "who picked what" implies slices of one whole when five people choosing
 * three options each is fifteen slices over five people. So this control
 * says what the answer *will* look like rather than offering a menu of
 * ways to misdescribe it.
 */
function IndicatorToggle({
  question,
  canPublish,
  blocker,
}: {
  question: {
    id: string;
    responseType: string;
    scope: string;
    publishedAsIndicator: boolean;
  };
  canPublish: boolean;
  blocker: { reason: string; remedy: string } | null;
}) {
  const family = indicatorFamilyFor(question.responseType);
  return (
    <div className="flex flex-col gap-1">
      <label
        className={`flex items-center gap-2 text-[13px] ${canPublish ? "text-[var(--text)]" : "text-[var(--text-muted)]"}`}
      >
        <input
          type="checkbox"
          name="publishedAsIndicator"
          defaultChecked={question.publishedAsIndicator}
          disabled={!canPublish}
        />{" "}
        show the answers on the Community page
      </label>
      {canPublish ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Shown as {INDICATOR_FAMILY_LABELS[family!].toLowerCase()} &mdash; the form follows from the
          answer type, so it can&rsquo;t end up describing the answers wrongly.
        </p>
      ) : (
        /* The reason *and* its remedy, so the disabled checkbox teaches
           the rule instead of just refusing. A member who can't work out
           why an option is greyed out concludes the app is broken. */
        blocker && (
          <p className="text-[12px] text-[var(--text-muted)]">
            Not available here, because {blocker.reason}. {blocker.remedy}
          </p>
        )
      )}
    </div>
  );
}

/**
 * The two privacy attributes for one profile question.
 *
 * Both are offered as ordinary checkboxes with the consequence spelled
 * out, because both are only meaningful alongside a default that does the
 * work. "Sensitive" is not a label to apply to anything that feels
 * private — it is the thing you must tick *in order to restrict* who may
 * read the answer, and that framing is the entire safety property. An
 * admin who forgets it doesn't get a private-looking question nobody can
 * read; they get a public one, which is a mistake they will see.
 */
function PrivacyToggles({
  question,
  emergencyBlocked,
  emergencyNeedsSensitive,
  ruleCount,
}: {
  question: { sensitive: boolean; emergencyAccess: boolean; publishedAsIndicator: boolean };
  emergencyBlocked: boolean;
  // Emergency access overrides a restriction, so the box waits for the
  // sensitive tick. Un-ticking emergency is never blocked — same escape
  // hatch as the sensitive box, and for the same reason.
  emergencyNeedsSensitive: boolean;
  ruleCount: number;
}) {
  // Turning sensitive ON is gated on a rule existing, so the box is
  // disabled until one does. Ticking it *off* is never blocked, including
  // on a question that somehow ended up sensitive with no rule — an admin
  // has to be able to fix that state, and a disabled box would leave one
  // way out: deleting the question.
  const needsRule = !question.sensitive && ruleCount === 0;
  const emergencyDisabled = emergencyBlocked || emergencyNeedsSensitive;
  return (
    <div className="flex flex-col gap-2">
      <label className={`flex items-center gap-2 text-[13px] ${needsRule ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}>
        <input type="checkbox" name="sensitive" defaultChecked={question.sensitive} disabled={needsRule} /> sensitive
        <span className="text-[var(--text-muted)]">
          &mdash; restrict who may read the answer to this
        </span>
      </label>
      {needsRule && (
        <p className="text-[12px] text-[var(--text-muted)]">
          Not available until this question has an access rule, because the rule <em>is</em> the restriction
          &mdash; sensitive only says which questions the rules apply to. Add one under Sensitive data access
          below, then tick this.
        </p>
      )}
      <label
        className={`flex items-center gap-2 text-[13px] ${emergencyDisabled ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
      >
        <input
          type="checkbox"
          name="emergencyAccess"
          defaultChecked={question.emergencyAccess}
          disabled={emergencyDisabled}
        />
        emergency access
        <span className="text-[var(--text-muted)]">
          &mdash; readable by whoever turns on emergency mode, and they&rsquo;re notified
        </span>
      </label>
      {emergencyBlocked ? (
        /* Published and emergency are each a claim about who can read the
           answer, and this question can't be making both. The *sensitive*
           tick would have caught it too, but the emergency box is the one
           somebody is looking at, so it explains itself. */
        <p className="text-[12px] text-[var(--text-muted)]">
          Not available while this question is published on the Community page. An indicator is
          already readable by the whole community, so there&rsquo;s nothing for an emergency
          override to reach &mdash; and this isn&rsquo;t the kind of question anyone needs in an
          emergency. Unpublish it first, or leave this off.
        </p>
      ) : emergencyNeedsSensitive ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Not available until this question is marked sensitive. Emergency access overrides a
          restriction, so it needs one to override &mdash; and on a question everyone can already
          read there&rsquo;s nothing to reveal, which would put a read of public data in the log as
          though it had been protected.
        </p>
      ) : (
        <p className="text-[12px] text-[var(--text-muted)]">
          A question that is <em>not</em> sensitive is readable by the whole community by default,
          so marking it sensitive is the only way to restrict it at all &mdash; and forgetting to
          makes the answers public, visibly. Answering an emergency question <em>is</em> agreeing to
          emergency reads: there&rsquo;s no separate box to tick, and not answering is the only way
          to decline. Every emergency read notifies the member it was about.
        </p>
      )}
    </div>
  );
}

// Every question an access rule or a consent purpose is allowed to name.
//
// Not filtered to the sensitive ones, and that is the point: the rule is
// the half that gets built first. `sensitive` is refused until a rule
// exists, so a rule that also demanded the flag would leave the state
// unreachable. An admin builds the audience here, then ticks the box on
// the question, and the rule starts restricting the moment they do.
//
// So a rule against a plain question is a *staged* rule — it changes
// nothing today, because the question is readable by everyone, and it is
// visibly waiting rather than silently ineffective, since the question's
// own sensitive box is right there above with its own explanation.
function questionRuleTargets(questions: { id: string; label: string; archivedAt: Date | null }[]) {
  return questions
    .filter((q) => !q.archivedAt)
    .map((q) => ({ id: q.id, label: q.label }));
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
  // Only offered on the un-tabbed landing view, not repeated above every
  // one of the ten tabs. Someone clicking "Settings" in the sidebar is
  // arriving with a question; someone who deep-linked to
  // /settings?tab=recruitment already knows what they came for, and a
  // banner above that form is just noise. It's also time-limited anyway
  // (see getFoundersAssemblyPromptState).
  const showFoundersPrompt = tabRaw === undefined || tabRaw === "";
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
    traitAxes,
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
    authorized ? listTraitAxes(viewing, { includeArchived: true }) : Promise.resolve([]),
    authorized ? listSensitiveFieldAccessRules(viewing) : Promise.resolve([]),
    authorized ? listForms(viewing, { includeArchived: true }) : Promise.resolve([]),
    authorized ? listConsentPurposes(viewing) : Promise.resolve([]),
    authorized ? listPendingBranches(viewing) : Promise.resolve([]),
    listTaskPacks(viewing),
    authorized ? listTasks(viewing) : Promise.resolve([]),
  ]);
  const confirmedBranches = branches.filter((b) => b.status === "confirmed");
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));

  // Question-keyed access rules and consent gates need a label, and need
  // to only offer questions they're allowed to name. ruleCountByQuestion
  // is what disables the "sensitive" checkbox on a question with no rule
  // yet — the write side refuses that combination, so a checkbox that
  // quietly accepts it would be a lie about what the settings do.
  const sensitiveQuestionOptions = questionRuleTargets(profileQuestions);
  const questionLabelById = new Map(profileQuestions.map((q) => [q.id, q.label]));
  const ruleCountByQuestion = new Map<string, number>();
  for (const r of sensitiveFieldRules) {
    if (r.questionId) {
      ruleCountByQuestion.set(r.questionId, (ruleCountByQuestion.get(r.questionId) ?? 0) + 1);
    }
  }

  // Every access gate this screen configures reads from one real table
  // now (docs/development-plan.md's Phase 63) — one query, grouped by
  // module in JS, rather than nine separate lookups. Branch name is
  // resolved from the branch list this page already has in hand
  // (branchNameById, above) rather than joined a second time.
  const cycleNameById = new Map(cyclesForPicker.map((c) => [c.id, c.name]));
  const allGrants = await listGrantsWithTaskInfo(communityRow.id);
  const grantsByModule = new Map<
    PermissionModuleKey,
    { taskId: string; title: string; branchName: string; cycleId: string | null; cycleName: string | null }[]
  >();
  for (const g of allGrants) {
    const list = grantsByModule.get(g.moduleKey) ?? [];
    list.push({
      taskId: g.taskId,
      title: g.title,
      branchName: branchNameById.get(g.branchId) ?? "—",
      cycleId: g.cycleId,
      cycleName: g.cycleId ? (cycleNameById.get(g.cycleId) ?? null) : null,
    });
    grantsByModule.set(g.moduleKey, list);
  }
  const grantsFor = (moduleKey: PermissionModuleKey) => grantsByModule.get(moduleKey) ?? [];

  // The open flags, and who holds each granting task (D14). Both are one
  // query for the whole tab rather than per-row: the holder map is keyed by
  // task id precisely so a member holding two of the same module's tasks shows
  // up on both rows, which the distinct-member form used by D12 deliberately
  // does not do.
  const openModuleKeys = await listOpenModuleKeys(communityRow.id);
  const holdersByTaskId = await listHoldersByTaskId(allGrants.map((g) => g.taskId));

  // Which sensitive fields are unlocked by a *grant* to each module. Opening a
  // module does not unlock them (D9 — deliberately deferred), so this is
  // shown as information about an existing, separate setting rather than as a
  // warning about the checkbox: the coupling is real and invisible, and the
  // person deciding should be able to see it exists.
  const sensitiveFieldsByModule = new Map<PermissionModuleKey, string[]>();
  for (const rule of sensitiveFieldRules) {
    if (!rule.unlockedByGrantModuleKey) continue;
    const existing = sensitiveFieldsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
    if (rule.fieldKey) existing.push(rule.fieldKey.replace(/_/g, " "));
    if (rule.questionId) existing.push("a profile question");
    sensitiveFieldsByModule.set(rule.unlockedByGrantModuleKey, existing);
  }
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

  // The Forms tab's "maps to profile question" dropdown (src/lib/
  // forms.ts's mapsToProfileQuestionId) only ever accepts a once_ever,
  // non-archived question — see requireValidMappedProfileQuestions —
  // so an archived or per_cycle/phase one isn't offered as an option
  // to begin with, rather than being rejected only after submitting.
  const onceEverProfileQuestionOptions = profileQuestions
    .filter((q) => q.scope === "once_ever" && !q.archivedAt)
    .map((q) => ({ id: q.id, label: q.label }));

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
        {showFoundersPrompt && (await getFoundersAssemblyPromptState(viewing.communityId)) === "show" && (
          <div className="mt-3">
            <FoundersAssemblyPrompt />
          </div>
        )}
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

      {showFoundersPrompt && (await getFoundersAssemblyPromptState(viewing.communityId)) === "show" && (
        <div className="mt-4">
          <FoundersAssemblyPrompt />
        </div>
      )}

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
                <CheckField
                  label="Make SSO the primary sign-in method"
                  name="oidcPrimary"
                  defaultChecked={communityRow.oidcPrimary}
                />
                <span className="text-[12px] text-[var(--text-muted)]">
                  On: /login redirects straight to Zitadel instead of showing a form, and magic-link stops being able
                  to create new accounts — it only works for someone who already has a Zitadel-linked account here.
                  Off: unchanged from magic-link-only behavior — both shown as equal options, and magic-link can
                  still originate new accounts. Only takes effect once OIDC is actually configured above.
                </span>
              </FieldSet>

              <CheckField label="Events on (multiple named production runs over time)" name="cyclesEnabled" defaultChecked={communityRow.cyclesEnabled} />
              <CheckField label="Phases on (an event can define a named phase spine)" name="phasesEnabled" defaultChecked={communityRow.phasesEnabled} />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Default date display</span>
                <select name="defaultDateDisplayMode" defaultValue={communityRow.defaultDateDisplayMode} className={INPUT}>
                  <option value="exact">Exact calendar dates</option>
                  <option value="period">Period name + weekday when available</option>
                </select>
                <span className="text-[12px] text-[var(--text-muted)]">
                  Members can override this on their profile. Exact dates remain available in accessible labels and fallbacks.
                </span>
              </label>
              {communityRow.phasesEnabled && (
                <CheckField
                  label="On-site mode (while on, structural changes across settings, branches, tiers, event types, starting a new event, Requirement changes, publishing the Programme, and Spatial-planning edits are all locked; everyday task/wiki/shift work stays live)"
                  name="onsiteModeEnabled"
                  defaultChecked={communityRow.onsiteModeEnabled}
                />
              )}

              <label className="flex flex-col gap-1">
                <span className={LABEL}>Who may start an event</span>
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
          <div className="flex flex-col gap-7">
            <p className="text-[13px] text-[var(--text-muted)]">
              Every access-gated capability in the app, in one place, grouped by how far each one
              reaches. One rule covers them all:{" "}
              <span className="text-[var(--text)]">a task grants what it sits in</span>. Add or replace a
              grant with the search-by-title picker. See a task&rsquo;s own detail or
              proposal-activation screen for the identical checkbox-driven equivalent.
            </p>
            <datalist id="permissions-community-tasks">
              {communityTasksForPicker.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} — {t.branchName}
                </option>
              ))}
            </datalist>
            {/* One section per PERMISSION_MODULE_SECTIONS, each stating the
                placement rule its modules share once — the per-module hints
                used to each restate that rule in full, which is what made
                this tab read as a wall of near-identical paragraphs. */}
            {PERMISSION_MODULE_SECTIONS.map((section) => (
              <section key={section.key} className="flex flex-col gap-3">
                <div>
                  <h2 className="text-[18px] font-semibold text-[var(--text)]">{section.title}</h2>
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">{section.rule}</p>
                </div>
                {section.moduleKeys.map((moduleKey) => (
                  <GrantField
                    key={moduleKey}
                    moduleKey={moduleKey}
                    grants={grantsFor(moduleKey)}
                    open={openModuleKeys.has(moduleKey)}
                    openable={isOpenableModule(moduleKey)}
                    holdersByTaskId={holdersByTaskId}
                    sensitiveFieldsGatedByThisModule={sensitiveFieldsByModule.get(moduleKey) ?? []}
                  />
                ))}
              </section>
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
            {/* A visibility-adjacent decision, so it lives here rather
                than with the profile questions. The floor is the whole
                point: an event's attendees are a small, nameable group,
                so at low numbers a single bar identifies one person in a
                way the community-wide chart never does. */}
            <CheckField
              label="Break community indicators out for one event&rsquo;s attendees"
              name="cycleIndicatorsEnabled"
              defaultChecked={communityRow.cycleIndicatorsEnabled}
            />
            <TextField
              label="Smallest event to break indicators out for (members)"
              name="cycleIndicatorsMinMembers"
              type="number"
              defaultValue={communityRow.cycleIndicatorsMinMembers}
              hint="Below this, indicators stay community-wide and the page says so rather than showing all-member figures under an event heading. There is no obviously right number — the value is having decided one."
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

            <FieldSet legend="Post-event feedback">
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

            <FieldSet legend="Recruitment doors">
              <CheckField
                label="General applications open"
                name="recruitmentApplicationsOpen"
                defaultChecked={communityRow.recruitmentApplicationsOpen}
              />
              <CheckField
                label="General invites open"
                name="recruitmentInvitesOpen"
                defaultChecked={communityRow.recruitmentInvitesOpen}
              />
              <span className="text-[12px] text-[var(--text-muted)]">
                Close the community&rsquo;s general event-independent doors to run fully closed except for the events
                or periods you open — per-event doors live on each event&rsquo;s own settings (§4.3/D13).
              </span>
            </FieldSet>

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
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Event types</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Optional labels for grouping Events (Season, Reunion, Workday) — mainly so a Tier&rsquo;s event-type-count
                criterion can count occurrences of one kind of event. A Community that never uses this just leaves
                every Event untyped.
              </p>
              {cycleTypes.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {cycleTypes.map((ct) => (
                  <div key={ct.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <form action={updateCycleTypeAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="cycleTypeId" value={ct.id} />
                      <input type="text" name="name" defaultValue={ct.name} className={`${INPUT} flex-1`} />
                      <select name="defaultSourceCycleId" defaultValue={ct.defaultSourceCycleId ?? ""} className={INPUT}>
                        <option value="">No suggested starting event</option>
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
                <input type="text" name="name" required placeholder="New event type (e.g. Season)" className={INPUT} />
                <select name="defaultSourceCycleId" defaultValue="" className={INPUT}>
                  <option value="">No suggested starting event</option>
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
                  Add event type
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Tiers</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Manual assignment is set from a member&rsquo;s own profile page. Event-type count is computed live off
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
                              <option value="">Pick an event type</option>
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
                  <option value="cycle_type_count">Event-type count (computed)</option>
                </select>
                <select name="cycleTypeId" defaultValue="" className={INPUT}>
                  <option value="">Event type (if event-type count)</option>
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
              {profileQuestions.length === 0 && (
                /* Offered only when there's genuinely nothing to edit. Once
                   a community has even one question it has decided what its
                   questions are, and silently adding twenty more over the top
                   would be the wrong kind of helpful. */
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-[13px] text-[var(--text)]">
                    This Community has no questions yet.
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    Add the starter set &mdash; twenty questions covering who someone is, what they can
                    do, what an event needs, and a few restricted answers that come with an audience
                    already attached. Every one of them is yours to retitle, re-shape, archive or delete
                    afterwards; nothing is a commitment.
                  </p>
                  <form action={seedDefaultProfileQuestionsAction} className="mt-3">
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Add the starter set
                    </button>
                  </form>
                </div>
              )}
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Standing facts about a member — once-ever (e.g. emergency contact), per-event, or tied to one phase
                name (e.g. &ldquo;Availability &mdash; Build&rdquo;). A phase-scoped question with &ldquo;feeds
                capacity signal&rdquo; on powers the Coordination view&rsquo;s fitted-ask flags and non-response list
                for whichever event phase matches its name.
              </p>
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                Everyone&rsquo;s outstanding questions are answered at{" "}
                <a href="/questions" className="text-[var(--accent-1)] hover:underline">
                  /questions
                </a>
                , which is also where a member lands after saying they&rsquo;re coming to an event from their
                Dashboard or Community dashboard. Marking one <strong>required</strong> means anyone who hasn&rsquo;t
                answered it yet gets a count on their Dashboard until they do — so reserve it for what you genuinely
                can&rsquo;t run the event without. &ldquo;I don&rsquo;t know yet&rdquo; counts as an answer, but add
                a <strong>needed by</strong> date if you need a real answer by a real time: past that date the
                deferral stops counting and the question comes back. Leave it blank for a standing fact like an
                emergency contact, where a deferral should really be permanent.
                <br />
                The two &ldquo;not answering&rdquo; buttons are deliberately different. <strong>Allow &ldquo;I
                don&rsquo;t know yet&rdquo;</strong> is on by default and means &ldquo;ask me again later&rdquo;.
                <strong>Allow &ldquo;prefer not to say&rdquo;</strong> is off by default and means{" "}
                <em>this question is optional for everyone</em> — turning it on makes the question stop being
                required in practice, because picking it is a permanent, unchased answer. Turn it on for
                questions about someone&rsquo;s own identity or circumstances, and leave it off for questions the
                community genuinely needs a real answer to from everyone.
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
                        initial={toEditableFieldShape({
                          label: q.label,
                          responseType: q.responseType,
                          options: q.options,
                          required: q.required,
                          multiline: q.multiline,
                          validation: q.validation,
                          allowOther: q.allowOther,
                          min: q.min,
                          max: q.max,
                          step: q.step,
                        })}
                      />
                      <div className="flex flex-wrap items-center gap-3">
                        {q.scope === "phase" && (
                          <CheckField label="feeds capacity signal" name="feedsCapacitySignal" defaultChecked={q.feedsCapacitySignal} />
                        )}
                        <CheckField label="also ask during a new member's first-week onboarding" name="onboardingSurface" defaultChecked={q.surfaces.includes("onboarding")} />
                        <CheckField
                          label="allow &ldquo;I don&rsquo;t know yet&rdquo;"
                          name="allowDeferral"
                          defaultChecked={q.allowDeferral}
                        />
                        <CheckField
                          label="allow &ldquo;prefer not to say&rdquo;"
                          name="allowPreferNotToSay"
                          defaultChecked={q.allowPreferNotToSay}
                        />
                        {/* The indicator toggle is disabled with its
                            reason attached, rather than hidden or
                            silently ignored. Two things are being
                            protected here: a member's expectation that
                            a fact about them is private unless the
                            community said otherwise, and the
                            aggregate's ability to render whatever it
                            ends up pointed at. A checkbox that
                            refuses to tick and says why teaches the
                            rule; one that just isn't there leaves
                            someone wondering where the option went. */}
                        <IndicatorToggle
                          question={q}
                          canPublish={canPublishAsIndicator(q)}
                          blocker={indicatorBlocker(q)}
                        />
                        <PrivacyToggles
                          question={q}
                          emergencyBlocked={q.emergencyAccess && q.publishedAsIndicator}
                          // Only blocks turning it ON. A question that is
                          // somehow already emergency-marked without being
                          // sensitive must still be tickable-off, or the
                          // state would be unescapable except by deleting
                          // the question.
                          emergencyNeedsSensitive={!q.sensitive && !q.emergencyAccess}
                          ruleCount={ruleCountByQuestion.get(q.id) ?? 0}
                        />
                        {q.required && q.allowDeferral && (
                          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                            needed by
                            <input type="date" name="requiredBy" defaultValue={q.requiredBy ?? ""} className={`${INPUT} py-1`} />
                          </label>
                        )}
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Save
                        </button>
                      </div>
                      {(!q.allowDeferral || q.allowPreferNotToSay) && (
                        <p className="text-[12px] text-[var(--text-muted)]">
                          {!q.allowDeferral && (
                            <>
                              No &ldquo;I don&rsquo;t know yet&rdquo; button is offered for this one — it stays
                              outstanding until it&rsquo;s really answered.
                            </>
                          )}
                          {q.allowPreferNotToSay && (
                            <>
                              {!q.allowDeferral && " "}
                              &ldquo;Prefer not to say&rdquo; is a permanent answer here: whoever picks it is
                              done with this question, and no due date or reminder will chase them.
                            </>
                          )}
                        </p>
                      )}
                      {q.requiredBy && (
                        <p className="text-[12px] text-[var(--text-muted)]">
                          After {new Date(q.requiredBy).toLocaleDateString()}, anyone who answered
                          &ldquo;I don&rsquo;t know yet&rdquo; counts as still owing an answer.
                        </p>
                      )}
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

              <details className="mt-3">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-[var(--accent-1)] hover:underline">
                  <PlusIcon /> Add profile question
                </summary>
                <form action={createProfileQuestionAction} className="mt-2 flex max-w-[600px] flex-col gap-2">
                  <ProfileQuestionEditor
                    initial={toEditableFieldShape({ label: "", responseType: "text", required: false })}
                  />
                  <select name="scope" defaultValue="once_ever" className={INPUT}>
                    <option value="once_ever">Once ever</option>
                    <option value="per_cycle">Per event</option>
                    <option value="phase">Tied to one phase name</option>
                  </select>
                  <input type="text" name="phaseNameHint" placeholder="phase name (only if scope is 'phase'), e.g. Build" className={INPUT} />
                  <CheckField label="feeds capacity signal (phase-scoped only)" name="feedsCapacitySignal" />
                  <CheckField label="also ask during a new member's first-week onboarding" name="onboardingSurface" />
                  <CheckField label="allow &ldquo;I don&rsquo;t know yet&rdquo;" name="allowDeferral" defaultChecked />
                  <CheckField label="allow &ldquo;prefer not to say&rdquo;" name="allowPreferNotToSay" />
                  <p className="text-[12px] text-[var(--text-muted)]">
                    You can turn a question into a community indicator after adding it &mdash; tick
                    &ldquo;show the answers on the Community page&rdquo; on its row. Only a once-ever
                    question with a countable answer type can be one.
                  </p>
                  <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                    needed by (optional — only applies if required and deferrable)
                    <input type="date" name="requiredBy" className={`${INPUT} py-1`} />
                  </label>
                  <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                    Add
                  </button>
                </form>
              </details>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Trait axes</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Bipolar scales (e.g. &ldquo;wants direction&rdquo; ↔ &ldquo;wants independence&rdquo;) set on
                both members (their own preference) and tasks (a proposer&rsquo;s suggestion, reviewed at
                activation) — compared by proximity to rank onboarding&rsquo;s task suggestions. Distinct from
                tags: never shown as a number, never a hard requirement, just a surfacing signal. &ldquo;Surface
                during onboarding&rdquo; keeps the first-session screen short — an axis left unchecked is
                still settable any time at <code className="font-mono">/profile</code>.
              </p>
              {traitAxes.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {traitAxes.map((a) => (
                  <div
                    key={a.id}
                    className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
                    style={{ opacity: a.archivedAt ? 0.6 : 1 }}
                  >
                    <form action={updateTraitAxisAction} className="flex flex-col gap-2">
                      <input type="hidden" name="axisId" value={a.id} />
                      <span className="text-[12px] text-[var(--text-muted)]">
                        key: <code className="font-mono">{a.key}</code> — not editable here.
                      </span>
                      <div className="flex flex-wrap gap-2">
                        <input type="text" name="lowLabel" defaultValue={a.lowLabel} placeholder="low label" className={`${INPUT} flex-1`} />
                        <input type="text" name="highLabel" defaultValue={a.highLabel} placeholder="high label" className={`${INPUT} flex-1`} />
                      </div>
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>
                          5 option labels, &ldquo;|&rdquo;-separated (optional — overrides the low/high slider with labeled choices)
                        </span>
                        <input
                          type="text"
                          name="optionLabels"
                          defaultValue={a.optionLabels.join(" | ")}
                          className={INPUT}
                        />
                      </label>
                      <div className="flex flex-wrap items-center gap-3">
                        <CheckField label="surface during onboarding" name="askAtOnboarding" defaultChecked={a.askAtOnboarding} />
                        <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                          Sort order
                          <input type="number" name="sortOrder" defaultValue={a.sortOrder} className={`${INPUT} w-20`} />
                        </label>
                        <button type="submit" className={BUTTON_PRIMARY}>
                          Save
                        </button>
                      </div>
                    </form>
                    <form action={a.archivedAt ? unarchiveTraitAxisAction : archiveTraitAxisAction} className="mt-2">
                      <input type="hidden" name="axisId" value={a.id} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        {a.archivedAt ? "Unarchive" : "Archive"}
                      </button>
                    </form>
                  </div>
                ))}
              </div>

              <form action={createTraitAxisAction} className="mt-3 flex max-w-[600px] flex-col gap-2">
                <input type="text" name="key" placeholder="key, e.g. autonomy" required className={INPUT} />
                <div className="flex flex-wrap gap-2">
                  <input type="text" name="lowLabel" placeholder="low label" required className={`${INPUT} flex-1`} />
                  <input type="text" name="highLabel" placeholder="high label" required className={`${INPUT} flex-1`} />
                </div>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>5 option labels, &ldquo;|&rdquo;-separated (optional)</span>
                  <input type="text" name="optionLabels" className={INPUT} />
                </label>
                <CheckField label="surface during onboarding" name="askAtOnboarding" />
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Add trait axis
                </button>
              </form>
            </section>

            <section>
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Sensitive data access</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Purpose-bound, not role-bound: pick which task, tier, or permission grant unlocks each field for{" "}
                <em>other</em> members&rsquo; values on <code>/sensitive-data</code>. A member can always see and
                edit their own values regardless of these rules. Only takes effect once &ldquo;Sensitive
                data&rdquo; is checked under the Modules tab.
              </p>
              {sensitiveFieldRules.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No rules yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {sensitiveFieldRules.map((r) => (
                  <div key={r.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <span className="flex-1 text-[13px] text-[var(--text)]">
                      {r.questionId
                        ? `“${questionLabelById.get(r.questionId) ?? "an archived question"}” — unlocked by `
                        : `${SENSITIVE_FIELD_LABELS[r.fieldKey!]} — unlocked by `}
                      {""}
                      {r.unlockedByTaskId
                        ? `holding "${ruleTaskNameById.get(r.unlockedByTaskId) ?? "—"}"`
                        : r.unlockedByTierId
                          ? `Tier "${tierNameById.get(r.unlockedByTierId) ?? "—"}"`
                          : `any holder of a "${PERMISSION_MODULE_LABELS[r.unlockedByGrantModuleKey!]}" grant`}
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
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>What does this rule unlock?</span>
                  <select name="fieldKey" defaultValue={SENSITIVE_FIELD_KEYS[0]} className={INPUT}>
                    {SENSITIVE_FIELD_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {SENSITIVE_FIELD_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Or a profile question ID (pick exactly one target)</span>
                  <select name="questionId" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {sensitiveQuestionOptions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </label>
                {sensitiveQuestionOptions.length === 0 && (
                  <p className="text-[12px] text-[var(--text-muted)]">
                    No questions are marked sensitive yet, so there&rsquo;s nothing here to unlock. Mark one
                    sensitive under Profile questions first — its <em>sensitive</em> box stays disabled until it
                    has a rule, which is what makes the flag mean something.
                  </p>
                )}
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
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Or unlock via a permission grant</span>
                  <select name="unlockedByGrantModuleKey" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {PERMISSION_MODULE_KEYS.map((k) => (
                      <option key={k} value={k}>
                        {PERMISSION_MODULE_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </label>
                <TextField label="Or unlock via a Task ID (pick exactly one of Tier/Grant/Task)" name="unlockedByTaskId" placeholder="paste the task's ID from its /tasks/… URL" />
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
                      {p.gatesQuestionId && (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          {" "}
                          — gates &ldquo;{questionLabelById.get(p.gatesQuestionId) ?? "an archived question"}&rdquo;
                        </span>
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
                  <span className={LABEL}>Or gates a sensitive profile question (optional)</span>
                  <select name="gatesQuestionId" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {sensitiveQuestionOptions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label}
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
              lean on, starting with post-event feedback. Editing an existing form&rsquo;s fields never touches its
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
                        ...toEditableFieldShape({
                          label: field.label,
                          responseType: field.responseType,
                          options: field.options,
                          required: field.required,
                          multiline: field.multiline,
                          validation: field.validation,
                          allowOther: field.allowOther,
                          min: field.min,
                          max: field.max,
                          step: field.step,
                          isNameField: field.isNameField,
                          isEmailField: field.isEmailField,
                          mapsToProfileQuestionId: field.mapsToProfileQuestionId,
                        }),
                      }))}
                      profileQuestionOptions={onceEverProfileQuestionOptions}
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
                <FormBuilder
                  action={createFormAction}
                  mode="create"
                  initialTitle=""
                  initialDescription=""
                  initialAllowAnonymous={false}
                  initialFields={[]}
                  profileQuestionOptions={onceEverProfileQuestionOptions}
                  submitLabel="Create form"
                />
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

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

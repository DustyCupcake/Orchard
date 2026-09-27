import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { phase, task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, listCycleTypes, listPendingBranches, listTiers, requireAdmins } from "@/lib/settings";
import Tabs from "@/components/ui/Tabs";
import SelectField from "@/components/ui/SelectField";
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
import { resolveViewScopeCycleForMember } from "@/lib/cycles/view-scope";
import { listProfileQuestions } from "@/lib/profile-questions";

// The row shape this screen already has in hand, so a card's prop type can
// never drift from the query that fills it — the same argument as deriving
// an editor's initial value from the same source.
type ProfileQuestion = Awaited<ReturnType<typeof listProfileQuestions>>[number];

import {
  INDICATOR_FAMILY_LABELS,
  canPublishAsIndicator,
  indicatorBlocker,
  indicatorFamilyFor,
} from "@/lib/profile-questions/indicators";
import { listTraitAxes } from "@/lib/trait-axes";
import { listTaskPacks } from "@/lib/task-packs";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
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
import StarterQuestionPicker from "./StarterQuestionPicker";

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

// Shown to Admins only, not merely read-only for everyone else. The Members
// tab is a roster-paste tool: its content is other people's names and email
// addresses, and "should we import this list" is an action rather than a
// setting the community deliberates about. Every other tab is configuration
// a member has a stake in reading.
const ADMIN_ONLY_TABS: readonly TabKey[] = ["members"];

function TabBar({ active, tabs }: { active: TabKey; tabs: readonly { key: TabKey; label: string }[] }) {
  return <Tabs tabs={tabs} active={active} hrefFor={(key) => `/settings?tab=${key}`} />;
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
/**
 * One question, collapsed.
 *
 * A full editable form per question is the right editing surface and the
 * wrong listing surface: with twenty questions the tab was twenty forms,
 * each carrying a field editor, a live preview, seven checkboxes and two
 * submit buttons, and the only way to find the one question you wanted was
 * to read past all of them. So the row states the facts — what it's
 * called, how it's scoped, whether it's restricted, published, required —
 * and the form sits behind a disclosure for the times you actually came to
 * change something.
 *
 * `sensitive` is shown rather than offered. It is fixed at creation
 * because un-restricting a question later would make every answer so far
 * readable by the whole Community, so the honest thing on a card is to say
 * which side of that line the question is on and why it can't move.
 */
function QuestionCard({ question: q }: { question: ProfileQuestion }) {
  return (
    <details className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <summary
        className="flex cursor-pointer flex-wrap items-center gap-2"
        style={{ opacity: q.archivedAt ? 0.6 : 1 }}
      >
        <span className="text-[14px] font-medium text-[var(--text)]">{q.label}</span>
        {q.sensitive && <Fact>restricted</Fact>}
        {q.emergencyAccess && <Fact>emergency access</Fact>}
        {q.publishedAsIndicator && <Fact>published</Fact>}
        {q.required && <Fact>required</Fact>}
        {q.archivedAt && <Fact>archived</Fact>}
        <span className="text-[12px] text-[var(--text-muted)]">
          {q.scope === "once_ever"
            ? "asked once"
            : q.scope === "per_cycle"
              ? "asked per event"
              : `asked in the ${q.phaseNameHint} phase`}
        </span>
        <span className="ml-auto text-[12px] text-[var(--accent-1)]">Edit</span>
      </summary>

      {/* Inside the disclosure rather than a separate one: a <summary> and a
          form cannot share a parent, and a form nested in a *second*
          details would mean two disclosures stacked on one card. */}
      <form action={updateProfileQuestionAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="questionId" value={q.id} />
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
            <CheckField
              label="feeds capacity signal"
              name="feedsCapacitySignal"
              defaultChecked={q.feedsCapacitySignal}
            />
          )}
          <CheckField
            label="also ask during a new member's first-week onboarding"
            name="onboardingSurface"
            defaultChecked={q.surfaces.includes("onboarding")}
          />
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
          <IndicatorToggle
            question={q}
            canPublish={canPublishAsIndicator(q)}
            blocker={indicatorBlocker(q)}
          />
        </div>
        {q.sensitive && <EmergencyToggle question={q} />}
        {q.required && q.allowDeferral && (
          <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
            needed by
            <input type="date" name="requiredBy" defaultValue={q.requiredBy ?? ""} className={`${INPUT} py-1`} />
          </label>
        )}
        {q.requiredBy && (
          <p className="text-[12px] text-[var(--text-muted)]">
            After {new Date(q.requiredBy).toLocaleDateString()}, anyone who answered
            &ldquo;I don&rsquo;t know yet&rdquo; counts as still owing an answer.
          </p>
        )}
        <div>
          <button type="submit" className={BUTTON_PRIMARY}>
            Save
          </button>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          {q.sensitive
            ? "This one is restricted, and that can't be changed here — un-restricting it would make every answer so far readable by the whole Community. If it was filed wrongly, archive it and add it again with an audience."
            : "This one is readable by the whole Community, and that can't be changed here either. To restrict it, archive it and add it again with an audience."}
        </p>
      </form>

      <form action={q.archivedAt ? unarchiveProfileQuestionAction : archiveProfileQuestionAction} className="mt-2">
        <input type="hidden" name="questionId" value={q.id} />
        <button type="submit" className="text-[12px] text-[var(--text-muted)] hover:underline">
          {q.archivedAt ? "Unarchive this question" : "Archive this question"}
        </button>
      </form>
    </details>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-[var(--radius-md)] bg-[var(--surface-sunken)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
      {children}
    </span>
  );
}

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

/** Emergency access, on a question that already exists.
 *
 * The counterpart to `sensitive`, and the reason it isn't simply another
 * fixed attribute: emergency access *overrides* a restriction, and the
 * restriction is now chosen once and for all. Turning it on later is a
 * widening — a standing promise that whoever activates emergency mode on
 * this member's page can read this fact — so it is a decision an Admin
 * makes deliberately about questions they already know exist, and they can
 * take it back without disclosing anything.
 */
function EmergencyToggle({
  question,
}: {
  question: { sensitive: boolean; emergencyAccess: boolean; publishedAsIndicator: boolean };
}) {
  // Only blocks turning it ON. A question somehow already marked without
  // being restricted must still be tickable-off, or the state would be
  // unescapable except by deleting the question.
  const blocked = (question.emergencyAccess && question.publishedAsIndicator) || (!question.sensitive && !question.emergencyAccess);
  return (
    <div className="flex flex-col gap-1">
      <label
        className={`flex items-center gap-2 text-[13px] ${blocked ? "text-[var(--text-muted)]" : "text-[var(--text)]"}`}
      >
        <input
          type="checkbox"
          name="emergencyAccess"
          defaultChecked={question.emergencyAccess}
          disabled={blocked}
        />
        readable through Emergency access
        <span className="text-[var(--text-muted)]">
          &mdash; whoever turns on emergency mode, and they&rsquo;re notified
        </span>
      </label>
      {question.emergencyAccess && question.publishedAsIndicator ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Not available while this question is published on the Community page. An indicator is
          already readable by the whole Community, so there&rsquo;s nothing for an emergency
          override to reach &mdash; and this isn&rsquo;t the kind of question anyone needs in an
          emergency. Unpublish it first, or leave this off.
        </p>
      ) : !question.sensitive && !question.emergencyAccess ? (
        <p className="text-[12px] text-[var(--text-muted)]">
          Not available on a public question. Emergency access overrides a restriction, so it
          needs one to override &mdash; and on a question everyone can already read there&rsquo;s
          nothing to reveal, which would put a read of public data in the log as though it had
          been protected.
        </p>
      ) : null}
    </div>
  );
}

// Every question an access rule or a consent purpose is allowed to name.
//
// Not filtered to the restricted ones. A rule *widens* an audience, and
// widening is the operation that needs consent from whoever already
// answered — so this list is how a Community adds a group after the
// fact. The rule reaches only answers given from the moment it exists,
// plus any earlier answer whose owner has since agreed to extend sharing.
//
// A rule against a public question is therefore a no-op rather than a
// staged one: the question is readable by everyone regardless, and the
// flag is fixed at creation, so no future edit makes it bite. Offering
// public questions here would be offering a field that cannot do
// anything, which is worse than not offering it.
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

  // A member can read these settings; only an Admin can change them. The gate
  // moved from the read to the write, and the write half is what was always
  // load-bearing: every mutating action in actions.ts calls requireAdmins
  // itself, so rendering a form to a non-Admin grants nothing.
  //
  // spec.md is why the read is open. A settings change is a collective
  // decision — assembly results are "always advisory, never auto-applied"
  // (:1257), a foundational-settings change is expected to reach quorum
  // against the whole roster "before Admins act on it" (:430), and data
  // decisions belong to the community's collective process "not to whoever
  // currently holds the sysadmin task" (:1267). None of that is reachable
  // while the settings themselves are unreadable, since the body weighing a
  // change has to be able to read what it is weighing.
  const visibleTabs = authorized ? TABS : TABS.filter((t) => !ADMIN_ONLY_TABS.includes(t.key));
  const visibleTabKeys = visibleTabs.map((t) => t.key) as readonly string[];
  // A deep link to an admin-only tab falls back to General rather than
  // rendering an empty body, so a shared /settings?tab=members link degrades
  // to something readable instead of looking broken.
  const activeTab: TabKey = visibleTabKeys.includes(tabRaw ?? "") ? (tabRaw as TabKey) : "general";

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
    currentPhaseNames,
  ] = await Promise.all([
    getCommunity(viewing),
    listBranches(viewing),
    listTiers(viewing),
    listCycleTypes(viewing),
    // Every one of these used to be `authorized ? … : Promise.resolve([])`,
    // which was free while a non-Admin never saw past the refusal banner and
    // this data was pure waste for them. It isn't free now: a member reading
    // the Branches tab needs the branches, and the Modules and Profile &
    // Privacy tabs need their forms, questions and consent purposes to show
    // anything true. Gating the loaders while showing the tabs would render a
    // settings page that silently omits most of the settings.
    listCycles(viewing),
    listProfileQuestions(viewing, { includeArchived: true }),
    listTraitAxes(viewing, { includeArchived: true }),
    listSensitiveFieldAccessRules(viewing),
    listForms(viewing, { includeArchived: true }),
    listConsentPurposes(viewing),
    // The one exception, and it is not a privilege question: listPendingBranches
    // calls requireAdmins itself, so calling it for a non-Admin throws rather
    // than returning []. It stays an Admin's work queue — a list of who is
    // waiting to be confirmed into a branch is a list of member requests, not
    // branch configuration — and the tab's pending section simply renders
    // empty for a member.
    authorized ? listPendingBranches(viewing) : Promise.resolve([]),
    listTaskPacks(viewing),
    listTasks(viewing),
    // The phase names of the cycle this member is currently looking at,
    // so the event sub-section can say which phase questions are actually
    // being asked this time round rather than listing all of them flat.
    // Off-URL on purpose — /settings has no cycle segment, so this reads
    // the same persisted "what am I looking at" that the Contribution
    // average and Messages' arrival window read. Coerce to a Set here so
    // the JSX doesn't have to null-guard a possibly-ambiguous resolution.
    resolveViewScopeCycleForMember(viewing).then(async (r) => {
      if (r.kind !== "resolved") return [] as string[];
      const rows = await db.select({ name: phase.name }).from(phase).where(eq(phase.cycleId, r.cycle.id));
      return rows.map((p) => p.name.toLowerCase());
    }),
  ]);
  const currentPhases = new Set(currentPhaseNames);
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

  // Which sensitive values are unlocked by a *grant* to each module. Opening
  // a module does not unlock them (D9 — deliberately deferred), so this is
  // shown as information about an existing, separate setting rather than as a
  // warning about the checkbox: the coupling is real and invisible, and the
  // person deciding should be able to see it exists.
  // Which sensitive answers each permission grant unlocks. Named rather
  // than summarised: "a profile question" was accurate once and stopped
  // being useful the moment a community had more than one — the reader of
  // this panel is deciding whether opening a module exposes anything, and
  // "does it expose a question?" is not an answer they can act on.
  const sensitiveFieldsByModule = new Map<PermissionModuleKey, string[]>();
  for (const rule of sensitiveFieldRules) {
    if (!rule.unlockedByGrantModuleKey) continue;
    const label = questionLabelById.get(rule.questionId);
    const existing = sensitiveFieldsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
    existing.push(label ? `the “${label}” answer` : "a question that no longer exists");
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

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Community settings</h1>
      <p className="mt-1 text-[13px] text-[var(--text-muted)]">
        {authorized
          ? communityRow.adminsEverClaimed
            ? "Editable by whoever currently holds the Admins task."
            : "No Admins task has ever been claimed in this Community yet, so any member can change these — including granting Admin access to a community_endorsed task below to start gating this screen for real."
          : "Everyone can read these; only whoever currently holds the Admins task can change them. An Assembly about a foundational setting needs the whole roster weighing in, which needs the setting to be readable in the first place."}
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      {showFoundersPrompt && (await getFoundersAssemblyPromptState(viewing.communityId)) === "show" && (
        <div className="mt-4">
          <FoundersAssemblyPrompt />
        </div>
      )}

      <div className="mt-6">
        <TabBar active={activeTab} tabs={visibleTabs} />
      </div>

      {/*
       * The read-only mechanism, and the reason it is a fieldset rather than a
       * `readOnly` prop threaded through every control: HTML disables every
       * descendant form control of a disabled fieldset, so this covers the
       * inputs, the submit buttons, the per-row ActionMenu triggers (which
       * therefore never open), and the `type="button"` handlers inside the
       * three client components on this screen — none of which is a form
       * control, so none of them would be reachable any other way.
       *
       * The opacity is not decoration. Nothing in this codebase's Tailwind
       * setup dims a disabled control on its own, so without it a member
       * would see a normally-coloured form whose controls silently do
       * nothing — looking editable while being inert is worse than an honest
       * refusal.
       */}
      <fieldset disabled={!authorized} className="mt-6 min-w-0 disabled:opacity-60">
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
                <SelectField name="defaultDateDisplayMode" defaultValue={communityRow.defaultDateDisplayMode} className={INPUT}>
                  <option value="exact">Exact calendar dates</option>
                  <option value="period">Period name + weekday when available</option>
                </SelectField>
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
                <SelectField name="cycleInitiationTierId" defaultValue={communityRow.cycleInitiationTierId ?? ""} className={INPUT}>
                  <option value="">Any member</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} members only
                    </option>
                  ))}
                </SelectField>
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
                than with the profile questions. Only questions the whole
                Community can already read are ever published, so a
                per-event breakdown is the same public data grouped by who
                is coming — which is why the headcount floor that used to
                sit here went in 0081. */}
            <CheckField
              label="Break community indicators out for one event&rsquo;s attendees"
              name="cycleIndicatorsEnabled"
              defaultChecked={communityRow.cycleIndicatorsEnabled}
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
                <SelectField name="postCycleFeedbackFormId" defaultValue={communityRow.postCycleFeedbackFormId ?? ""} className={INPUT}>
                  <option value="">— none configured —</option>
                  {forms.filter((f) => !f.archivedAt).map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title}
                    </option>
                  ))}
                </SelectField>
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
              <SelectField name="recruitmentApplicationFormId" defaultValue={communityRow.recruitmentApplicationFormId ?? ""} className={INPUT}>
                <option value="">— none configured —</option>
                {forms.filter((f) => !f.archivedAt).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.title}
                  </option>
                ))}
              </SelectField>
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
                          <SelectField name={name} defaultValue={value === null ? "inherit" : value ? "on" : "off"} className={INPUT}>
                            <option value="inherit">Inherit</option>
                            <option value="on">On</option>
                            <option value="off">Off</option>
                          </SelectField>
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
                      <SelectField name="defaultSourceCycleId" defaultValue={ct.defaultSourceCycleId ?? ""} className={INPUT}>
                        <option value="">No suggested starting event</option>
                        {cyclesForPicker.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </SelectField>
                      <SelectField name="defaultPackId" defaultValue={ct.defaultPackId ?? ""} className={INPUT}>
                        <option value="">No suggested Task Pack</option>
                        {taskPacks.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </SelectField>
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
                            <SelectField name="cycleTypeId" defaultValue={config.cycleTypeId ?? ""} className={INPUT}>
                              <option value="">Pick an event type</option>
                              {cycleTypes.map((ct) => (
                                <option key={ct.id} value={ct.id}>
                                  {ct.name}
                                </option>
                              ))}
                            </SelectField>
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
                /* The starter set goes through a review step rather than a
                   single button. The one-button version was defensible
                   only until you counted what it left behind: every
                   question it created had to be archived again by hand,
                   and since a community with no questions has no members,
                   none of them could have been answered — so the archive
                   pass was pure friction at the one moment the set was
                   cheapest to decline. It is also the only place an
                   audience can be picked, because `sensitive` is refused
                   until a rule names the question and a rule needs the
                   question to exist; offering it here is what makes a
                   restricted question reachable at all. */
                <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-4">
                  <p className="text-[13px] text-[var(--text)]">
                    This Community has no questions yet.
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    Here is a suggested set — who someone is, what they can do, and a
                    few answers the whole Community must not read. Go through it first:
                    untick anything you don&rsquo;t want, retitle anything you&rsquo;d
                    phrase differently, and pick who may read each restricted answer. Every
                    question you keep stays editable afterwards; nothing here is a
                    commitment.
                  </p>
                  <details className="mt-3" open>
                    <summary className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-medium text-[var(--accent-1)] hover:underline">
                      Review the starter set
                    </summary>
                    <form action={seedDefaultProfileQuestionsAction} className="mt-3 flex flex-col gap-3">
                      <StarterQuestionPicker
                        tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
                        permissionModuleKeys={[...PERMISSION_MODULE_KEYS]}
                        permissionModuleLabels={PERMISSION_MODULE_LABELS}
                      />
                      <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                        Add the selected questions
                      </button>
                    </form>
                  </details>
                </div>
              )}
              {/* The general mechanics are long and true and nobody needs
                  them on every visit, so they live behind a disclosure.
                  Previously they were two paragraphs of wall text above
                  the questions, which is what made this section feel like
                  a wall rather than a list. The per-category paragraphs
                  below carry only what is specific to that category. */}
              <details className="mt-1">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-[var(--accent-1)] hover:underline">
                  How answering, required questions and &ldquo;prefer not to say&rdquo; work
                </summary>
                <div className="mt-2 flex max-w-[720px] flex-col gap-2">
                  <p className="text-[13px] text-[var(--text-muted)]">
                    Everyone&rsquo;s outstanding questions are answered at{" "}
                    <a href="/questions" className="text-[var(--accent-1)] hover:underline">
                      /questions
                    </a>
                    , which is also where a member lands after saying they&rsquo;re coming to an
                    event from their Dashboard or Community dashboard.
                  </p>
                  <p className="text-[13px] text-[var(--text-muted)]">
                    Marking one <strong>required</strong> means anyone who hasn&rsquo;t answered it
                    yet gets a count on their Dashboard until they do &mdash; so reserve it for
                    what you genuinely can&rsquo;t run the event without. &ldquo;I don&rsquo;t know
                    yet&rdquo; counts as an answer, but add a <strong>needed by</strong> date if you
                    need a real answer by a real time: past that date the deferral stops counting
                    and the question comes back. Leave it blank for a standing fact like an
                    emergency contact, where a deferral should really be permanent.
                  </p>
                  <p className="text-[13px] text-[var(--text-muted)]">
                    The two &ldquo;not answering&rdquo; buttons are deliberately different.{" "}
                    <strong>Allow &ldquo;I don&rsquo;t know yet&rdquo;</strong> is on by default and
                    means &ldquo;ask me again later&rdquo;.{" "}
                    <strong>Allow &ldquo;prefer not to say&rdquo;</strong> is off by default and
                    means <em>this question is optional for everyone</em> &mdash; turning it on makes
                    the question stop being required in practice, because picking it is a permanent,
                    unchased answer. Turn it on for questions about someone&rsquo;s own identity or
                    circumstances, and leave it off for questions the community genuinely needs a
                    real answer to from everyone.
                  </p>
                  <p className="text-[13px] text-[var(--text-muted)]">
                    A question per event is asked again each time, so it lives in the event section
                    below rather than here, and it is answered at{" "}
                    <a href="/questions" className="text-[var(--accent-1)] hover:underline">
                      /questions
                    </a>{" "}
                    for whichever event you&rsquo;re looking at. A phase-scoped question with
                    &ldquo;feeds capacity signal&rdquo; on powers the Coordination view&rsquo;s
                    fitted-ask flags and non-response list for whichever event phase matches its
                    name.
                  </p>
                </div>
              </details>

              {profileQuestions.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}

              {/* Two sections, because a question is one of two things and
                  the distinction is a consent boundary rather than a
                  filing preference. Grouped by where the question is asked
                  rather than by what it's about: the standing questions in
                  one place, the per-event ones in another, under whichever
                  category they belong to. A "demographic" group is
                  deliberately absent — publication turned out to be a
                  capability of public questions rather than a third kind
                  of question, because an aggregate of answers everyone can
                  already read individually discloses nothing the
                  underlying data doesn't already say. */}
              {(["public", "restricted"] as const).map((category) => {
                const blurb =
                  category === "public"
                    ? "Readable by the whole Community. A once-ever question of these can also be published as a collective figure on the Community page — a proportion or a distribution, never anybody's individual answer — as long as it isn't free text and offers “prefer not to say”."
                    : "Not readable by the whole Community. Whoever you name as the audience can read it, and so can the person who answered. This is chosen when the question is created and can't be changed afterwards, because un-restricting it later would make every answer so far readable by everyone.";
                const inCategory = profileQuestions.filter((q) => q.sensitive === (category === "restricted"));
                const standing = inCategory.filter((q) => q.scope === "once_ever");
                const eventScoped = inCategory.filter((q) => q.scope !== "once_ever");
                // A phase question is asked during a phase of the current
                // event, so if the current event has no phase of that name
                // it is a question nobody will be asked this time round.
                // Listing it flat alongside the ones that are live is how
                // a question on "Build" ends up looking broken rather
                // than dormant, so it goes under "for other events".
                const live = eventScoped.filter(
                  (q) => q.scope !== "phase" || currentPhases.has((q.phaseNameHint ?? "").toLowerCase()),
                );
                const hidden = eventScoped.length - live.length;

                return (
                  <section key={category} className="mt-6">
                    <h3 className="text-[15px] font-semibold text-[var(--text)]">
                      {category === "public" ? "Public" : "Restricted"}
                      <span className="ml-2 text-[12px] font-normal text-[var(--text-muted)]">
                        {inCategory.length}
                      </span>
                    </h3>
                    <p className="mt-1 max-w-[720px] text-[13px] text-[var(--text-muted)]">{blurb}</p>

                    {inCategory.length === 0 && (
                      <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>
                    )}

                    <div className="mt-2 flex flex-col gap-1.5">
                      {standing.map((q) => (
                        <QuestionCard key={q.id} question={q} />
                      ))}
                    </div>

                    {eventScoped.length > 0 && (
                      <div className="mt-4">
                        <p className="text-[12px] font-medium text-[var(--text-muted)]">
                          Asked again for each event
                        </p>
                        <div className="mt-1.5 flex flex-col gap-1.5">
                          {live.map((q) => (
                            <QuestionCard key={q.id} question={q} />
                          ))}
                        </div>
                        {hidden > 0 && (
                          <details className="mt-1.5">
                            <summary className="inline-flex cursor-pointer items-center gap-1 text-[12px] text-[var(--accent-1)] hover:underline">
                              {hidden} more for other events
                            </summary>
                            <div className="mt-1.5 flex flex-col gap-1.5">
                              {eventScoped
                                .filter((q) => !live.includes(q))
                                .map((q) => (
                                  <QuestionCard key={q.id} question={q} />
                                ))}
                            </div>
                          </details>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}

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
                  {/* Restricted, with its audience, in the same form. It
                      used to be a checkbox here that was disabled until a
                      rule existed under Access rules below, which meant
                      creating a restricted question was three visits to
                      two sections and the discoverable path was: add the
                      question, remember which row it was, add a rule
                      naming it, come back, tick the box. All of that is
                      one field group now, and `sensitive` can't be
                      changed afterwards anyway, so this is the only
                      moment it can be set. */}
                  <CheckField
                    label="restricted — only the audience below can read it"
                    name="sensitive"
                  />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Who may read it (if restricted)</span>
                    <select name="unlockedByGrantModuleKey" defaultValue="" className={INPUT}>
                      <option value="">— pick an audience —</option>
                      {PERMISSION_MODULE_KEYS.map((m) => (
                        <option key={m} value={m}>
                          anyone holding a {PERMISSION_MODULE_LABELS[m]} grant
                        </option>
                      ))}
                    </select>
                    <select name="unlockedByTierId" defaultValue="" className={INPUT}>
                      <option value="">— or anyone in a Tier —</option>
                      {tiers.map((t) => (
                        <option key={t.id} value={t.id}>
                          anyone in Tier “{t.name}”
                        </option>
                      ))}
                    </select>
                    <select name="unlockedByTaskId" defaultValue="" className={INPUT}>
                      <option value="">— or anyone holding one Task —</option>
                      {communityTasksRaw.map((t) => (
                        <option key={t.id} value={t.id}>
                          anyone holding “{t.title}”
                        </option>
                      ))}
                    </select>
                  </label>
                  <CheckField
                    label="reachable through Emergency access"
                    name="emergencyAccess"
                  />
                  <p className="text-[12px] text-[var(--text-muted)]">
                    Restricted or not can&rsquo;t be changed once the question exists, so it&rsquo;s
                    picked here. The audience can be widened later under Access rules
                    &mdash; which only reaches answers given from then on, unless each
                    person who already answered says yes to it.
                  </p>
                  <p className="text-[12px] text-[var(--text-muted)]">
                    You can turn a question into a community indicator after adding it &mdash; tick
                    &ldquo;show the answers on the Community page&rdquo; on its row. Only a public,
                    once-ever question with a countable answer type can be one.
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
              <h2 className="text-[18px] font-semibold text-[var(--text)]">Access rules</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                A rule says who, besides the person who answered, may read one restricted question:
                a named Tier, a holder of one Task, or anyone holding a permission grant. A question
                can carry several rules, and anyone who satisfies any one of them can read it. A
                question&rsquo;s first audience is chosen when it&rsquo;s created, so this is
                for <em>adding</em> a group afterwards.
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Adding one is a <em>widening</em>, and widening asks the people already affected. So
                a new rule reaches only answers given from the moment it exists — everyone who
                already answered is told about it and asked whether to extend sharing, and until each
                of them says yes their answer stays with the audience that already had it. That&rsquo;s
                the difference between widening an audience and quietly taking it.
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Deleting the last rule on a restricted question leaves it readable by its owner and
                nobody else, which is the safe direction to fail in. It still reaches whoever
                activates Emergency access on someone&rsquo;s page.
              </p>
              {sensitiveFieldRules.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No rules yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {sensitiveFieldRules.map((r) => {
                  /* The route is read through a fallback rather than
                     asserted. The write side refuses a rule with two
                     routes, but the database is editable by hand, and a
                     non-null assertion here rendered the string
                     "undefined" into this list — which reads as a
                     rendering fault rather than the broken row it
                     actually is. Naming the fault is the point. */
                  const target = `“${questionLabelById.get(r.questionId) ?? "a question that has been archived or removed"}”`;
                  const route = r.unlockedByTaskId
                    ? `anyone holding "${ruleTaskNameById.get(r.unlockedByTaskId) ?? "a task not in this Community"}"`
                    : r.unlockedByTierId
                      ? `anyone in Tier "${tierNameById.get(r.unlockedByTierId) ?? "—"}"`
                      : r.unlockedByGrantModuleKey
                        ? `anyone holding a ${PERMISSION_MODULE_LABELS[r.unlockedByGrantModuleKey]} grant`
                        : "nobody — this rule has no unlock route";
                  return (
                    <div key={r.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                      <span className="flex-1 text-[13px] text-[var(--text)]">
                        {target} &mdash; readable by {route}
                      </span>
                      <form action={deleteSensitiveFieldAccessRuleAction}>
                        <input type="hidden" name="ruleId" value={r.id} />
                        <button type="submit" className={BUTTON_SECONDARY}>
                          Delete
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>

              <form action={createSensitiveFieldAccessRuleAction} className="mt-3 flex max-w-[420px] flex-col gap-2">
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Which question?</span>
                  {/* Restricted questions only. A rule's whole job is to
                      widen an audience, and only a restricted question has
                      one to widen — the flag is fixed at creation and a
                      public question stays public, so a rule naming one
                      could never read anything the Community doesn't
                      already read. */}
                  <select name="questionId" defaultValue="" className={INPUT}>
                    <option value="">— pick one —</option>
                    {profileQuestions.filter((q) => !q.archivedAt && q.sensitive).map((q) => (
                      <option key={q.id} value={q.id}>{q.label}</option>
                    ))}
                  </select>
                </label>
                {profileQuestions.filter((q) => !q.archivedAt && q.sensitive).length === 0 && (
                  <p className="text-[12px] text-[var(--text-muted)]">
                    No restricted questions yet, so there&rsquo;s no audience to widen. Add one
                    with a restricted tick under Profile questions first &mdash; the audience
                    is chosen there, and this form is for adding a group afterwards.
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
                no row here at all. Optionally pin a purpose to one sensitive question: once set, a
                member cannot answer that question at all without agreeing, and their answer stops
                being visible to anyone else the moment they withdraw.
              </p>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                This is a separate decision from an access rule, and the two answer different
                questions. A rule says <em>who in this Community may read it</em> — the kitchen team,
                a wellbeing Tier. A purpose says <em>whether the member agreed to it being read at
                all</em>. A question can be restricted to the kitchen while every member still has
                to tick a box before the kitchen sees anything, and withdrawing that box takes their
                answer out of the kitchen&rsquo;s hands immediately.
              </p>
              {consentPurposes.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">No purposes yet.</p>}
              <div className="mt-3 flex flex-col gap-2">
                {consentPurposes.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                    <div className="flex-1">
                      <span className="text-[13px] font-medium text-[var(--text)]">{p.label}</span>{" "}
                      <code className="text-[12px] text-[var(--text-muted)]">{p.key}</code>
                      {p.gatesQuestionId && (
                        <span className="text-[12px] text-[var(--text-muted)]">
                          {" "}
                          &mdash; gates &ldquo;{questionLabelById.get(p.gatesQuestionId) ?? "a question that has been archived or removed"}&rdquo;
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

              <form action={createConsentPurposeAction} className="mt-3 flex max-w-[420px] flex flex-col gap-2">
                <input type="text" name="key" placeholder="key (e.g. kitchen_dietary)" required className={INPUT} />
                <input type="text" name="label" placeholder="label" required className={INPUT} />
                <textarea name="noticeText" placeholder="notice text shown to the member" required rows={2} className={INPUT} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Gates a profile question (optional)</span>
                  <select name="gatesQuestionId" defaultValue="" className={INPUT}>
                    <option value="">— none —</option>
                    {sensitiveQuestionOptions.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.label}
                      </option>
                    ))}
                  </select>
                </label>
                <CheckField label="requires explicit consent (required when gating a question)" name="requiresExplicit" />
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
      </fieldset>
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

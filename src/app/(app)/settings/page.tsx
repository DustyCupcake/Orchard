import { eq, inArray } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { phase, task } from "@/db/schema";
import { settingsChangeEntityEnum } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, listCycleTypes, listPendingBranches, listTiers, requireAdmins } from "@/lib/settings";
import Tabs from "@/components/ui/Tabs";
import {
  listGrantsWithTaskInfo,
  listHoldersByTaskId,
  listOpenModuleKeys,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { listTasks } from "@/lib/tasks";
import { listCycles } from "@/lib/cycles";
import { resolveViewScopeCycleForMember } from "@/lib/cycles/view-scope";
import { listProfileQuestions } from "@/lib/profile-questions";
import { listTraitAxes } from "@/lib/trait-axes";
import { listTaskPacks } from "@/lib/task-packs";
import { listSensitiveFieldAccessRules } from "@/lib/sensitive-data";
import { listForms } from "@/lib/forms";
import { listConsentPurposes } from "@/lib/consent";
import { getFoundersAssemblyPromptState } from "@/lib/assemblies";
import { Banner } from "@/components/ui/kit";
import { ReadOnlyNote } from "./ui";
import FoundersAssemblyPrompt from "./FoundersAssemblyPrompt";
import GeneralTab from "./tabs/GeneralTab";
import PermissionsTab from "./tabs/PermissionsTab";
import CoordinationTab from "./tabs/CoordinationTab";
import ModulesTab from "./tabs/ModulesTab";
import RecruitmentTab from "./tabs/RecruitmentTab";
import BranchesTab from "./tabs/BranchesTab";
import CyclesTiersTab from "./tabs/CyclesTiersTab";
import ProfilePrivacyTab from "./tabs/ProfilePrivacyTab";
import FormsTab from "./tabs/FormsTab";
import HistoryTab from "./tabs/HistoryTab";
import { countSettingsChangesByEntity, listSettingsChanges } from "@/lib/settings/history";

export const dynamic = "force-dynamic";

// The tabs are now ten files under ./tabs rather than ten blocks in a
// 2000-line page. The split isn't cosmetic: each tab's body moved with
// its own actions and its own helpers, which is what let the four
// community-settings tabs be rebuilt around one-card-one-save (see
// ./ui.tsx) without touching the six CRUD tabs' behaviour, and what will
// let the next tab to grow past a screen be edited without reading the
// other nine. What stays here is the part that genuinely is one thing:
// the access check, the data every tab might need, and which tab is
// active.
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
  { key: "history", label: "History" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// There are no Admin-only tabs. The Members tab used to be one — it was
// the bulk roster import, and a settings screen nobody opens twice should
// not have had a one-off action on it. That moved to /members/import,
// which is Admin-gated by a redirect and by requireAdmins in its actions.
// So every tab here is configuration a member has a stake in reading, and
// `authorized` below only decides what they can *write*.

function TabBar({ active, tabs }: { active: TabKey; tabs: readonly { key: TabKey; label: string }[] }) {
  return <Tabs tabs={tabs} active={active} hrefFor={(key) => `/settings?tab=${key}`} />;
}

function questionRuleTargets(questions: { id: string; label: string; archivedAt: Date | null }[]) {
  return questions.filter((q) => !q.archivedAt).map((q) => ({ id: q.id, label: q.label }));
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    tab?: string;
    entity?: string;
    error?: string;
  }>;
}) {
  const ctx = await getViewingContext();
  if (!ctx.real || !ctx.viewing) {
    redirect("/login");
  }
  const viewing = ctx.viewing;

  const { error, tab, entity } = await searchParams;

  let authorized = false;
  try {
    await requireAdmins(viewing);
    authorized = true;
  } catch {
    authorized = false;
  }

  const visibleTabKeys = new Set(TABS.map((t) => t.key));
  const requested = (tab ?? "general") as TabKey;
  const activeTab: TabKey = visibleTabKeys.has(requested) ? requested : "general";

  const [
    communityRow,
    branches,
    tiers,
    cycleTypes,
    cycles,
    profileQuestions,
    traitAxes,
    rules,
    forms,
    consentPurposes,
    pendingBranches,
    taskPacks,
    communityTasks,
    currentPhaseNames,
  ] = await Promise.all([
    getCommunity(viewing),
    listBranches(viewing),
    listTiers(viewing),
    listCycleTypes(viewing),
    listCycles(viewing),
    listProfileQuestions(viewing, { includeArchived: true }),
    listTraitAxes(viewing, { includeArchived: true }),
    listSensitiveFieldAccessRules(viewing),
    listForms(viewing, { includeArchived: true }),
    listConsentPurposes(viewing),
    authorized ? listPendingBranches(viewing) : Promise.resolve([]),
    listTaskPacks(viewing),
    listTasks(viewing),
    // The phase names of the event this member is currently looking at, so
    // the Profile & Privacy tab can put a phase-scoped question under "for
    // other events" when the event on screen has no phase of that name.
    // Off-URL on purpose: /settings has no cycle segment, so this reads the
    // same persisted "what am I looking at" that the Contribution average
    // and Messages' arrival window read. Coerced to a Set below so the JSX
    // doesn't have to null-guard a possibly-ambiguous resolution.
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
  for (const r of rules) {
    if (r.questionId) {
      ruleCountByQuestion.set(r.questionId, (ruleCountByQuestion.get(r.questionId) ?? 0) + 1);
    }
  }

  // The Forms tab's "maps to profile question" dropdown
  // (src/lib/forms.ts's mapsToProfileQuestionId) only ever accepts a
  // once_ever, non-archived, non-sensitive question — see
  // requireValidMappedProfileQuestions — so an archived, sensitive or
  // per_cycle/phase one isn't offered as an option to begin with, rather
  // than being rejected only after submitting.
  const onceEverProfileQuestionOptions = profileQuestions
    .filter((q) => q.scope === "once_ever" && !q.archivedAt && !q.sensitive)
    .map((q) => ({ id: q.id, label: q.label }));

  // The permissions tab's derived maps. Only built when that tab is the
  // one being read — four queries that no other tab needs, on a page
  // whose whole cost problem used to be doing everything for every tab.
  let permissionsData: {
    grantsFor: (moduleKey: PermissionModuleKey) => {
      taskId: string;
      title: string;
      branchName: string;
      cycleId: string | null;
      cycleName: string | null;
    }[];
    openModuleKeys: Set<PermissionModuleKey>;
    holdersByTaskId: Map<string, { memberId: string; name: string }[]>;
    sensitiveFieldsByModule: Map<PermissionModuleKey, string[]>;
    communityTasksForPicker: { id: string; title: string; branchName: string }[];
  } | null = null;
  if (activeTab === "permissions") {
    const allGrants = await listGrantsWithTaskInfo(communityRow.id);
    const cycleNameById = new Map(cycles.map((c) => [c.id, c.name]));
    type GrantRow = {
      taskId: string;
      title: string;
      branchName: string;
      cycleId: string | null;
      cycleName: string | null;
    };
    const grantsByModule = new Map<PermissionModuleKey, GrantRow[]>();
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
    const openModuleKeys = await listOpenModuleKeys(communityRow.id);
    const holdersByTaskId = await listHoldersByTaskId(allGrants.map((g) => g.taskId));

    // Which sensitive values are unlocked by a *grant* to each module.
    // Opening a module does not unlock them (D9 — deliberately deferred),
    // so this is shown as information about an existing, separate setting
    // rather than as a warning about the checkbox: the coupling is real
    // and invisible, and the person deciding should be able to see it
    // exists.
    //
    // The two target kinds are named rather than summarised. "a profile
    // question" was accurate once and stopped being useful the moment a
    // community had more than one — the reader of this panel is deciding
    // whether opening a module exposes anything, and "does it expose a
    // question?" is not an answer they can act on.
    // Which answers each permission grant unlocks. Every rule is
    // question-keyed now: the four fixed Sensitive-data columns went with
    // the `sensitive_data` module (migration 0080) and `question_id` is
    // NOT NULL, so "which of two things does this rule name" is
    // unrepresentable rather than something the form has to get right.
    // A rule naming a question that has since been deleted still has to
    // render as *something*, so it says so.
    const sensitiveFieldsByModule = new Map<PermissionModuleKey, string[]>();
    for (const rule of rules) {
      if (!rule.unlockedByGrantModuleKey) continue;
      const label = questionLabelById.get(rule.questionId);
      const existing = sensitiveFieldsByModule.get(rule.unlockedByGrantModuleKey) ?? [];
      existing.push(label ? `the “${label}” answer` : "a question that no longer exists");
      sensitiveFieldsByModule.set(rule.unlockedByGrantModuleKey, existing);
    }

    permissionsData = {
      grantsFor: (moduleKey) => grantsByModule.get(moduleKey) ?? [],
      openModuleKeys,
      holdersByTaskId,
      sensitiveFieldsByModule,
      communityTasksForPicker: communityTasks.map((t) => ({
        id: t.id,
        title: t.title,
        branchName: branchNameById.get(t.branchId) ?? "—",
      })),
    };
  }

  // The change log's two queries, only on the tab that shows it — same
  // reasoning as the permissions tab's four. The filter comes off the URL
  // and is validated against the enum by the lib's own type, so a
  // hand-edited ?entity= is a no-op filter rather than a query error.
  const historyData =
    activeTab === "history"
      ? await (async () => {
          // Checked against the enum rather than cast to it. A cast would
          // typecheck fine and then hand Postgres a value the column does
          // not contain, which is a 500 on a URL anyone can type.
          const filter = entity && (settingsChangeEntityEnum.enumValues as readonly string[]).includes(entity)
            ? (entity as (typeof settingsChangeEntityEnum.enumValues)[number])
            : undefined;
          const rows = await listSettingsChanges(viewing, { entity: filter });
          const counts = await countSettingsChangesByEntity(viewing);
          return { rows, counts, activeEntity: filter ?? null };
        })()
      : null;

  const ruleTaskIds = [...new Set(rules.map((r) => r.unlockedByTaskId).filter((v): v is string => Boolean(v)))];
  const ruleTaskRows = ruleTaskIds.length
    ? await db.select({ id: task.id, title: task.title }).from(task).where(inArray(task.id, ruleTaskIds))
    : [];
  const ruleTaskNameById = new Map(ruleTaskRows.map((t) => [t.id, t.title]));
  const tierNameById = new Map(tiers.map((t) => [t.id, t.name]));

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Community settings</h1>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {authorized
          ? "Everything here is the community's own configuration, and every change is written to the change log. Founding settings are the kind of thing a community might want to decide together — there is an Assembly for that."
          : communityRow.adminsEverClaimed
            ? "You can read all of this. Changing it is for Admins."
            : "You can read all of this. Changing it is for Admins, who haven't been claimed yet."}
      </p>

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {!tab && (await getFoundersAssemblyPromptState(viewing.communityId)) === "show" && (
        <FoundersAssemblyPrompt />
      )}

      <div className="mt-6">
        <TabBar active={activeTab} tabs={TABS} />
      </div>

      {!authorized && (
        <div className="mt-5">
          <ReadOnlyNote authorized={authorized} />
        </div>
      )}

      {/* Read-only is still one `<fieldset disabled>` around the whole tab
          body, and still deliberately. HTML disables every descendant form
          control, which covers the inputs, every per-card Save button and
          every delete/archive button in one attribute — in all ten tab
          files, none of which has to remember to thread a prop down. It is
          also the only mechanism that reaches the `type="button"`-driven
          widgets (FormBuilder, FieldShapeEditor, StarterQuestionPicker),
          which are not form controls at all; a prop would be the only thing
          that could, and ten hand-written tab files is a lot of surface for
          one attribute to be missing from.

          What changed is the other half. The old wrapper carried
          `disabled:opacity-60`, which dimmed 60% of every explanation on
          the page along with the controls — and on this screen the
          explanation is the most valuable thing there is, since it is what
          tells a member reading settings they have a stake in reading what
          each one actually does. Dropping the class leaves the prose at
          full strength and fades only the controls, which the primitives
          in ./ui.tsx each handle on their own.

          The `requireAdmins` call in every action below stays the actual
          gate either way. */}
      <fieldset disabled={!authorized} className="mt-6 min-w-0">
        {activeTab === "general" && <GeneralTab community={communityRow} tiers={tiers} />}

        {activeTab === "permissions" && permissionsData && <PermissionsTab {...permissionsData} />}

        {activeTab === "coordination" && <CoordinationTab community={communityRow} />}

        {activeTab === "modules" && <ModulesTab community={communityRow} forms={forms} />}

        {activeTab === "recruitment" && (
          <RecruitmentTab
            community={communityRow}
            forms={forms}
            cycles={cycles}
            authorized={authorized}
          />
        )}

        {activeTab === "branches" && (
          <BranchesTab confirmedBranches={confirmedBranches} pendingBranches={pendingBranches} />
        )}

        {activeTab === "cycles-tiers" && (
          <CyclesTiersTab
            tiers={tiers}
            cycleTypes={cycleTypes}
            taskPacks={taskPacks}
            cycles={cycles.map((c) => ({ id: c.id, name: c.name }))}
          />
        )}

        {activeTab === "profile-privacy" && (
          <ProfilePrivacyTab
            profileQuestions={profileQuestions}
            traitAxes={traitAxes}
            rules={rules}
            consentPurposes={consentPurposes}
            tiers={tiers}
            communityTasks={communityTasks.map((t) => ({ id: t.id, title: t.title }))}
            currentPhases={currentPhases}
            sensitiveQuestionOptions={sensitiveQuestionOptions}
            questionLabelById={questionLabelById}
            ruleTaskNameById={ruleTaskNameById}
            tierNameById={tierNameById}
          />
        )}

        {activeTab === "forms" && (
          <FormsTab forms={forms} profileQuestionOptions={onceEverProfileQuestionOptions} />
        )}

        {activeTab === "history" && historyData && (
          <HistoryTab rows={historyData.rows} counts={historyData.counts} activeEntity={historyData.activeEntity} />
        )}
      </fieldset>
    </main>
  );
}

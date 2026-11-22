import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewerClock } from "@/lib/view-clock";
import { getViewingContext } from "@/lib/view-as";
import {
  describeRequirement,
  getTask,
  listRequirements,
  listTaskDependencies,
  listTaskMilestones,
  listTasks,
  tierNameLookup,
} from "@/lib/tasks";
import { getCommunity, isAdmin, listBranches } from "@/lib/settings";
import {
  allowsMultipleGrants,
  describeGrantScope,
  isMisplacedCommunityGrant,
  listGrantsWithTaskInfo,
  listModuleKeysGrantedByTask,
  PERMISSION_MODULE_LABELS,
  TASK_GRANTABLE_PERMISSION_MODULE_KEYS,
  type PermissionModuleKey,
} from "@/lib/permissions";
import { getCycle, listCycles } from "@/lib/cycles";
import PageHeader from "@/components/ui/PageHeader";
import EffortFields from "@/components/EffortFields";
import MilestoneDateFields from "@/components/tasks/MilestoneDateFields";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_GHOST, CheckField, INPUT, Tag } from "@/components/ui/kit";
import {
  addDependencyAction,
  addMilestoneAction,
  addRequirementAction,
  deleteMilestoneAction,
  deleteRequirementAction,
  removeDependencyAction,
  updateMilestoneAction,
  updateRequirementAction,
  updateTaskAction,
  updateTaskPermissionGrantsAction,
} from "../actions";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// The task's one edit screen (docs/plans/task-interface-plan.md D1):
// every piece of task *config* — the core details form, requirements,
// dependencies, milestone add/edit/remove, and the admin-only
// permission grants — lives here, reached via the read page's ⋯ menu
// ("Edit task…"). The read page keeps state actions (milestone
// mark-done, confirm/reject-pending) and content (wiki, comments,
// resources). Open to any member for everything but the permissions
// section, the same posture the forms had when they were disclosures
// on the task page — the actions re-check server-side regardless.
export default async function TaskEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const clock = await getViewerClock();

  const { id } = await params;
  const { error } = await searchParams;

  const taskRow = await getTask(viewing, id);
  const [
    branchRow,
    branches,
    requirements,
    tierNames,
    dependencies,
    allCommunityTasks,
    communityRow,
    taskCycle,
    milestones,
    communityMembers,
  ] = await Promise.all([
    db.select().from(branch).where(eq(branch.id, taskRow.branchId)).then((r) => r[0]),
    listBranches(viewing),
    listRequirements(viewing, id),
    tierNameLookup(viewing.communityId),
    listTaskDependencies(viewing, id),
    listTasks(viewing),
    getCommunity(viewing),
    taskRow.cycleId ? getCycle(viewing, taskRow.cycleId) : Promise.resolve(null),
    listTaskMilestones(viewing, id),
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
  ]);
  const cyclePhases = taskCycle?.phases ?? [];
  const allCycles = communityRow.cyclesEnabled ? await listCycles(viewing) : [];

  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));
  const tierOptions = [...tierNames.entries()].map(([tId, name]) => ({ id: tId, name }));
  const communityTasks = allCommunityTasks
    .filter((t) => t.id !== taskRow.id)
    .map((t) => ({ id: t.id, title: t.title }));
  const dependencyOptions = communityTasks.filter(
    (t) => !dependencies.some((d) => d.dependsOnTaskId === t.id),
  );

  // "Permissions granted by this task" reads/writes the exact same
  // PermissionGrant rows the settings panel's Access & permissions tab
  // does — visibility and the underlying write path are both Admin-only
  // here too, a genuinely stricter gate than the rest of this screen's
  // editing surface (see updateTaskPermissionGrantsAction in
  // ../actions.ts for the server-side enforcement this mirrors).
  const canGrantPermissions = await isAdmin(viewing);
  const [communityGrants, grantedByThisTask] = canGrantPermissions
    ? await Promise.all([
        listGrantsWithTaskInfo(taskRow.communityId),
        listModuleKeysGrantedByTask(taskRow.communityId, taskRow.id),
      ])
    : [[], new Set<PermissionModuleKey>()];
  // The "currently held elsewhere" warning below is keyed against this
  // task's *own* placement (taskRow.cycleId — the one scope read): a
  // grant in a different cycle isn't in this task's scope at all, so
  // checking the same module here creates a second, coexisting grant
  // instead of moving it.
  const elsewhereHolderByModule = new Map<PermissionModuleKey, string>();
  for (const g of communityGrants) {
    if (g.taskId === taskRow.id || allowsMultipleGrants(g.moduleKey)) continue;
    if (g.cycleId !== taskRow.cycleId) continue;
    elsewhereHolderByModule.set(g.moduleKey, g.title);
  }

  const taskPath = `/tasks/${taskRow.id}`;
  const editPath = `${taskPath}/edit`;

  // Editing or removing a milestone is a current holder's act (the same
  // rule updateTaskMilestone / deleteTaskMilestone enforce), unlike adding
  // one, which anyone may propose. The old task page only showed these
  // controls to holders; so does this screen, rather than offering a form
  // that can only answer "Only a current holder of this task can…".
  const viewerHolds = taskRow.assignments.some((a) => a.memberId === viewing.id && !a.isShadow);

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <Link href={taskPath} className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
        ← Back to task
      </Link>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <PageHeader
        title="Edit task"
        description={
          <>
            Config for{" "}
            <Link href={taskPath} className="font-medium text-[var(--accent-1)] hover:underline">
              {taskRow.title}
            </Link>
            {branchRow ? ` (${branchRow.name})` : ""}. Saving the details returns to the task page; the
            sections below stay here so several changes can be made in a row.
          </>
        }
      />

      {/* Details — the core fields. updateTaskAction redirects back to
          the read page on success. */}
      <form action={updateTaskAction} className="mt-6 flex flex-col gap-3">
        <input type="hidden" name="taskId" value={taskRow.id} />
        <input type="hidden" name="returnTo" value={editPath} />
        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Title</span>
          <input type="text" name="title" defaultValue={taskRow.title} className={INPUT} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Description</span>
          <textarea name="description" rows={3} defaultValue={taskRow.description ?? ""} className={INPUT} />
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Branch</span>
            <select name="branchId" defaultValue={taskRow.branchId} key={taskRow.branchId} className={INPUT}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {communityRow.cyclesEnabled && (
            <label className="flex flex-col gap-1">
              <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Event</span>
              <select name="cycleId" defaultValue={taskRow.cycleId ?? ""} key={taskRow.cycleId ?? ""} className={INPUT}>
                <option value="">No event (unscoped)</option>
                {allCycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Phase</span>
            <select name="phaseId" defaultValue={taskRow.phaseId ?? ""} key={taskRow.phaseId ?? ""} className={INPUT}>
              <option value="">No phase</option>
              {cyclePhases.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Effort</span>
            <div className="flex flex-wrap items-center gap-2">
              <EffortFields
                defaultEffort={taskRow.effort}
                defaultDuration={(taskRow.effortMagnitude as { duration?: string } | null | undefined)?.duration}
                defaultHoursPerWeek={
                  (taskRow.effortMagnitude as { hours_per_week?: number } | null | undefined)?.hours_per_week
                }
              />
            </div>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Capacity (blank = uncapped)</span>
            <input type="number" name="capacity" min={1} defaultValue={taskRow.capacity ?? ""} className={`${INPUT} w-24`} />
          </label>
          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
            <input type="checkbox" name="critical" defaultChecked={taskRow.critical} /> Critical
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Tags (comma-separated)</span>
          <input type="text" name="tags" defaultValue={(taskRow.tags ?? []).join(", ")} className={INPUT} />
        </label>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Save changes
        </button>
      </form>

      <section className="mt-8">
        <SectionHeading>Requirements</SectionHeading>
        {requirements.length === 0 && <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">None yet.</p>}
        <ul className="mt-2 flex flex-col gap-2">
          {requirements.map((r) => {
            const value = r.value as { tierId?: string; language?: string; taskId?: string; flag?: string };
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 text-[length:var(--text-body)] text-[var(--text)]">
                <span>{describeRequirement(r, tierNames)}</span>
                <details>
                  <summary className="cursor-pointer text-[length:var(--text-meta)] text-[var(--accent-1)]">Edit</summary>
                  <form action={updateRequirementAction} className="mt-2 flex flex-wrap items-center gap-2">
                    <input type="hidden" name="taskId" value={taskRow.id} />
                    <input type="hidden" name="returnTo" value={editPath} />
                    <input type="hidden" name="requirementId" value={r.id} />
                    <input type="hidden" name="requirementType" value={r.type} />
                    {r.type === "tier" && (
                      <select name="requirementTierId" defaultValue={value.tierId ?? ""} key={value.tierId ?? ""} className={INPUT}>
                        <option value="">Tier…</option>
                        {tierOptions.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.type === "language" && (
                      <input type="text" name="requirementLanguage" defaultValue={value.language ?? ""} className={INPUT} />
                    )}
                    {r.type === "completed_task" && (
                      <select name="requirementCompletedTaskId" defaultValue={value.taskId ?? ""} key={value.taskId ?? ""} className={INPUT}>
                        <option value="">Task…</option>
                        {communityTasks.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title}
                          </option>
                        ))}
                      </select>
                    )}
                    {r.type === "custom" && (
                      <input type="text" name="requirementFlag" defaultValue={value.flag ?? ""} className={INPUT} />
                    )}
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Update
                    </button>
                  </form>
                </details>
                <form action={deleteRequirementAction}>
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="returnTo" value={editPath} />
                  <input type="hidden" name="requirementId" value={r.id} />
                  <button type="submit" className={BUTTON_GHOST}>
                    Remove
                  </button>
                </form>
              </li>
            );
          })}
        </ul>

        <details className="mt-2">
          <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Add a requirement</summary>
          <form action={addRequirementAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="returnTo" value={editPath} />
            <div className="flex flex-wrap items-center gap-2">
              <select name="requirementType" required defaultValue="" className={INPUT}>
                <option value="" disabled>
                  Type…
                </option>
                <option value="tier">Tier</option>
                <option value="language">Language</option>
                <option value="completed_task">Completed a specific task</option>
                <option value="custom">Custom flag</option>
              </select>
              <select name="requirementMode" defaultValue="individual_gate" className={INPUT}>
                <option value="individual_gate">Individual gate</option>
                <option value="group_coverage">Group coverage</option>
                <option value="soft_priority">Soft priority</option>
              </select>
            </div>
            <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              <select name="requirementTierId" defaultValue="" className={INPUT}>
                <option value="">Tier…</option>
                {tierOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              (if type = tier)
            </label>
            <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              <input type="text" name="requirementLanguage" placeholder="language" className={INPUT} />
              (if type = language)
            </label>
            <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              <select name="requirementCompletedTaskId" defaultValue="" className={INPUT}>
                <option value="">Task…</option>
                {communityTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              (if type = completed task)
            </label>
            <label className="flex items-center gap-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              <input type="text" name="requirementFlag" placeholder="custom flag" className={INPUT} />
              (if type = custom)
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Add
            </button>
          </form>
        </details>
      </section>

      <section className="mt-8">
        <SectionHeading>Dependencies</SectionHeading>
        {dependencies.length === 0 && <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">None.</p>}
        <ul className="mt-2 flex flex-col gap-1.5">
          {dependencies.map((d) => (
            <li key={d.dependsOnTaskId} className="flex flex-wrap items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <Link href={`/tasks/${d.dependsOnTaskId}`} className="font-medium text-[var(--accent-1)] hover:underline">
                {d.title}
              </Link>
              <span className="text-[var(--text-muted)]">({d.status})</span>
              <form action={removeDependencyAction}>
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="hidden" name="returnTo" value={editPath} />
                <input type="hidden" name="dependsOnTaskId" value={d.dependsOnTaskId} />
                <button type="submit" className={BUTTON_GHOST}>
                  Remove
                </button>
              </form>
            </li>
          ))}
        </ul>

        {dependencyOptions.length > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Add dependencies</summary>
            <form action={addDependencyAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
              <input type="hidden" name="taskId" value={taskRow.id} />
              <input type="hidden" name="returnTo" value={editPath} />
              <select name="dependsOnTaskIds" multiple className={`${INPUT} h-32`}>
                {dependencyOptions.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Add
              </button>
            </form>
          </details>
        )}
      </section>

      <section className="mt-8">
        <SectionHeading>Milestones</SectionHeading>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Anyone&rsquo;s addition lands pending until a current holder confirms it on the task page (an
          unclaimed task confirms immediately either way).
          {!viewerHolds && " Only a current holder can edit or remove an existing milestone."}
        </p>
        {milestones.length === 0 && <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
        <div className="mt-3">
          {milestones.map((m) => (
            <div key={m.id} className="mb-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{m.label}</span>
                {m.isDeadline && <Tag tone="accent">deadline</Tag>}
                {m.checkIn && <Tag tone="neutral">check-in</Tag>}
                {m.completedAt && <Tag tone="success">done {clock.date(m.completedAt)}</Tag>}
                {m.status === "pending" && (
                  <Tag tone="warning">pending — proposed by {memberNameById.get(m.proposedBy) ?? "—"}</Tag>
                )}
              </div>

              {viewerHolds && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[length:var(--text-meta)] text-[var(--accent-1)]">Edit</summary>
                <form action={updateMilestoneAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="taskId" value={taskRow.id} />
                  <input type="hidden" name="returnTo" value={editPath} />
                  <input type="hidden" name="milestoneId" value={m.id} />
                  <input type="text" name="label" required defaultValue={m.label} className={INPUT} />
                  <MilestoneDateFields
                    milestone={m}
                    phases={cyclePhases}
                    cycleStartDate={taskCycle?.startDate ?? null}
                    cycleEndDate={taskCycle?.endDate ?? null}
                    taskPhaseId={taskRow.phaseId}
                  />
                  <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                    <input type="checkbox" name="isDeadline" defaultChecked={m.isDeadline} />
                    This is the deadline
                  </label>
                  <div className="flex gap-2">
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Save
                    </button>
                  </div>
                </form>
              </details>
              )}
              {viewerHolds && (
              <form action={deleteMilestoneAction} className="mt-2">
                <input type="hidden" name="taskId" value={taskRow.id} />
                <input type="hidden" name="returnTo" value={editPath} />
                <input type="hidden" name="milestoneId" value={m.id} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Remove
                </button>
              </form>
              )}
            </div>
          ))}
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline">
            Add milestone
          </summary>
          <form action={addMilestoneAction} className="mt-2 flex max-w-[420px] flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="returnTo" value={editPath} />
            <input type="text" name="label" required placeholder="Label (e.g. Deposit due)" className={INPUT} />
            <MilestoneDateFields
              phases={cyclePhases}
              cycleStartDate={taskCycle?.startDate ?? null}
              cycleEndDate={taskCycle?.endDate ?? null}
              taskPhaseId={taskRow.phaseId}
            />
            <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
              <input type="checkbox" name="isDeadline" />
              This is the deadline
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Add
            </button>
          </form>
        </details>
      </section>

      {canGrantPermissions && (
        <section className="mt-8">
          <SectionHeading>Permissions granted by this task</SectionHeading>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Check which module-level access gate(s) whoever currently holds this task should get —
            the identical <code>PermissionGrant</code> rows the settings panel&rsquo;s Access &amp;
            permissions tab edits, grouped there by how far each reaches. A grant&rsquo;s scope comes
            from this task&rsquo;s own placement, so each row below shows what you&rsquo;d be granting
            here. Budget authority is configured only in Settings → Access &amp; permissions.
          </p>
          <form action={updateTaskPermissionGrantsAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="taskId" value={taskRow.id} />
            <input type="hidden" name="returnTo" value={editPath} />
            {TASK_GRANTABLE_PERMISSION_MODULE_KEYS.map((moduleKey) => (
              <div key={moduleKey}>
                <CheckField
                  label={PERMISSION_MODULE_LABELS[moduleKey]}
                  name="moduleKeys"
                  value={moduleKey}
                  defaultChecked={grantedByThisTask.has(moduleKey)}
                />
                <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {describeGrantScope(moduleKey, taskRow.cycleId, taskCycle?.name ?? null)}
                  {isMisplacedCommunityGrant(moduleKey, taskRow.cycleId) && (
                    <>
                      {" "}
                      &mdash; but this task sits in an event, which contradicts a community-wide role.
                      The grant still counts community-wide.
                    </>
                  )}
                </p>
                {elsewhereHolderByModule.has(moduleKey) && (
                  <p className="ml-6 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Currently held by &ldquo;{elsewhereHolderByModule.get(moduleKey)}&rdquo; — checking this
                    moves it here.
                  </p>
                )}
              </div>
            ))}
            <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
              Save
            </button>
          </form>
        </section>
      )}
    </main>
  );
}

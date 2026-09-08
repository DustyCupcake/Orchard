import EffortFields from "@/components/EffortFields";
import { Tag, BUTTON_PRIMARY, BUTTON_SECONDARY, CheckField, INPUT } from "@/components/ui/kit";
import { PERMISSION_MODULE_KEYS, PERMISSION_MODULE_LABELS, type PermissionModuleKey } from "@/lib/permissions";
import { activateProposalAction, declineProposalAction } from "./actions";

type Proposal = {
  id: string;
  title: string;
  description: string;
  wantsToClaim: boolean;
  suggestedMemberNote: string | null;
  status: string;
  declineReason: string | null;
  createdAt: Date;
  // Optional extras a proposer volunteered on /propose's own Advanced
  // section (src/app/(app)/propose/page.tsx) — every review field below
  // still defaults from these when set, but stays fully editable/
  // overridable here; nothing about activation is locked to what was
  // suggested.
  suggestedBranchId: string | null;
  suggestedCycleId: string | null;
  suggestedEffort: string | null;
  // jsonb — Drizzle infers this as unknown; cast at each use site,
  // matching this codebase's existing convention (e.g. contribution.ts's
  // identical `effortMagnitude as Record<string, unknown> | null`).
  suggestedEffortMagnitude: unknown;
  suggestedTags: string[] | null;
  suggestedCapacity: number | null;
  suggestedCritical: boolean | null;
  suggestedDueDate: string | null;
};

// A short read-only recap of whatever a proposer suggested, shown above
// the activation form so a reviewer sees it at a glance without having
// to open every disclosure below to discover it was already filled in.
function suggestionSummary(
  proposal: Proposal,
  branchNameById: Map<string, string>,
  cycleNameById: Map<string, string>,
) {
  const parts: string[] = [];
  if (proposal.suggestedBranchId) parts.push(branchNameById.get(proposal.suggestedBranchId) ?? "—");
  if (proposal.suggestedCycleId) parts.push(cycleNameById.get(proposal.suggestedCycleId) ?? "—");
  if (proposal.suggestedEffort) {
    const mag = proposal.suggestedEffortMagnitude as Record<string, unknown> | null;
    if (proposal.suggestedEffort === "one_off") {
      parts.push(`One-off${mag?.duration ? ` (${String(mag.duration)})` : ""}`);
    } else {
      const label = proposal.suggestedEffort === "ongoing" ? "Ongoing" : "Owns-a-thing";
      parts.push(`${label}${mag?.hours_per_week ? ` (${String(mag.hours_per_week)}h/week)` : ""}`);
    }
  }
  if (proposal.suggestedTags && proposal.suggestedTags.length > 0) parts.push(proposal.suggestedTags.join(", "));
  if (proposal.suggestedCapacity !== null) parts.push(`capacity ${proposal.suggestedCapacity}`);
  if (proposal.suggestedCritical) parts.push("critical");
  if (proposal.suggestedDueDate) parts.push(`due ${proposal.suggestedDueDate}`);
  return parts;
}

export default function ProposalCard({
  proposal,
  branches,
  tiers,
  communityTasks,
  submitterName,
  suggestedMemberName,
  canGrantPermissions,
  elsewhereHolderByModule,
  cyclesEnabled,
  cycles,
  defaultCycleId,
}: {
  proposal: Proposal;
  branches: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  communityTasks: { id: string; title: string }[];
  submitterName: string;
  suggestedMemberName: string | null;
  canGrantPermissions: boolean;
  elsewhereHolderByModule: Partial<Record<PermissionModuleKey, string>>;
  cyclesEnabled: boolean;
  // Same list/default used for both the new task's own cycleId select
  // below and the permissions fieldset's grantCycleId select further
  // down — two different concerns (which cycle the task itself
  // belongs to, vs. which cycle a permission grant it hands out is
  // scoped to), same underlying community cycle list.
  cycles: { id: string; name: string }[];
  defaultCycleId: string | null;
}) {
  const branchNameById = new Map(branches.map((b) => [b.id, b.name]));
  const cycleNameById = new Map(cycles.map((c) => [c.id, c.name]));
  const suggested = suggestionSummary(proposal, branchNameById, cycleNameById);
  const suggestedMag = proposal.suggestedEffortMagnitude as Record<string, unknown> | null;

  return (
    <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[14px] font-semibold text-[var(--text)]">{proposal.title}</span>
        {proposal.status !== "pending" && <Tag tone={proposal.status === "declined" ? "danger" : "success"}>{proposal.status}</Tag>}
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--text-muted)]">
        Proposed by {submitterName} · {new Date(proposal.createdAt).toLocaleDateString()}
      </div>
      {proposal.description && <p className="mt-1.5 text-[13px] text-[var(--text)]">{proposal.description}</p>}
      {proposal.wantsToClaim && (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">{submitterName} would like to claim this themselves.</p>
      )}
      {suggestedMemberName && (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          Suggested for: {suggestedMemberName}
          {proposal.suggestedMemberNote && ` — ${proposal.suggestedMemberNote}`}
        </p>
      )}
      {suggested.length > 0 && (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">Proposer suggested: {suggested.join(" · ")}</p>
      )}
      {proposal.status === "declined" && proposal.declineReason && (
        <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">Declined: {proposal.declineReason}</p>
      )}

      {proposal.status === "pending" && (
        <>
          <form action={activateProposalAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />

            <input type="text" name="title" defaultValue={proposal.title} placeholder="Title" className={INPUT} />
            <textarea name="description" defaultValue={proposal.description} rows={2} placeholder="Description" className={INPUT} />

            <div className="flex flex-wrap items-center gap-2">
              <select name="branchId" required defaultValue={proposal.suggestedBranchId ?? ""} className={INPUT}>
                <option value="">Branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              {cyclesEnabled && (
                <select name="cycleId" defaultValue={proposal.suggestedCycleId ?? defaultCycleId ?? ""} className={INPUT}>
                  <option value="">No cycle (unscoped)</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}

              <EffortFields
                defaultEffort={proposal.suggestedEffort ?? "one_off"}
                defaultDuration={typeof suggestedMag?.duration === "string" ? suggestedMag.duration : "few_hours"}
                defaultHoursPerWeek={
                  typeof suggestedMag?.hours_per_week === "number" ? suggestedMag.hours_per_week : undefined
                }
              />
            </div>

            <input
              type="text"
              name="tags"
              placeholder="tags (comma-separated)"
              defaultValue={proposal.suggestedTags?.join(", ") ?? ""}
              className={INPUT}
            />

            <label className="flex flex-col gap-1">
              <span className="text-[12px] text-[var(--text-muted)]">Due date (optional — becomes a task milestone)</span>
              <input
                type="date"
                name="dueDate"
                defaultValue={proposal.suggestedDueDate ?? ""}
                className={`${INPUT} w-fit`}
              />
            </label>

            <details className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">More options</summary>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                  Capacity:
                  <input
                    type="number"
                    name="capacity"
                    placeholder="1"
                    min={1}
                    defaultValue={proposal.suggestedCapacity ?? ""}
                    className={`${INPUT} w-20`}
                  />
                </label>
                <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                  <input type="checkbox" name="critical" defaultChecked={proposal.suggestedCritical ?? false} /> Critical
                </label>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select name="openness" defaultValue="request" className={INPUT}>
                  <option value="open">Open</option>
                  <option value="request">Request</option>
                  <option value="coordination_approved">Coordination-approved</option>
                  <option value="community_endorsed">Community-endorsed</option>
                </select>

                <input
                  type="number"
                  name="endorsementThreshold"
                  placeholder="endorsement threshold (0 = none needed)"
                  min={0}
                  className={`${INPUT} w-44`}
                />
                <input type="datetime-local" name="browsePeriodEnd" className={INPUT} />
                <span className="text-[12px] text-[var(--text-muted)]">(if community-endorsed)</span>
              </div>
            </details>

            <details className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Add a requirement (optional)</summary>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <select name="requirementType" defaultValue="" className={INPUT}>
                  <option value="">No requirement</option>
                  <option value="tier">Tier</option>
                  <option value="language">Language</option>
                  <option value="completed_task">Completed a specific task</option>
                  <option value="custom">Custom flag</option>
                </select>
                <select name="requirementMode" defaultValue="individual_gate" className={INPUT}>
                  <option value="individual_gate">Individual gate (blocks claiming)</option>
                  <option value="group_coverage">Group coverage (flags, doesn&rsquo;t block)</option>
                  <option value="soft_priority">Soft priority (surfacing only)</option>
                </select>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select name="requirementTierId" defaultValue="" className={INPUT}>
                  <option value="">Tier…</option>
                  {tiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[var(--text-muted)]">(if type = tier)</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input type="text" name="requirementLanguage" placeholder="language" className={INPUT} />
                <span className="text-[12px] text-[var(--text-muted)]">(if type = language)</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select name="requirementCompletedTaskId" defaultValue="" className={INPUT}>
                  <option value="">Task…</option>
                  {communityTasks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[var(--text-muted)]">(if type = completed task)</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input type="text" name="requirementFlag" placeholder="custom flag" className={INPUT} />
                <span className="text-[12px] text-[var(--text-muted)]">(if type = custom)</span>
              </div>
            </details>

            <details className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Depends on (optional)</summary>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">ctrl/cmd-click to select more than one</p>
              <select name="dependsOnTaskIds" multiple className={`${INPUT} mt-2 h-24`}>
                {communityTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </details>

            {canGrantPermissions && (
              <details className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">
                  Permissions granted by this task (optional)
                </summary>
                {cyclesEnabled && (
                  <label className="mb-2 mt-3 flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">
                    Cycle (applies to Event scheduling owner / Spatial planning only, below)
                    <select name="grantCycleId" defaultValue={defaultCycleId ?? ""} className={INPUT}>
                      <option value="">Community-wide (no cycle)</option>
                      {cycles.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="mt-3 flex flex-col gap-1">
                  {PERMISSION_MODULE_KEYS.map((moduleKey) => (
                    <div key={moduleKey}>
                      <CheckField label={PERMISSION_MODULE_LABELS[moduleKey]} name="grantModuleKeys" value={moduleKey} />
                      {elsewhereHolderByModule[moduleKey] && (
                        <p className="ml-6 text-[12px] text-[var(--text-muted)]">
                          Currently held by &ldquo;{elsewhereHolderByModule[moduleKey]}&rdquo; — checking this
                          moves it here.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </details>
            )}

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Activate onto the board
            </button>
          </form>

          <form action={declineProposalAction} className="mt-2 flex gap-2">
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input type="text" name="reason" placeholder="reason (optional)" className={`${INPUT} flex-1`} />
            <button type="submit" className={BUTTON_SECONDARY}>
              Decline
            </button>
          </form>
        </>
      )}
    </div>
  );
}

import { Tag, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT } from "@/components/ui/kit";
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
};

export default function ProposalCard({
  proposal,
  branches,
  tiers,
  communityTasks,
  submitterName,
  suggestedMemberName,
}: {
  proposal: Proposal;
  branches: { id: string; name: string }[];
  tiers: { id: string; name: string }[];
  communityTasks: { id: string; title: string }[];
  submitterName: string;
  suggestedMemberName: string | null;
}) {
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
              <select name="branchId" required className={INPUT}>
                <option value="">Branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select name="effort" required defaultValue="one_off" className={INPUT}>
                <option value="one_off">One-off</option>
                <option value="ongoing">Ongoing</option>
                <option value="owns_a_thing">Owns-a-thing</option>
              </select>

              <select name="duration" defaultValue="few_hours" className={INPUT}>
                <option value="under_hour">Under an hour</option>
                <option value="few_hours">A few hours</option>
                <option value="half_day">Half a day</option>
                <option value="multi_day">Multi-day</option>
              </select>
              <span className="text-[12px] text-[var(--text-muted)]">(if one-off)</span>

              <input type="number" name="hoursPerWeek" placeholder="hours/week" min={0} className={`${INPUT} w-32`} />
              <span className="text-[12px] text-[var(--text-muted)]">(if ongoing/owns-a-thing)</span>
            </div>

            <input type="text" name="tags" placeholder="tags (comma-separated)" className={INPUT} />

            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
                Capacity:
                <input type="number" name="capacity" placeholder="1" min={1} className={`${INPUT} w-20`} />
              </label>
              <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="critical" /> Critical
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select name="openness" defaultValue="request" className={INPUT}>
                <option value="open">Open</option>
                <option value="request">Request</option>
                <option value="coordination_approved">Coordination-approved</option>
                <option value="community_endorsed">Community-endorsed</option>
              </select>

              <input
                type="number"
                name="endorsementThreshold"
                placeholder="endorsement threshold"
                min={1}
                className={`${INPUT} w-44`}
              />
              <input type="datetime-local" name="browsePeriodEnd" className={INPUT} />
              <span className="text-[12px] text-[var(--text-muted)]">(if community-endorsed)</span>
            </div>

            <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <legend className="px-1 text-[12px] text-[var(--text-muted)]">Requirement (optional)</legend>
              <div className="flex flex-wrap items-center gap-2">
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
            </fieldset>

            <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <legend className="px-1 text-[12px] text-[var(--text-muted)]">
                Depends on (optional — ctrl/cmd-click to select more than one)
              </legend>
              <select name="dependsOnTaskIds" multiple className={`${INPUT} h-24`}>
                {communityTasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            </fieldset>

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

import { BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import type { getBudgetVotingView } from "@/lib/budget";
import { confirmBudgetCycleAction, submitBudgetVoteAction } from "./actions";

type VotingView = Awaited<ReturnType<typeof getBudgetVotingView>>;
type BudgetCycleRow = VotingView["cycle"];

function formatAmount(n: number) {
  return n.toLocaleString();
}

const TH = "border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
const TD = "border-b border-[var(--border)] px-2 py-2 text-[var(--text)]";

// The voting/confirmed half of /budget — see docs/spec.md's Budget
// ("Ranked-choice voting", "Confirmation", "Contributions") and
// docs/development-plan.md's Phase 27. Rendered by page.tsx once a
// cycle leaves `proposals_open`. `cycleScope` (Phase 65) threads
// through both forms below so their own redirects land back on the
// exact scoped URL the page rendered from.
export default function BudgetVotingSection({
  currentCycle,
  votingView,
  isOwner,
  memberNameById,
  branchNameById,
  confirmedIds,
  myContributionSignal,
  cycleScope,
}: {
  currentCycle: BudgetCycleRow;
  votingView: VotingView;
  isOwner: boolean;
  memberNameById: Map<string, string>;
  branchNameById: Map<string, string>;
  confirmedIds: Set<string>;
  myContributionSignal: number | null;
  cycleScope: string;
}) {
  const { ranked, fixedTotal, memberCount, voteCount, myVote } = votingView;

  // A neutral, vote-order-independent listing for the ballot itself —
  // `ranked` is sorted by the current aggregate score, which would
  // otherwise anchor later voters toward the existing standings.
  const ballotOrder = [...ranked].sort(
    (a, b) => new Date(a.proposal.submittedAt).getTime() - new Date(b.proposal.submittedAt).getTime(),
  );
  const myRankByProposalId = new Map(
    ((myVote?.rankedProposalIds as string[] | undefined) ?? []).map((id, i) => [id, i + 1] as const),
  );

  return (
    <>
      <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">
        {currentCycle.status === "confirmed" ? "Results" : "Voting"} — {voteCount} of {memberCount}{" "}
        members have voted
      </h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={TH}>Rank</th>
              <th className={TH}>Proposal</th>
              <th className={TH}>Submitted by</th>
              <th className={TH}>Total</th>
              <th className={TH}>Cost/member</th>
              <th className={TH}>Running total</th>
              {currentCycle.status === "confirmed" && <th className={TH}>Funded</th>}
            </tr>
          </thead>
          <tbody>
            <tr className="hover:bg-[var(--surface-sunken)]">
              <td className={TD} colSpan={5}>
                Fixed costs
              </td>
              <td className={TD}>{formatAmount(fixedTotal)}</td>
              {currentCycle.status === "confirmed" && <td className={TD}>—</td>}
            </tr>
            {ranked.length === 0 && (
              <tr className="hover:bg-[var(--surface-sunken)]">
                <td className={TD} colSpan={currentCycle.status === "confirmed" ? 7 : 6}>
                  No proposals were submitted for this cycle.
                </td>
              </tr>
            )}
            {ranked.map((r) => (
              <tr key={r.proposal.id} className="hover:bg-[var(--surface-sunken)]">
                <td className={TD}>{r.rank}</td>
                <td className={TD}>
                  {r.proposal.title}
                  {r.proposal.branchId && <> · {branchNameById.get(r.proposal.branchId) ?? "—"}</>}
                </td>
                <td className={TD}>{memberNameById.get(r.proposal.submittedBy) ?? "—"}</td>
                <td className={TD}>{formatAmount(r.proposal.totalAmount)}</td>
                <td className={TD}>{r.costPerMember !== null ? formatAmount(Math.round(r.costPerMember)) : "—"}</td>
                <td className={TD}>{formatAmount(r.runningTotal)}</td>
                {currentCycle.status === "confirmed" && (
                  <td className={TD}>{confirmedIds.has(r.proposal.id) ? "Yes" : "No"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentCycle.status === "confirmed" && (
        <div className="mt-3 text-[13px] text-[var(--text)]">
          {currentCycle.confirmationRationale && (
            <p className="text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">Confirmation rationale:</span> {currentCycle.confirmationRationale}
            </p>
          )}
          <p className="mt-1">
            <span className="font-medium">Your contribution ask:</span>{" "}
            {myContributionSignal !== null
              ? formatAmount(myContributionSignal)
              : "you didn't signal an amount when you voted"}
          </p>
        </div>
      )}

      {currentCycle.status === "voting" && ballotOrder.length > 0 && (
        <>
          <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">
            Your ranking{myVote ? " (currently submitted — resubmitting replaces it)" : ""}
          </h3>
          <form action={submitBudgetVoteAction} className="mt-2 flex max-w-[500px] flex-col gap-2">
            <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {ballotOrder.map((r) => (
              <label key={r.proposal.id} className="flex items-center justify-between gap-2 text-[13px] text-[var(--text)]">
                <span>
                  {r.proposal.title} ({formatAmount(r.proposal.totalAmount)})
                </span>
                <input type="hidden" name="proposalId" value={r.proposal.id} />
                <select name={`rank_${r.proposal.id}`} defaultValue={myRankByProposalId.get(r.proposal.id) ?? ""} required className={`${INPUT} w-fit`}>
                  <option value="" disabled>
                    rank
                  </option>
                  {ballotOrder.map((_, i) => (
                    <option key={i + 1} value={i + 1}>
                      {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className={LABEL}>How much would you contribute this year? (optional)</span>
              <input type="number" name="contributionSignal" min={0} defaultValue={myVote?.contributionSignal ?? ""} className={`${INPUT} w-fit`} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              {myVote ? "Update vote" : "Submit vote"}
            </button>
          </form>
        </>
      )}

      {currentCycle.status === "voting" && isOwner && (
        <>
          <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">Confirm budget</h3>
          <form action={confirmBudgetCycleAction} className="mt-2 flex max-w-[500px] flex-col gap-2">
            <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {ranked.map((r) => (
              <label key={r.proposal.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                <input type="checkbox" name="confirmedProposalIds" value={r.proposal.id} />
                {r.proposal.title} ({formatAmount(r.proposal.totalAmount)})
              </label>
            ))}
            <label className="flex flex-col gap-1">
              <span className={LABEL}>Rationale — required only if the funded set above differs from the ranked order</span>
              <textarea name="confirmationRationale" rows={2} className={INPUT} />
            </label>
            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Confirm budget
            </button>
          </form>
        </>
      )}
    </>
  );
}

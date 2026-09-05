import type { CSSProperties } from "react";
import type { getBudgetVotingView } from "@/lib/budget";
import { confirmBudgetCycleAction, submitBudgetVoteAction } from "./actions";

type VotingView = Awaited<ReturnType<typeof getBudgetVotingView>>;
type BudgetCycleRow = VotingView["cycle"];

function formatAmount(n: number) {
  return n.toLocaleString();
}

const cellStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #ccc",
  padding: "0.4rem",
};

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
      <h3>
        {currentCycle.status === "confirmed" ? "Results" : "Voting"} — {voteCount} of {memberCount}{" "}
        members have voted
      </h3>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Rank</th>
              <th style={cellStyle}>Proposal</th>
              <th style={cellStyle}>Submitted by</th>
              <th style={cellStyle}>Total</th>
              <th style={cellStyle}>Cost/member</th>
              <th style={cellStyle}>Running total</th>
              {currentCycle.status === "confirmed" && <th style={cellStyle}>Funded</th>}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={cellStyle} colSpan={5}>
                Fixed costs
              </td>
              <td style={cellStyle}>{formatAmount(fixedTotal)}</td>
              {currentCycle.status === "confirmed" && <td style={cellStyle}>—</td>}
            </tr>
            {ranked.length === 0 && (
              <tr>
                <td style={cellStyle} colSpan={currentCycle.status === "confirmed" ? 7 : 6}>
                  No proposals were submitted for this cycle.
                </td>
              </tr>
            )}
            {ranked.map((r) => (
              <tr key={r.proposal.id}>
                <td style={cellStyle}>{r.rank}</td>
                <td style={cellStyle}>
                  {r.proposal.title}
                  {r.proposal.branchId && <> · {branchNameById.get(r.proposal.branchId) ?? "—"}</>}
                </td>
                <td style={cellStyle}>{memberNameById.get(r.proposal.submittedBy) ?? "—"}</td>
                <td style={cellStyle}>{formatAmount(r.proposal.totalAmount)}</td>
                <td style={cellStyle}>
                  {r.costPerMember !== null ? formatAmount(Math.round(r.costPerMember)) : "—"}
                </td>
                <td style={cellStyle}>{formatAmount(r.runningTotal)}</td>
                {currentCycle.status === "confirmed" && (
                  <td style={cellStyle}>{confirmedIds.has(r.proposal.id) ? "Yes" : "No"}</td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {currentCycle.status === "confirmed" && (
        <>
          {currentCycle.confirmationRationale && (
            <p style={{ color: "#666" }}>
              <strong>Confirmation rationale:</strong> {currentCycle.confirmationRationale}
            </p>
          )}
          <p>
            <strong>Your contribution ask:</strong>{" "}
            {myContributionSignal !== null
              ? formatAmount(myContributionSignal)
              : "you didn't signal an amount when you voted"}
          </p>
        </>
      )}

      {currentCycle.status === "voting" && ballotOrder.length > 0 && (
        <>
          <h3>Your ranking{myVote ? " (currently submitted — resubmitting replaces it)" : ""}</h3>
          <form
            action={submitBudgetVoteAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
          >
            <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {ballotOrder.map((r) => (
              <label
                key={r.proposal.id}
                style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem", alignItems: "center" }}
              >
                <span>
                  {r.proposal.title} ({formatAmount(r.proposal.totalAmount)})
                </span>
                <input type="hidden" name="proposalId" value={r.proposal.id} />
                <select
                  name={`rank_${r.proposal.id}`}
                  defaultValue={myRankByProposalId.get(r.proposal.id) ?? ""}
                  required
                  style={{ padding: "0.3rem" }}
                >
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
            <label>
              How much would you contribute this year? (optional)
              <br />
              <input
                type="number"
                name="contributionSignal"
                min={0}
                defaultValue={myVote?.contributionSignal ?? ""}
                style={{ padding: "0.4rem" }}
              />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              {myVote ? "Update vote" : "Submit vote"}
            </button>
          </form>
        </>
      )}

      {currentCycle.status === "voting" && isOwner && (
        <>
          <h3>Confirm budget</h3>
          <form
            action={confirmBudgetCycleAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 500 }}
          >
            <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
            <input type="hidden" name="cycleScope" value={cycleScope} />
            {ranked.map((r) => (
              <label key={r.proposal.id} style={{ display: "block" }}>
                <input type="checkbox" name="confirmedProposalIds" value={r.proposal.id} />{" "}
                {r.proposal.title} ({formatAmount(r.proposal.totalAmount)})
              </label>
            ))}
            <label>
              Rationale — required only if the funded set above differs from the ranked order
              <br />
              <textarea name="confirmationRationale" rows={2} style={{ padding: "0.4rem", width: "100%" }} />
            </label>
            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Confirm budget
            </button>
          </form>
        </>
      )}
    </>
  );
}

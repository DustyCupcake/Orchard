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
  submitterName,
  suggestedMemberName,
}: {
  proposal: Proposal;
  branches: { id: string; name: string }[];
  submitterName: string;
  suggestedMemberName: string | null;
}) {
  return (
    <div
      style={{
        border: "1px solid #ccc",
        borderRadius: 6,
        padding: "0.75rem",
        marginBottom: "0.75rem",
      }}
    >
      <strong>{proposal.title}</strong>
      <div style={{ fontSize: "0.85rem", color: "#666" }}>
        Proposed by {submitterName} · {new Date(proposal.createdAt).toLocaleDateString()}
        {proposal.status !== "pending" && ` · ${proposal.status}`}
      </div>
      {proposal.description && <p style={{ fontSize: "0.9rem" }}>{proposal.description}</p>}
      {proposal.wantsToClaim && (
        <p style={{ fontSize: "0.85rem" }}>{submitterName} would like to claim this themselves.</p>
      )}
      {suggestedMemberName && (
        <p style={{ fontSize: "0.85rem" }}>
          Suggested for: {suggestedMemberName}
          {proposal.suggestedMemberNote && ` — ${proposal.suggestedMemberNote}`}
        </p>
      )}
      {proposal.status === "declined" && proposal.declineReason && (
        <p style={{ fontSize: "0.85rem", color: "#666" }}>Declined: {proposal.declineReason}</p>
      )}

      {proposal.status === "pending" && (
        <>
          <form
            action={activateProposalAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}
          >
            <input type="hidden" name="proposalId" value={proposal.id} />

            <div style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="text"
                name="title"
                defaultValue={proposal.title}
                placeholder="Title"
                style={{ padding: "0.4rem", flex: 1 }}
              />
            </div>
            <textarea
              name="description"
              defaultValue={proposal.description}
              rows={2}
              placeholder="Description"
              style={{ padding: "0.4rem" }}
            />

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <select name="branchId" required style={{ padding: "0.4rem" }}>
                <option value="">Branch…</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>

              <select name="effort" required defaultValue="one_off" style={{ padding: "0.4rem" }}>
                <option value="one_off">One-off</option>
                <option value="ongoing">Ongoing</option>
                <option value="owns_a_thing">Owns-a-thing</option>
              </select>

              <select name="duration" defaultValue="few_hours" style={{ padding: "0.4rem" }}>
                <option value="under_hour">Under an hour</option>
                <option value="few_hours">A few hours</option>
                <option value="half_day">Half a day</option>
                <option value="multi_day">Multi-day</option>
              </select>
              <span style={{ fontSize: "0.8rem", color: "#666" }}>(if one-off)</span>

              <input
                type="number"
                name="hoursPerWeek"
                placeholder="hours/week"
                min={0}
                style={{ padding: "0.4rem", width: "8rem" }}
              />
              <span style={{ fontSize: "0.8rem", color: "#666" }}>(if ongoing/owns-a-thing)</span>
            </div>

            <input
              type="text"
              name="tags"
              placeholder="tags (comma-separated)"
              style={{ padding: "0.4rem" }}
            />

            <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <label>
                Capacity:{" "}
                <input
                  type="number"
                  name="capacity"
                  placeholder="1"
                  min={1}
                  style={{ padding: "0.4rem", width: "5rem" }}
                />
              </label>
              <label>
                <input type="checkbox" name="critical" /> Critical
              </label>
            </div>

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
              <select name="openness" defaultValue="request" style={{ padding: "0.4rem" }}>
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
                style={{ padding: "0.4rem", width: "10rem" }}
              />
              <input
                type="datetime-local"
                name="browsePeriodEnd"
                style={{ padding: "0.4rem" }}
              />
              <span style={{ fontSize: "0.8rem", color: "#666" }}>(if community-endorsed)</span>
            </div>

            <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
              Activate onto the board
            </button>
          </form>

          <form
            action={declineProposalAction}
            style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}
          >
            <input type="hidden" name="proposalId" value={proposal.id} />
            <input
              type="text"
              name="reason"
              placeholder="reason (optional)"
              style={{ padding: "0.4rem", flex: 1 }}
            />
            <button type="submit">Decline</button>
          </form>
        </>
      )}
    </div>
  );
}

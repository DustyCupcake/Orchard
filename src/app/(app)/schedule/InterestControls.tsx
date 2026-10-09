import type { ProposalInterest } from "@/lib/event-scheduling";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import { setEventProposalInterestAction } from "./actions";

function counts(interest: ProposalInterest) {
  const parts: string[] = [];
  if (interest.yes > 0) parts.push(`${interest.yes} would come`);
  if (interest.maybe > 0) parts.push(`${interest.maybe} maybe`);
  return parts.length > 0 ? parts.join(" · ") : "No one has said yet";
}

/**
 * How much interest a proposal has. Everyone gets the numbers; the list of
 * who is there only when the lib returned names, which it does for the
 * proposal's submitter and the scheduling owner and nobody else.
 */
export function InterestSummary({ interest }: { interest: ProposalInterest }) {
  return (
    <div className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
      <p>{counts(interest)}</p>
      {interest.people && interest.people.length > 0 && (
        <p className="mt-0.5">
          {interest.people.map((p) => (p.level === "maybe" ? `${p.name} (maybe)` : p.name)).join(", ")}
        </p>
      )}
    </div>
  );
}

/**
 * "I'd come" / "Maybe" / withdraw, for someone else's open proposal. The
 * button for the member's current answer is the filled one; pressing it
 * again withdraws, so there's no separate "undo".
 */
export function InterestControls({ proposalId, interest }: { proposalId: string; interest: ProposalInterest }) {
  const choice = (level: "yes" | "maybe", label: string) => {
    const on = interest.mine === level;
    return (
      <button
        type="submit"
        name="level"
        value={on ? "none" : level}
        aria-pressed={on}
        className={on ? BUTTON_PRIMARY : BUTTON_SECONDARY}
      >
        {label}
      </button>
    );
  };
  return (
    <form action={setEventProposalInterestAction} className="mt-2 flex flex-wrap items-center gap-2">
      <input type="hidden" name="proposalId" value={proposalId} />
      {choice("yes", "I'd come")}
      {choice("maybe", "Maybe")}
    </form>
  );
}

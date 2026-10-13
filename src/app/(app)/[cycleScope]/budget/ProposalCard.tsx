import type { BudgetLineItem, BudgetProposalView } from "@/lib/budget";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import SelectField from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  approveBudgetProposalAction,
  closeBudgetProposalAction,
  declineBudgetProposalAction,
  supportBudgetProposalAction,
  updateBudgetProposalAction,
  withdrawBudgetProposalAction,
} from "./actions";
import { formatAmount, formatLineItemDetail } from "./format";
import LineItemsEditor from "./LineItemsEditor";

// One proposal, whatever its state: who made it and what it asks for, how much
// backing it has and what that lets the holder approve, and the controls each
// person gets. Counts are everyone's; the names behind them arrive only for the
// proposer and the budget's owner (listBudgetProposalViews decides that), so
// this component never has to.
export default function ProposalCard({
  view,
  cycleScope,
  proposerName,
  branches,
  attendeeCount,
  viewerId,
  isHolder,
  takingPart,
  inEvent,
  fromEarlierRound,
  spent,
}: {
  view: BudgetProposalView;
  cycleScope: string;
  proposerName: string;
  branches: { id: string; name: string }[];
  attendeeCount: number | null;
  viewerId: string;
  /** Owns this budget, so may approve and decline. */
  isHolder: boolean;
  /** The budget is open: an event's still running, or the community's own. */
  takingPart: boolean;
  /** An event's budget, so per-attendee items make sense. */
  inEvent: boolean;
  /** A community proposal carried over from before there were no rounds. */
  fromEarlierRound: boolean;
  /** What has been spent against it, once it is approved. */
  spent?: number;
}) {
  const { proposal, backing, supporterCount, iSupport, supporters } = view;
  const items = proposal.lineItems as BudgetLineItem[];
  const mine = proposal.submittedBy === viewerId;
  const isOpen = proposal.status === "open";
  const branchName = branches.find((b) => b.id === proposal.branchId)?.name;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {proposerName}
          {branchName && <> · {branchName}</>} · {formatAmount(proposal.totalAmount)} asked
          {fromEarlierRound && <> · from an earlier round</>}
        </p>
        {proposal.status === "approved" && <Tag tone="success">Approved</Tag>}
        {proposal.status === "declined" && <Tag tone="danger">Declined</Tag>}
        {proposal.status === "closed" && <Tag tone="neutral">Closed</Tag>}
        {proposal.status === "withdrawn" && <Tag tone="neutral">Withdrawn</Tag>}
      </div>
      <p className="mt-1 text-[length:var(--text-body)] font-medium text-[var(--text)]">{proposal.title}</p>
      {proposal.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{proposal.description}</p>}
      <ul className="mt-1.5 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {items.map((it, i) => (
          <li key={i}>
            {it.label}: {formatLineItemDetail(it, attendeeCount)}
            {it.branchId && it.branchId !== proposal.branchId && <> · {branches.find((b) => b.id === it.branchId)?.name ?? "—"}</>}
          </li>
        ))}
      </ul>

      {proposal.status === "approved" && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
          Approved for {formatAmount(proposal.approvedAmount ?? 0)}
          {proposal.approvedAmount !== null && proposal.approvedAmount < proposal.totalAmount && <> of {formatAmount(proposal.totalAmount)} asked</>}.
          {proposal.decisionNote && <span className="text-[var(--text-muted)]"> “{proposal.decisionNote}”</span>}
        </p>
      )}
      {(proposal.status === "approved" || proposal.status === "closed") && spent !== undefined && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
          Spent {formatAmount(spent)} of {formatAmount(proposal.approvedAmount ?? 0)} approved
          {proposal.status === "closed" && <span className="text-[var(--text-muted)]"> — closed, so what was left is free again</span>}
          {proposal.status === "approved" && spent > (proposal.approvedAmount ?? 0) && (
            <span className="text-[var(--danger)]"> — over what was approved</span>
          )}
        </p>
      )}
      {proposal.status === "approved" && isHolder && (
        <form action={closeBudgetProposalAction} className="mt-2">
          <input type="hidden" name="proposalId" value={proposal.id} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <button type="submit" className={BUTTON_SECONDARY}>
            Close this proposal — it has been spent, or won&rsquo;t be
          </button>
        </form>
      )}
      {proposal.status === "declined" && proposal.decisionNote && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">Reason given: “{proposal.decisionNote}”</p>
      )}

      {isOpen && (
        <div className="mt-2 border-t border-[var(--border)] pt-2">
          <p className="text-[length:var(--text-body)] text-[var(--text)]">
            {people(backing.backers)} behind this
            {backing.backedUpTo !== null ? (
              <>
                {" "}
                — backed up to {formatAmount(Math.min(backing.backedUpTo, proposal.totalAmount))} of {formatAmount(proposal.totalAmount)} asked
                {backing.backedUpTo < proposal.totalAmount && (
                  <span className="text-[var(--text-muted)]">
                    {" "}
                    ({formatAmount(backing.perBacker!)} each; it needs {people(Math.ceil(proposal.totalAmount / backing.perBacker!))} for the whole amount)
                  </span>
                )}
              </>
            ) : (
              <span className="text-[var(--text-muted)]"> — no backing is required, so the owner decides</span>
            )}
          </p>
          {supporters && supporters.length > 0 && (
            <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">Supported by {supporters.join(", ")}.</p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {takingPart && !mine && (
              <form action={supportBudgetProposalAction}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <input type="hidden" name="supporting" value={iSupport ? "false" : "true"} />
                <button type="submit" className={iSupport ? BUTTON_SECONDARY : BUTTON_PRIMARY}>
                  {iSupport ? "Withdraw my support" : "Support this"}
                </button>
              </form>
            )}
            {mine && <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">You&rsquo;re the first person behind it.</span>}
            {takingPart && mine && (
              <form action={withdrawBudgetProposalAction}>
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <button type="submit" className={BUTTON_GHOST}>
                  Withdraw this proposal
                </button>
              </form>
            )}
          </div>

          {takingPart && isHolder && (
            <div className="mt-3 flex flex-col gap-3 rounded-[var(--radius-md)] border border-[var(--border)] p-3">
              <form action={approveBudgetProposalAction} className="flex flex-col gap-2">
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>
                    Approve for{backing.backedUpTo !== null && backing.backedUpTo < proposal.totalAmount ? " (the most that is backed so far)" : ""}
                  </span>
                  <input
                    type="number"
                    name="amount"
                    min={1}
                    max={backing.approvable}
                    defaultValue={backing.approvable}
                    className={`${INPUT} w-32`}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Note (optional)</span>
                  <input type="text" name="note" className={INPUT} />
                </label>
                <SubmitButton className={`${BUTTON_PRIMARY} w-fit`} pendingLabel="Approving…">
                  Approve
                </SubmitButton>
              </form>
              <form action={declineBudgetProposalAction} className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Or decline — say why, so the person who proposed it understands</span>
                  <input type="text" name="note" required className={INPUT} />
                </label>
                <SubmitButton className={`${BUTTON_SECONDARY} w-fit`} pendingLabel="Declining…">
                  Decline
                </SubmitButton>
              </form>
            </div>
          )}

          {takingPart && mine && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Edit</summary>
              <form action={updateBudgetProposalAction} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="proposalId" value={proposal.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <input type="text" name="title" defaultValue={proposal.title} required className={INPUT} />
                <textarea name="description" defaultValue={proposal.description ?? ""} rows={2} className={INPUT} />
                <SelectField name="branchId" defaultValue={proposal.branchId ?? ""} className={INPUT}>
                  <option value="">No branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </SelectField>
                <LineItemsEditor
                  name="lineItemsJson"
                  initialItems={items}
                  branches={branches}
                  minItems={1}
                  allowPerAttendee={inEvent}
                />
                <SubmitButton className={`${BUTTON_PRIMARY} w-fit`} pendingLabel="Saving…">
                  Save changes
                </SubmitButton>
              </form>
            </details>
          )}
        </div>
      )}
      {!isOpen && supporterCount > 0 && (
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {people(supporterCount + 1)} were behind it.
        </p>
      )}
    </div>
  );
}

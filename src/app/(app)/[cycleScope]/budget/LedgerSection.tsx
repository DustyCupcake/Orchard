import Link from "next/link";
import type { BudgetEntryView, BudgetMoney } from "@/lib/budget";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import SelectField from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  confirmEntryAction,
  recordEntryAction,
  reimburseEntryAction,
  rejectEntryAction,
  reverseEntryAction,
} from "./actions";
import { formatAmount } from "./format";

// What a negative amount looks like: a real minus sign, and money out in words.
function signed(n: number) {
  return n < 0 ? `−${formatAmount(-n)}` : formatAmount(n);
}

// The totals: open to every member, naming no one and no entry (D8). An event
// shows what came in, what went out, and the balance; the community's own budget
// shows its balance, what approved proposals still hold back, and what is free.
export function MoneyCard({ money, isCommunityBudget }: { money: BudgetMoney; isCommunityBudget: boolean }) {
  return (
    <div className={`mt-4 ${CARD}`}>
      <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Money</h3>
      {isCommunityBudget ? (
        <dl className="mt-2 grid grid-cols-3 gap-3 text-[length:var(--text-body)]">
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Balance</dt>
            <dd className="font-semibold text-[var(--text)]">{signed(money.balance)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Set aside for approved spending</dt>
            <dd className="font-semibold text-[var(--text)]">{formatAmount(money.committed)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Available</dt>
            <dd className="font-semibold text-[var(--text)]">{signed(money.available)}</dd>
          </div>
        </dl>
      ) : (
        <dl className="mt-2 grid grid-cols-3 gap-3 text-[length:var(--text-body)]">
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Came in</dt>
            <dd className="font-semibold text-[var(--text)]">{formatAmount(money.income)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Spent</dt>
            <dd className="font-semibold text-[var(--text)]">{formatAmount(money.spent)}</dd>
          </div>
          <div>
            <dt className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Balance</dt>
            <dd className="font-semibold text-[var(--text)]">{signed(money.balance)}</dd>
          </div>
        </dl>
      )}
      {money.pendingCount !== null && money.pendingCount > 0 && (
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {money.pendingCount} {money.pendingCount === 1 ? "entry is" : "entries are"} waiting for you to confirm below, and not counted yet.
        </p>
      )}
    </div>
  );
}

// "Add an expense" for a member, "Record an entry" for the budget's holder. A
// member's is always an expense they paid for, about themselves, and waits for
// the holder; the holder's is confirmed at once and can be income or, in the
// community's own budget and once, an opening balance.
export function EntryForm({
  cycleScope,
  budgetCycleId,
  isHolder,
  isCommunityBudget,
  canEnterOpeningBalance,
  approvedProposals,
  members,
  today,
  backHref,
}: {
  cycleScope: string;
  budgetCycleId: string | null;
  isHolder: boolean;
  isCommunityBudget: boolean;
  canEnterOpeningBalance: boolean;
  approvedProposals: { id: string; title: string }[];
  members: { id: string; name: string }[];
  today: string;
  backHref: string;
}) {
  return (
    <form action={recordEntryAction} className="mt-4 flex max-w-[640px] flex-col gap-3">
      <input type="hidden" name="budgetCycleId" value={budgetCycleId ?? ""} />
      <input type="hidden" name="cycleScope" value={cycleScope} />
      {isHolder ? (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What kind of entry is it?</span>
          <SelectField name="kind" defaultValue="expense" className={INPUT}>
            <option value="expense">An expense — money spent</option>
            <option value="income">Income — money received</option>
            {isCommunityBudget && canEnterOpeningBalance && <option value="opening_balance">The opening balance — what there was to start with</option>}
          </SelectField>
        </label>
      ) : (
        <>
          <input type="hidden" name="kind" value="expense" />
          <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
            Something you paid for out of your own pocket. The budget&rsquo;s owner confirms it before it counts, and marks it reimbursed once you&rsquo;ve been paid back.
          </p>
        </>
      )}
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Amount</span>
        <input type="number" name="amount" required step={1} className={`${INPUT} w-40`} />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Whole numbers, positive — the kind of entry says which way the money went.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>What was it for?</span>
        <input type="text" name="description" required className={INPUT} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Date</span>
        <input type="date" name="occurredOn" required defaultValue={today} className={`${INPUT} w-fit`} />
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Receipt or reference (optional)</span>
        <input type="text" name="receiptNote" placeholder="a shop, an invoice number, where the receipt is" className={INPUT} />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Just a note for now — there&rsquo;s no upload. Keep the receipt itself somewhere you can find it.
        </span>
      </label>
      {approvedProposals.length > 0 && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Is it part of an approved proposal? (expenses only)</span>
          <SelectField name="proposalId" defaultValue="" className={INPUT}>
            <option value="">Not tied to a proposal</option>
            {approvedProposals.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </SelectField>
        </label>
      )}
      {isHolder && (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Who paid it out of their own pocket? (expenses only)</span>
          <SelectField name="memberId" defaultValue="" className={INPUT}>
            <option value="">Nobody — it was paid from the budget</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
        </label>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
          {isHolder ? "Record entry" : "Submit expense"}
        </SubmitButton>
        <Link href={backHref} className={BUTTON_SECONDARY}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

const STATUS_TONE = { pending: "warning", confirmed: "success", rejected: "danger" } as const;

// The ledger. The budget's holder sees every entry and gets the controls; anyone
// else sees only their own, and what became of them (D8).
export function EntryList({
  entries,
  asHolder,
  cycleScope,
  proposalTitleById,
}: {
  entries: BudgetEntryView[];
  asHolder: boolean;
  cycleScope: string;
  proposalTitleById: Map<string, string>;
}) {
  if (entries.length === 0) {
    return (
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        {asHolder ? "Nothing has been recorded yet." : "You haven't added any expenses."}
      </p>
    );
  }
  return (
    <ul className="mt-2 flex flex-col gap-2">
      {entries.map(({ entry, memberName, submitterName, reversedBy }) => {
        const owed = entry.kind === "expense" && entry.status === "confirmed" && entry.memberId !== null && !entry.reimbursedAt && !reversedBy;
        const canReverse = asHolder && entry.status === "confirmed" && !entry.reversesEntryId && entry.kind !== "opening_balance" && !reversedBy;
        return (
          <li key={entry.id} className={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[length:var(--text-body)] font-semibold text-[var(--text)]">{signed(entry.amount)}</span>
              <span className="text-[length:var(--text-body)] text-[var(--text)]">{entry.description}</span>
              <Tag tone={STATUS_TONE[entry.status]}>{entry.status === "pending" ? "Waiting" : entry.status === "confirmed" ? "Counted" : "Rejected"}</Tag>
              {reversedBy && <Tag tone="neutral">Reversed</Tag>}
              {entry.reversesEntryId && <Tag tone="neutral">Reversal</Tag>}
              {owed && <Tag tone="warning">Owed to {memberName}</Tag>}
              {entry.reimbursedAt && <Tag tone="success">Paid back</Tag>}
            </div>
            <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              {entry.occurredOn}
              {entry.kind === "opening_balance" && <> · opening balance</>}
              {entry.memberId !== null && memberName && <> · paid by {memberName}</>}
              {entry.submittedBy !== entry.memberId && <> · entered by {submitterName}</>}
              {entry.proposalId && proposalTitleById.get(entry.proposalId) && <> · for “{proposalTitleById.get(entry.proposalId)}”</>}
              {entry.receiptNote && <> · {entry.receiptNote}</>}
            </p>
            {entry.decisionNote && (
              <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                {entry.status === "rejected" ? "Reason given" : "Note"}: “{entry.decisionNote}”
              </p>
            )}

            {asHolder && entry.status === "pending" && (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <form action={confirmEntryAction}>
                  <input type="hidden" name="entryId" value={entry.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Confirming…">
                    Confirm
                  </SubmitButton>
                </form>
                <form action={rejectEntryAction} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="entryId" value={entry.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>Or reject — why? (optional)</span>
                    <input type="text" name="note" className={`${INPUT} w-64`} />
                  </label>
                  <SubmitButton className={BUTTON_SECONDARY} pendingLabel="Rejecting…">
                    Reject
                  </SubmitButton>
                </form>
              </div>
            )}

            {asHolder && owed && (
              <form action={reimburseEntryAction} className="mt-2">
                <input type="hidden" name="entryId" value={entry.id} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Mark as paid back to {memberName}
                </button>
              </form>
            )}

            {canReverse && (
              <details className="mt-2">
                <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Correct this entry</summary>
                <form action={reverseEntryAction} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="entryId" value={entry.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <label className="flex flex-col gap-1">
                    <span className={LABEL}>What is being corrected?</span>
                    <input type="text" name="note" required className={`${INPUT} w-72`} />
                  </label>
                  <SubmitButton className={BUTTON_GHOST} pendingLabel="Reversing…">
                    Reverse it
                  </SubmitButton>
                  <span className="basis-full text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Entries are never edited or deleted: this adds an opposite entry that cancels it, and the original stays visible.
                  </span>
                </form>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}

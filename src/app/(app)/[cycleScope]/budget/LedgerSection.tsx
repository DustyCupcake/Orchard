import Link from "next/link";
import type { AllocationOutlook, BudgetEntryView, BudgetMoney, ContributionSummary, SettlementState } from "@/lib/budget";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag } from "@/components/ui/kit";
import SelectField from "@/components/ui/SelectField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  confirmEntryAction,
  recordEntryAction,
  reimburseEntryAction,
  rejectEntryAction,
  requestEventAllocationAction,
  reverseEntryAction,
  setContributionAskAction,
  settleEventBudgetAction,
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
            <dd className="font-semibold text-[var(--text)]">{formatAmount(money.income + money.contributed)}</dd>
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
      {money.transfers !== 0 && (
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {isCommunityBudget
            ? money.transfers < 0
              ? `${formatAmount(-money.transfers)} has gone to events from this budget, net of any surplus they returned.`
              : `${formatAmount(money.transfers)} has come back from events, net of what was allocated to them.`
            : money.transfers > 0
              ? `${formatAmount(money.transfers)} of the balance came from the community's budget.`
              : `${formatAmount(-money.transfers)} was returned to the community's budget.`}
        </p>
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
  // What can be recorded depends on who is recording and where: the owner can
  // record anything; a member an expense on an event's budget, or a contribution
  // to either budget.
  const kindOptions = [
    ...(isHolder || !isCommunityBudget
      ? [{ value: "expense", label: isHolder ? "An expense — money spent" : "An expense — something I paid for" }]
      : []),
    ...(isHolder ? [{ value: "income", label: "Income — money received" }] : []),
    { value: "contribution", label: isHolder ? "A contribution — a member paid money in" : "A contribution — money I paid in" },
    ...(isHolder && isCommunityBudget && canEnterOpeningBalance
      ? [{ value: "opening_balance", label: "The opening balance — what there was to start with" }]
      : []),
  ];

  // A member on the community's budget can only record a contribution, so
  // nothing about expenses (a proposal to tie one to) applies to their form.
  const onlyContribution = kindOptions.length === 1 && kindOptions[0].value === "contribution";

  return (
    <form action={recordEntryAction} className="mt-4 flex max-w-[640px] flex-col gap-3">
      <input type="hidden" name="budgetCycleId" value={budgetCycleId ?? ""} />
      <input type="hidden" name="cycleScope" value={cycleScope} />
      {kindOptions.length > 1 ? (
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What kind of entry is it?</span>
          <SelectField name="kind" defaultValue={kindOptions[0].value} className={INPUT}>
            {kindOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectField>
        </label>
      ) : (
        <input type="hidden" name="kind" value={kindOptions[0].value} />
      )}
      {!isHolder && (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          {isCommunityBudget
            ? "Money you've given to the community's budget."
            : "Something you paid for out of your own pocket, or money you've paid in."}{" "}
          The budget&rsquo;s owner confirms it before it counts{isCommunityBudget ? "" : ", and marks an expense paid back once you've been reimbursed"}.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className={LABEL}>Amount</span>
        <input type="number" name="amount" required step={1} className={`${INPUT} w-40`} />
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Whole numbers, positive — the kind of entry says which way the money went.
        </span>
      </label>
      <label className="flex flex-col gap-1">
        <span className={LABEL}>What was it for? (optional for a contribution)</span>
        {/* Not `required`: a contribution may leave it blank (it becomes "Contribution"); the server asks for it for everything else. */}
        <input type="text" name="description" className={INPUT} />
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
      {approvedProposals.length > 0 && !onlyContribution && (
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
          <span className={LABEL}>Who paid it? (an expense paid out of pocket, or a contribution)</span>
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
          {isHolder ? "Record entry" : onlyContribution ? "Submit contribution" : "Submit"}
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
              {entry.memberId !== null && memberName && <> · {entry.kind === "contribution" ? "paid in by" : "paid by"} {memberName}</>}
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

// What an event asked of people and has had paid in, or what has been given to
// the community's own budget (docs/plans/archive/budget-funds-plan.md 3b). The totals are
// open to every member; who paid what is the owner's, and each person's own.
export function ContributionsCard({
  summary,
  isCommunityBudget,
  ledgerHolder,
  canSetAsk,
  canRecord,
  cycleScope,
  budgetCycleId,
  recordHref,
  pledgedTotal,
}: {
  summary: ContributionSummary;
  isCommunityBudget: boolean;
  ledgerHolder: boolean;
  /** The owner, while the budget is open. */
  canSetAsk: boolean;
  canRecord: boolean;
  cycleScope: string;
  budgetCycleId: string | null;
  recordHref: string;
  pledgedTotal: number | null;
}) {
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  return (
    <div className={`mt-4 ${CARD}`}>
      <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Contributions</h3>

      {!isCommunityBudget && (
        <div className="mt-1">
          {summary.ask !== null ? (
            <p className="text-[length:var(--text-body)] text-[var(--text)]">
              Everyone is asked for about <span className="font-semibold">{formatAmount(summary.ask)}</span> — an average, not a bill: give what you can.
            </p>
          ) : (
            <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">No ask has been set for this event yet.</p>
          )}
          {canSetAsk && (
            <form action={setContributionAskAction} className="mt-2 flex flex-wrap items-end gap-2">
              <input type="hidden" name="budgetCycleId" value={budgetCycleId ?? ""} />
              <input type="hidden" name="cycleScope" value={cycleScope} />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>The ask, per person</span>
                <input
                  type="number"
                  name="contributionPerMember"
                  min={0}
                  step={1}
                  defaultValue={summary.ask ?? ""}
                  placeholder={summary.suggestedAsk !== null ? String(summary.suggestedAsk) : "Not set"}
                  className={`${INPUT} w-36`}
                />
              </label>
              <button type="submit" className={BUTTON_SECONDARY}>
                Save the ask
              </button>
              {summary.suggestedAsk !== null && summary.expectedContributors !== null && (
                <span className="basis-full text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  {summary.suggestedAsk === 0
                    ? "Income already recorded covers the plan, so nothing more is needed from members — you can still ask for something."
                    : `What is left to cover comes to about ${formatAmount(summary.suggestedAsk)} each over ${summary.expectedContributors} ${summary.expectedContributors === 1 ? "person" : "people"}.`}
                  {pledgedTotal !== null && pledgedTotal > 0 && <> {formatAmount(pledgedTotal)} has been pledged.</>} You can ask for more or less. Empty it to clear it.
                </span>
              )}
            </form>
          )}
        </div>
      )}

      <p className="mt-3 text-[length:var(--text-body)] text-[var(--text)]">
        {summary.paidIn === 0
          ? isCommunityBudget
            ? "Nothing has been given to the community's budget yet."
            : "Nothing has been paid in yet."
          : `${formatAmount(summary.paidIn)} ${isCommunityBudget ? "has been given by" : "paid in so far by"} ${people(summary.contributorCount)}.`}
        {!isCommunityBudget && summary.askedInTotal !== null && summary.askedInTotal > 0 && (
          <span className="text-[var(--text-muted)]"> If everyone paid the ask it would come to {formatAmount(summary.askedInTotal)}.</span>
        )}
      </p>

      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
        {summary.mine.paid === 0 && summary.mine.waiting === 0
          ? "You haven't paid anything in."
          : `You've paid ${formatAmount(summary.mine.paid)}${summary.mine.waiting > 0 ? `, and ${formatAmount(summary.mine.waiting)} is waiting for the owner to confirm` : ""}.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {canRecord && (
          <Link href={recordHref} className={BUTTON_SECONDARY}>
            {ledgerHolder ? "Record a contribution" : "I've paid something in"}
          </Link>
        )}
        <Link href="/budget/contributions" className={BUTTON_GHOST}>
          All my contributions
        </Link>
      </div>

      {ledgerHolder && summary.members && summary.members.length > 0 && (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className={LABEL}>Who has paid</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            {summary.members.map((m) => (
              <li key={m.memberId}>
                {m.name}: {formatAmount(m.paid)}
                {m.waiting > 0 && <> ({formatAmount(m.waiting)} waiting)</>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Asking the community's budget for what an event's own ask and income don't
// cover (docs/plans/archive/budget-funds-plan.md D9). The request is a proposal the
// community backs, and the people coming to the event count as behind it, so a
// request a well-attended event can cover on its own reaches the community
// budget's holder without anyone having to be asked.
export function FundingCard({
  outlook,
  isHolder,
  cycleScope,
  budgetCycleId,
}: {
  outlook: AllocationOutlook;
  isHolder: boolean;
  cycleScope: string;
  budgetCycleId: string;
}) {
  if (!isHolder && !outlook.open && !outlook.latest) return null;
  const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;
  return (
    <div className={`mt-4 ${CARD}`}>
      <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Funding from the community&rsquo;s budget</h3>

      {isHolder && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Whatever the ask and the income don&rsquo;t cover can be requested from the community&rsquo;s budget. It&rsquo;s a proposal the community backs, and
          everyone coming to the event counts as behind it.
        </p>
      )}

      {outlook.open && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
          A request for <span className="font-semibold">{formatAmount(outlook.open.proposal.totalAmount)}</span> is waiting for backing and a decision:{" "}
          {people(outlook.open.backing.backers)} behind it
          {outlook.open.comingCount > 0 && <> ({outlook.open.comingCount} coming, {outlook.open.supporterCount} supporting)</>}
          {outlook.open.backing.backedUpTo !== null && <>, backed up to {formatAmount(Math.min(outlook.open.backing.backedUpTo, outlook.open.proposal.totalAmount))}</>}.{" "}
          <Link href="/budget/fund" className="text-[var(--accent-1)] underline">
            See it in the community&rsquo;s budget
          </Link>
          .
        </p>
      )}

      {outlook.latest && !outlook.open && (
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
          {outlook.latest.status === "approved" ? (
            <>
              The last request was approved for <span className="font-semibold">{formatAmount(outlook.latest.approved ?? 0)}</span>
              {(outlook.latest.approved ?? 0) < outlook.latest.requested && <> of {formatAmount(outlook.latest.requested)} asked, so the rest has to come from the ask or elsewhere</>}.
            </>
          ) : (
            <>The last request for {formatAmount(outlook.latest.requested)} was declined{outlook.latest.note && <>: “{outlook.latest.note}”</>}.</>
          )}
        </p>
      )}

      {isHolder && (
        <>
          <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
            Plan {formatAmount(outlook.planTotal)}
            {outlook.askedInTotal !== null && <> − asked of members {formatAmount(outlook.askedInTotal)}</>} − income {formatAmount(outlook.income)}
            {outlook.allocated > 0 && <> − already allocated {formatAmount(outlook.allocated)}</>} ={" "}
            <span className="font-semibold text-[var(--text)]">{formatAmount(outlook.shortfall)}</span> still uncovered.
          </p>
          {outlook.canRequest ? (
            <form action={requestEventAllocationAction} className="mt-2">
              <input type="hidden" name="budgetCycleId" value={budgetCycleId} />
              <input type="hidden" name="cycleScope" value={cycleScope} />
              <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Requesting…">
                Request {formatAmount(outlook.shortfall)} from the community&rsquo;s budget
              </SubmitButton>
            </form>
          ) : (
            !outlook.open && outlook.reason && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">{outlook.reason}</p>
          )}
        </>
      )}
    </div>
  );
}

// Closing an event's books (D7, D14). A surplus returns to the community's budget;
// an overspend is never absorbed, and becomes a proposal the community decides.
export function SettlementCard({
  state,
  cycleScope,
  budgetCycleId,
}: {
  state: SettlementState;
  cycleScope: string;
  budgetCycleId: string;
}) {
  return (
    <div className={`mt-6 ${CARD}`}>
      <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">Settling this budget</h3>

      {state.settled && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--success)]">
          Settled — this budget&rsquo;s books are closed
          {state.unrecovered > 0 ? (
            <span className="text-[var(--text)]">
              , with an overspend of {formatAmount(state.unrecovered)} that the community&rsquo;s budget did not cover. It stays on the books as unrecovered.
            </span>
          ) : (
            "."
          )}{" "}
          <span className="text-[var(--text-muted)]">Closing the event won&rsquo;t warn about it.</span>
        </p>
      )}

      {!state.settled && state.awaiting && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
          This event overspent by <span className="font-semibold">{formatAmount(state.awaiting.amount)}</span>. The community&rsquo;s budget has been asked to cover
          it, and the books stay open until it decides.{" "}
          <Link href="/budget/fund" className="text-[var(--accent-1)] underline">
            See the request
          </Link>
          .
        </p>
      )}

      {!state.settled && !state.awaiting && state.canSettle && (
        <form action={settleEventBudgetAction} className="mt-1">
          <input type="hidden" name="budgetCycleId" value={budgetCycleId} />
          <input type="hidden" name="cycleScope" value={cycleScope} />
          <p className="mb-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Settling closes this budget&rsquo;s books: it stops taking proposals and entries, and closing the event won&rsquo;t warn about it.{" "}
            {state.balance > 0
              ? `It holds ${formatAmount(state.balance)}, which returns to the community's budget.`
              : state.balance < 0
                ? `It is overspent by ${formatAmount(-state.balance)}, so the community will be asked whether to cover it — the books stay open until it decides.`
                : "Nothing is left over."}
          </p>
          <SubmitButton className={BUTTON_SECONDARY} pendingLabel="Settling…">
            Settle this budget
          </SubmitButton>
        </form>
      )}

      {!state.settled && !state.awaiting && !state.canSettle && (
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Not settled yet. The budget&rsquo;s owner settles it, or, once the event has closed, the community budget&rsquo;s owner can.
        </p>
      )}
    </div>
  );
}

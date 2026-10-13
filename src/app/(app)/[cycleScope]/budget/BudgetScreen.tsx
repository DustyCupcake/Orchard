import { eq } from "drizzle-orm";
import { getViewerClock } from "@/lib/view-clock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  ensureEventBudget,
  getBudgetMoney,
  getBudgetPledges,
  getEventPlan,
  isBudgetOwner,
  listBudgetEntries,
  listBudgetProposalViews,
} from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";
import { resolveSingleCycleScope } from "@/lib/cycles";
import { effectiveTimeZone, localInputFromInstant } from "@/lib/dates";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { SubmitButton } from "@/components/ui/SubmitButton";
import SelectField from "@/components/ui/SelectField";
import {
  markBudgetCycleDoneAction,
  setBudgetPledgeAction,
  submitBudgetProposalAction,
  updateBudgetCycleAction,
} from "./actions";
import { budgetByBranch, formatAmount, formatLineItemDetail } from "./format";
import { EntryForm, EntryList, MoneyCard } from "./LedgerSection";
import LineItemsEditor from "./LineItemsEditor";
import { budgetPath, COMMUNITY_BUDGET_SCOPE } from "./paths";
import ProposalCard from "./ProposalCard";

export const dynamic = "force-dynamic";

// datetime-local wants "YYYY-MM-DDTHH:mm" with no offset. The deadline is
// typed on the event's clock, so the field is filled in on that clock too —
// not the server's.
function toDatetimeLocal(date: Date, timeZone: string) {
  return localInputFromInstant(date.toISOString(), timeZone);
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

function SubHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-[length:var(--text-heading)] font-medium text-[var(--text)]">{children}</h3>;
}

export type BudgetSearchParams = {
  error?: string;
  submitted?: string;
  updated?: string;
  withdrawn?: string;
  approved?: string;
  declined?: string;
  pledged?: string;
  cycleUpdated?: string;
  markedDone?: string;
  recorded?: string;
  entryConfirmed?: string;
  entryRejected?: string;
  entryReversed?: string;
  reimbursed?: string;
  proposalClosed?: string;
  // Opens a form in place of the page body — the header's primary action, the
  // same `?compose=` technique /schedule and /calendar use. "proposal" is
  // anyone's; "entry" is an expense (a member's) or an entry (the holder's).
  compose?: string;
};

const NOTICES: [keyof BudgetSearchParams, string][] = [
  ["submitted", "Proposal submitted."],
  ["updated", "Proposal updated."],
  ["withdrawn", "Proposal withdrawn."],
  ["approved", "Proposal approved."],
  ["declined", "Proposal declined."],
  ["pledged", "Your pledge was saved."],
  ["cycleUpdated", "Budget updated."],
  ["markedDone", "Marked done — closing this event won’t warn about Budget."],
  ["recorded", "Entry saved."],
  ["entryConfirmed", "Entry confirmed — it counts now."],
  ["entryRejected", "Entry rejected."],
  ["entryReversed", "Entry reversed — an opposite entry cancels it, and the original stays visible."],
  ["reimbursed", "Marked as paid back."],
  ["proposalClosed", "Proposal closed — what was left of it is free again."],
];

// See docs/spec.md's Budget and docs/plans/budget-funds-plan.md: proposals are
// always open, in an event's budget and in the community's own; members back
// them, and the holder of the budget approves up to what the backers cover. An
// event's plan is its fixed costs plus what has been approved.
//
// Moved under /[cycleScope]/ in Phase 65 — Budget is the one
// single-owner-per-cycle page that phase touches, so it needs a real "which
// cycle?" prompt when the aggregate scope is genuinely ambiguous. The
// community's own budget is the same screen at /budget/fund.
//
// `cycleScope` is the URL's scope segment — `active`, a real event id, or
// COMMUNITY_BUDGET_SCOPE for the community's own budget.
export default async function BudgetScreen({
  cycleScope,
  searchParams,
}: {
  cycleScope: string;
  searchParams: BudgetSearchParams;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const clock = await getViewerClock();
  const { error, compose } = searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "budget");

  // Resolve the URL's exact view scope. A concrete Cycle id is looked up
  // in the actor's Community by resolveSingleCycleScope; the aggregate
  // "active" segment resolves to its one candidate or falls back to the
  // community's own budget when there is no active Cycle; and the
  // community's own page names itself. The displayed Budget is always
  // selected by that exact scope.
  const isCommunityPage = cycleScope === COMMUNITY_BUDGET_SCOPE;
  const resolution =
    moduleOn && !isCommunityPage ? await resolveSingleCycleScope(viewing, cycleScope) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader title="Budget" description="Several events are running at once — pick the one whose budget you want to see." />
        <div className="flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <Link key={c.id} href={`/${c.id}/budget`} className={BUTTON_SECONDARY}>
              {c.name}
            </Link>
          ))}
          <Link href={budgetPath(COMMUNITY_BUDGET_SCOPE)} className={BUTTON_GHOST}>
            Community budget
          </Link>
        </div>
      </main>
    );
  }
  const resolvedCycleId = resolution.kind === "resolved" ? resolution.cycle.id : null;
  const isCommunityBudget = resolvedCycleId === null;
  const eventName = resolution.kind === "resolved" ? resolution.cycle.name : null;
  // The clock the deadline is typed on — the event's, else the community's.
  const eventClock = effectiveTimeZone(resolution.kind === "resolved" ? resolution.cycle : null, communityRow);
  const backHref = budgetPath(cycleScope);

  // An event's budget is made with it. One that predates that, or whose
  // creation hiccuped, is made here on first visit (ensureEventBudget is
  // idempotent and safe under concurrent first visits). A closed event with
  // none is not backfilled: it never had one to keep. The community's own
  // budget has no row at all — it is just its proposals.
  const currentCycle = moduleOn && resolvedCycleId ? await ensureEventBudget(viewing, resolvedCycleId) : null;
  const hasBudget = moduleOn && (isCommunityBudget || currentCycle !== null);
  const finished = currentCycle?.status === "confirmed";
  const eventClosed = resolution.kind === "resolved" && Boolean(resolution.cycle.closedAt);
  const takingPart = hasBudget && !finished && !eventClosed;

  const [branches, proposalViews, plan, pledges, isHolder, allMembers, money, ledger] = await Promise.all([
    moduleOn ? listBranches(viewing) : Promise.resolve([]),
    hasBudget ? listBudgetProposalViews(viewing, resolvedCycleId) : Promise.resolve([]),
    currentCycle ? getEventPlan(viewing, currentCycle.id) : Promise.resolve(null),
    currentCycle ? getBudgetPledges(viewing, currentCycle.id) : Promise.resolve(null),
    hasBudget ? isBudgetOwner(viewing, { cycleId: resolvedCycleId }) : Promise.resolve(false),
    hasBudget ? db.select().from(member).where(eq(member.communityId, viewing.communityId)) : Promise.resolve([]),
    hasBudget ? getBudgetMoney(viewing, currentCycle?.id ?? null) : Promise.resolve(null),
    hasBudget ? listBudgetEntries(viewing, currentCycle?.id ?? null) : Promise.resolve(null),
  ]);
  // Money is the grant's holder's and nobody else's: `isHolder` above says who
  // may decide proposals (an open Budget module makes that everyone), while
  // `ledgerHolder` says who actually holds the grant and so confirms, and sees,
  // everyone's entries.
  const ledgerHolder = ledger?.asHolder ?? false;
  const memberNameById = new Map(allMembers.map((m) => [m.id, m.name] as const));
  const branchNameById = new Map(branches.map((b) => [b.id, b.name] as const));
  const attendeeCount = plan?.attendeeCount ?? null;

  const open = proposalViews.filter((v) => v.proposal.status === "open");
  const approved = proposalViews.filter((v) => v.proposal.status === "approved");
  // Closed, declined and withdrawn proposals stay on the page, folded away. A
  // closed one was approved and still counts toward the plan: closing only
  // releases what was not spent.
  const settled = proposalViews.filter((v) => ["closed", "declined", "withdrawn"].includes(v.proposal.status));
  const decidedInFavour = proposalViews.filter((v) => v.proposal.status === "approved" || v.proposal.status === "closed");
  const approvedTotal = decidedInFavour.reduce((sum, v) => sum + (v.proposal.approvedAmount ?? 0), 0);

  const fixedCosts = (currentCycle?.fixedCosts as BudgetLineItem[] | undefined) ?? [];
  const branchTotals = budgetByBranch(
    fixedCosts,
    decidedInFavour.map((v) => ({
      branchId: v.proposal.branchId,
      lineItems: v.proposal.lineItems as BudgetLineItem[],
      totalAmount: v.proposal.totalAmount,
      approvedAmount: v.proposal.approvedAmount,
    })),
    attendeeCount,
  );

  // A set deadline stops new proposals after it, though members can still back
  // and the owner still decide what is there.
  const deadlinePassed = Boolean(currentCycle?.proposalDeadline && new Date() > new Date(currentCycle.proposalDeadline));
  const canPropose = takingPart && !deadlinePassed;
  // An event takes an expense from any member; the community's own budget takes
  // entries only from its holder.
  const canRecord = takingPart && (!isCommunityBudget || ledgerHolder);
  const composing =
    compose === "proposal" && canPropose
      ? ("proposal" as const)
      : compose === "entry" && canRecord
        ? ("entry" as const)
        : null;
  const entryLabel = ledgerHolder ? "Record an entry" : "Add an expense";
  const approvedProposals = approved.map((v) => ({ id: v.proposal.id, title: v.proposal.title }));
  const proposalTitleById = new Map(approvedProposals.map((p) => [p.id, p.title] as const));
  const hasOpeningBalance = (ledger?.entries ?? []).some((e) => e.entry.kind === "opening_balance");
  const spentByProposal = new Map((money?.proposals ?? []).map((p) => [p.proposalId, p.spent] as const));

  const headerAction = composing ? undefined : (
    <>
      {moduleOn && isCommunityBudget && (
        <Link href="/budget" className={BUTTON_GHOST}>
          Event budgets
        </Link>
      )}
      {moduleOn && !isCommunityBudget && (
        <Link href={budgetPath(COMMUNITY_BUDGET_SCOPE)} className={BUTTON_GHOST}>
          Community budget
        </Link>
      )}
      {canRecord && (
        <Link href={`${backHref}?compose=entry`} className={BUTTON_SECONDARY}>
          {entryLabel}
        </Link>
      )}
      {canPropose && (
        <Link href={`${backHref}?compose=proposal`} className={BUTTON_PRIMARY}>
          Propose spending
        </Link>
      )}
    </>
  );

  const headerDescription = !moduleOn
    ? undefined
    : composing === "entry"
      ? isCommunityBudget
        ? "Money that has actually come in or gone out of the community's own budget"
        : ledgerHolder
          ? `Money that has actually come in or gone out of ${currentCycle?.title}`
          : `An expense you paid for, for ${currentCycle?.title}`
    : composing
      ? isCommunityBudget
        ? "Proposing spending from the community's own budget"
        : `Proposing spending in ${currentCycle?.title}`
      : isCommunityBudget
        ? "The community's own budget, outside any event. Anyone can propose spending; other members back it, and the budget's owner approves what has been backed."
        : eventName
          ? `${eventName}. Anyone can propose spending; other members back it, and the budget's owner approves what has been backed.`
          : undefined;

  const cardProps = {
    cycleScope,
    branches,
    attendeeCount,
    viewerId: viewing.id,
    isHolder,
    takingPart,
    inEvent: !isCommunityBudget,
  };
  const spentFor = (id: string) => spentByProposal.get(id) ?? 0;
  const renderCard = (v: (typeof proposalViews)[number]) => (
    <ProposalCard
      key={v.proposal.id}
      view={v}
      proposerName={memberNameById.get(v.proposal.submittedBy) ?? "—"}
      fromEarlierRound={isCommunityBudget && v.proposal.budgetCycleId !== null}
      spent={v.proposal.status === "approved" || v.proposal.status === "closed" ? spentFor(v.proposal.id) : undefined}
      {...cardProps}
    />
  );

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title={composing === "entry" ? entryLabel : composing ? "Propose spending" : isCommunityBudget ? "Community budget" : "Budget"}
        description={headerDescription}
        actions={headerAction}
      />

      {!moduleOn && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under
          Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}
          {NOTICES.map(
            ([key, text]) =>
              searchParams[key] && (
                <div key={key} className="mt-4">
                  <Banner tone="success">{text}</Banner>
                </div>
              ),
          )}

          {!hasBudget && (
            <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
              This event has no budget — it was closed before it had one, so there is none to keep.
            </p>
          )}

          {composing === "entry" && (
            <section>
              <div className="flex items-center justify-end">
                <Link href={backHref} className={BUTTON_GHOST}>
                  Cancel
                </Link>
              </div>
              <EntryForm
                cycleScope={cycleScope}
                budgetCycleId={currentCycle?.id ?? null}
                isHolder={ledgerHolder}
                isCommunityBudget={isCommunityBudget}
                canEnterOpeningBalance={!hasOpeningBalance}
                approvedProposals={approvedProposals}
                members={allMembers.map((m) => ({ id: m.id, name: m.name }))}
                today={new Date().toISOString().slice(0, 10)}
                backHref={backHref}
              />
            </section>
          )}

          {composing === "proposal" && (
            <section>
              <div className="flex items-center justify-between">
                <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
                  You&rsquo;re proposing this as {viewing.name}, so you&rsquo;re the first person behind it.{" "}
                  {currentCycle?.proposalDeadline
                    ? `Proposals close ${clock.deadline(currentCycle.proposalDeadline)}.`
                    : isCommunityBudget
                      ? ""
                      : "Proposals stay open until the owner finishes the budget."}
                </p>
                <Link href={backHref} className={BUTTON_GHOST}>
                  Cancel
                </Link>
              </div>
              <form action={submitBudgetProposalAction} className="mt-4 flex max-w-[640px] flex-col gap-3">
                <input type="hidden" name="budgetCycleId" value={currentCycle?.id ?? ""} />
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Title</span>
                  <input type="text" name="title" required className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Description (optional)</span>
                  <textarea name="description" rows={3} className={INPUT} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Branch (optional)</span>
                  <SelectField name="branchId" defaultValue="" className={INPUT}>
                    <option value="">No branch</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </SelectField>
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    The default for the whole proposal — a line item below can pick a different one.
                  </span>
                </label>
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>What would the money go on?</span>
                  <LineItemsEditor
                    name="lineItemsJson"
                    initialItems={[]}
                    branches={branches}
                    minItems={1}
                    allowPerAttendee={!isCommunityBudget}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Submitting…">
                    Submit proposal
                  </SubmitButton>
                  <Link href={backHref} className={BUTTON_SECONDARY}>
                    Cancel
                  </Link>
                </div>
              </form>
            </section>
          )}

          {!composing && hasBudget && (
            <section className="mt-6">
              {currentCycle && (
                <>
                  <div className="flex items-center gap-2">
                    <SectionHeading>{currentCycle.title}</SectionHeading>
                    <Tag tone={finished ? "success" : "neutral"}>{finished ? "Done" : "Open"}</Tag>
                  </div>
                  <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                    {currentCycle.proposalDeadline
                      ? `Proposals close ${clock.deadline(currentCycle.proposalDeadline)}${deadlinePassed ? " — closed to new proposals" : ""}`
                      : "Proposals stay open until the owner finishes the budget"}
                    <br />
                    Budget authority is configured separately under Settings → Access &amp; permissions.
                  </p>
                </>
              )}

              {currentCycle && plan && (
                <div className={`mt-4 ${CARD}`}>
                  <h3 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">The plan so far</h3>
                  <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
                    {formatAmount(plan.fixedTotal)} fixed costs + {formatAmount(plan.approvedTotal)} approved ={" "}
                    <span className="font-semibold">{formatAmount(plan.planTotal)}</span>
                  </p>
                  {plan.perMember !== null && plan.planTotal > 0 && (
                    <p className="mt-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      About {formatAmount(plan.perMember)} each over {plan.contributorCount}{" "}
                      {plan.attendeeCount && plan.attendeeCount > 0 ? "people coming" : "members"}.
                    </p>
                  )}
                  {plan.pendingCount > 0 && (
                    <p className="mt-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      {plan.pendingCount} proposal{plan.pendingCount === 1 ? "" : "s"} still waiting for a decision, asking{" "}
                      {formatAmount(plan.pendingTotal)} between them.
                    </p>
                  )}
                  {pledges && (
                    <div className="mt-3 border-t border-[var(--border)] pt-3">
                      <p className="text-[length:var(--text-body)] text-[var(--text)]">
                        {pledges.count === 0
                          ? "Nobody has said what they'd contribute yet."
                          : pledges.count === 1
                            ? `1 person has pledged ${formatAmount(pledges.total)}.`
                            : `${pledges.count} people have pledged ${formatAmount(pledges.total)} between them.`}
                      </p>
                      {takingPart && (
                        <form action={setBudgetPledgeAction} className="mt-2 flex flex-wrap items-end gap-2">
                          <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                          <input type="hidden" name="cycleScope" value={cycleScope} />
                          <label className="flex flex-col gap-1">
                            <span className={LABEL}>How much would you contribute?</span>
                            <input
                              type="number"
                              name="amount"
                              min={0}
                              defaultValue={pledges.mine ?? ""}
                              placeholder="Not pledged"
                              className={`${INPUT} w-36`}
                            />
                          </label>
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Save
                          </button>
                          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            Only you and the owner see what you put. Empty it to take it back.
                          </span>
                        </form>
                      )}
                      {pledges.entries && pledges.entries.length > 0 && (
                        <ul className="mt-2 flex flex-col gap-0.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                          {pledges.entries.map((p) => (
                            <li key={p.memberId}>
                              {p.name}: {formatAmount(p.amount)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </div>
              )}

              {money && <MoneyCard money={money} isCommunityBudget={isCommunityBudget} />}

              {currentCycle && isHolder && !finished && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                    Edit title / fixed costs / deadline
                  </summary>
                  <form action={updateBudgetCycleAction} className="mt-2 flex max-w-[640px] flex-col gap-2">
                    <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                    <input type="hidden" name="cycleScope" value={cycleScope} />
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Title</span>
                      <input type="text" name="title" defaultValue={currentCycle.title} className={INPUT} />
                    </label>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>Fixed costs</span>
                      <LineItemsEditor name="fixedCostsJson" initialItems={fixedCosts} branches={branches} />
                    </div>
                    <div className="flex flex-col gap-1">
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Proposals close (optional), {eventClock}</span>
                        <input
                          type="datetime-local"
                          name="proposalDeadline"
                          defaultValue={
                            currentCycle.proposalDeadline
                              ? toDatetimeLocal(new Date(currentCycle.proposalDeadline), eventClock)
                              : ""
                          }
                          className={`${INPUT} w-fit`}
                        />
                      </label>
                      <CheckField
                        label="No deadline — keep proposals open until the owner finishes the budget"
                        name="noDeadline"
                        defaultChecked={!currentCycle.proposalDeadline}
                      />
                    </div>
                    <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                      Save changes
                    </button>
                  </form>
                </details>
              )}

              {currentCycle && (
                <>
                  <SubHeading>
                    Fixed costs {fixedCosts.length > 0 && <>({formatAmount(plan?.fixedTotal ?? 0)} total)</>}
                  </SubHeading>
                  {fixedCosts.length === 0 && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">None entered.</p>}
                  {fixedCosts.length > 0 && (
                    <ul className="mt-1 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
                      {fixedCosts.map((c, i) => (
                        <li key={i}>
                          {c.label}: {formatLineItemDetail(c, attendeeCount)}
                          {c.branchId && <> · {branchNameById.get(c.branchId) ?? "—"}</>}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}

              {branchTotals.size > 0 && decidedInFavour.length + fixedCosts.length > 0 && (
                <>
                  <SubHeading>Planned, by branch</SubHeading>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text)]">
                    {[...branchTotals.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([branchId, total]) => (
                        <li key={branchId ?? "unassigned"}>
                          {branchId ? (branchNameById.get(branchId) ?? "—") : "Unassigned"}: {formatAmount(total)}
                        </li>
                      ))}
                  </ul>
                </>
              )}

              {isCommunityBudget && decidedInFavour.length > 0 && (
                <p className="mt-4 text-[length:var(--text-body)] text-[var(--text)]">
                  Approved so far: <span className="font-semibold">{formatAmount(approvedTotal)}</span>
                </p>
              )}

              <SubHeading>Waiting for a decision ({open.length})</SubHeading>
              {open.length === 0 && (
                <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                  Nothing is waiting.
                  {canPropose && (
                    <>
                      {" "}
                      <Link href={`${backHref}?compose=proposal`} className="text-[var(--accent-1)] underline">
                        Propose something
                      </Link>
                      .
                    </>
                  )}
                </p>
              )}
              <div className="mt-2 flex flex-col gap-2">{open.map(renderCard)}</div>

              {approved.length > 0 && (
                <>
                  <SubHeading>Approved ({approved.length})</SubHeading>
                  <div className="mt-2 flex flex-col gap-2">{approved.map(renderCard)}</div>
                </>
              )}

              {settled.length > 0 && (
                <details className="mt-6">
                  <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">
                    Closed, declined and withdrawn ({settled.length})
                  </summary>
                  <div className="mt-2 flex flex-col gap-2">{settled.map(renderCard)}</div>
                </details>
              )}

              {ledger && (ledgerHolder || ledger.entries.length > 0 || (!isCommunityBudget && takingPart)) && (
                <>
                  <SubHeading>{ledgerHolder ? "Money in and out" : "Your expenses"}</SubHeading>
                  <EntryList
                    entries={ledger.entries}
                    asHolder={ledgerHolder}
                    cycleScope={cycleScope}
                    proposalTitleById={proposalTitleById}
                  />
                </>
              )}

              {currentCycle && isHolder && !currentCycle.ownerMarkedDoneAt && (
                <form action={markBudgetCycleDoneAction} className="mt-6 border-t border-[var(--border)] pt-4">
                  <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                  <input type="hidden" name="cycleScope" value={cycleScope} />
                  <p className="mb-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                    When the plan is settled, mark the budget done.{finished ? "" : " It stops taking proposals and can’t be edited any more, and"}{" "}
                    closing the event won&rsquo;t warn about it.
                  </p>
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Mark this budget done
                  </button>
                </form>
              )}
              {currentCycle?.ownerMarkedDoneAt && (
                <p className="mt-6 text-[length:var(--text-body)] text-[var(--success)]">
                  Marked done — closing this event won&rsquo;t warn about its Budget.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

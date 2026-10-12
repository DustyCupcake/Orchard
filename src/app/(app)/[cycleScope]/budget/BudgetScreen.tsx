import { eq } from "drizzle-orm";
import { getViewerClock } from "@/lib/view-clock";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, requireAdmins } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  ensureEventBudget,
  getBudgetCycleAttendeeCount,
  getBudgetCycleForScope,
  getBudgetVotingView,
  isBudgetOwner,
  lineItemTotal,
  listBudgetProposals,
  sumLineItems,
} from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";
import { resolveSingleCycleScope } from "@/lib/cycles";
import { effectiveTimeZone, localInputFromInstant } from "@/lib/dates";
import { ForbiddenError } from "@/lib/errors";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag, type Tone } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  closeProposalsToVotingAction,
  createBudgetCycleAction,
  markBudgetCycleDoneAction,
  submitBudgetProposalAction,
  updateBudgetCycleAction,
  updateBudgetProposalAction,
} from "./actions";
import BudgetVotingSection from "./BudgetVotingSection";
import { budgetPath, COMMUNITY_BUDGET_SCOPE } from "./paths";
import LineItemsEditor from "./LineItemsEditor";
import SelectField from "@/components/ui/SelectField";

export const dynamic = "force-dynamic";

function formatAmount(n: number) {
  return n.toLocaleString();
}

// "8 × 50 = 400" / "23 attendees × 10 = 230" — the per-line breakdown
// shown next to a multiplied item so the total isn't a mystery. A
// plain (non-multiplied) item just shows its amount, unchanged from
// before this existed. branchNameById is only passed once a Branch on
// the item actually differs from something worth calling out — see
// callers below.
function formatLineItemDetail(item: BudgetLineItem, attendeeCount: number | null) {
  const total = lineItemTotal(item, attendeeCount);
  if (item.perAttendee) {
    return attendeeCount === null
      ? `${formatAmount(item.amount)} per attendee — no event linked, so this counts as ${formatAmount(0)} for now`
      : `${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"} × ${formatAmount(item.amount)} = ${formatAmount(total)}`;
  }
  if (item.quantity && item.quantity > 1) {
    return `${item.quantity} × ${formatAmount(item.amount)} = ${formatAmount(total)}`;
  }
  return formatAmount(item.amount);
}

// Rolls fixed costs and every given proposal's line items up by
// Branch — a line item's own branchId when it has one, else its
// parent proposal's branchId, else "unassigned" (null). Which
// proposals to include is the caller's call (see below): everything
// submitted so far while nothing's decided yet, or just the confirmed
// set once it has been.
function budgetByBranch(
  fixedCosts: BudgetLineItem[],
  proposalsForRollup: { branchId: string | null; lineItems: BudgetLineItem[] }[],
  attendeeCount: number | null,
): Map<string | null, number> {
  const totals = new Map<string | null, number>();
  const add = (branchId: string | null, amount: number) => totals.set(branchId, (totals.get(branchId) ?? 0) + amount);
  for (const item of fixedCosts) {
    add(item.branchId ?? null, lineItemTotal(item, attendeeCount));
  }
  for (const p of proposalsForRollup) {
    for (const item of p.lineItems) {
      add(item.branchId ?? p.branchId ?? null, lineItemTotal(item, attendeeCount));
    }
  }
  return totals;
}

// datetime-local wants "YYYY-MM-DDTHH:mm" with no offset. The deadline is
// typed on the event's clock, so the field is filled in on that clock too —
// not the server's.
function toDatetimeLocal(date: Date, timeZone: string) {
  return localInputFromInstant(date.toISOString(), timeZone);
}

const STATUS_LABEL: Record<string, string> = {
  proposals_open: "Proposals open",
  voting: "Voting",
  confirmed: "Confirmed",
};

const STATUS_TONE: Record<string, Tone> = {
  proposals_open: "neutral",
  voting: "warning",
  confirmed: "success",
};

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's Budget and docs/plans/development-plan.md's Phases
// 26-27: fixed costs & proposals while `proposals_open`, ranked-choice
// voting and owner confirmation once the owner closes proposals.
// Moved under /[cycleScope]/ in Phase 65 — Budget is the one
// single-owner-per-cycle page this phase touches (Event scheduling/
// Spatial planning ownership is Phase 68's job), so it needs a real
// "which cycle?" prompt when the aggregate scope is genuinely
// ambiguous. See the resolution comment below for exactly how far that
// goes and what's deliberately left untouched.
export type BudgetSearchParams = {
  error?: string;
  submitted?: string;
  updated?: string;
  cycleUpdated?: string;
  votingOpened?: string;
  voted?: string;
  confirmed?: string;
  markedDone?: string;
  // Opens a form in place of the page body — the header's primary
  // action, the same `?compose=` technique /schedule and /calendar
  // use. "proposal" is any member's; "period" is an Admin's, on the
  // community's own budget only (an event's is made with it).
  compose?: string;
};

// `cycleScope` is the URL's scope segment — `active`, a real event id, or
// COMMUNITY_BUDGET_SCOPE for the community's own budget at /budget/fund.
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

  const { error, submitted, updated, cycleUpdated, votingOpened, voted, confirmed, markedDone, compose } = searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "budget");

  let isAdminNow = false;
  try {
    await requireAdmins(viewing);
    isAdminNow = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  // Resolve the URL's exact view scope. A concrete Cycle id is looked up
  // in the actor's Community by resolveSingleCycleScope; the aggregate
  // "active" segment resolves to its one candidate or falls back to the
  // community's own budget when there is no active Cycle; and the
  // community's own page names itself. The displayed Budget is always
  // selected by that exact scope — never by the Community's most
  // recently-created row.
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
  // The clock the deadline is typed on — the event's, else the community's.
  const eventClock = effectiveTimeZone(resolution.kind === "resolved" ? resolution.cycle : null, communityRow);

  // An event's budget is made with it. One that predates that, or whose
  // creation hiccuped, is made here on first visit (ensureEventBudget is
  // idempotent and safe under concurrent first visits). A closed event with
  // none is not backfilled: it never had one to keep.
  const currentCycle = moduleOn
    ? resolvedCycleId
      ? await ensureEventBudget(viewing, resolvedCycleId)
      : await getBudgetCycleForScope(viewing, null)
    : null;
  // Only the community's own budget is ever started by hand, and only once the
  // last one is done: an event has exactly one, from the moment it exists.
  const canStartNewCycle =
    moduleOn && resolvedCycleId === null && (!currentCycle || currentCycle.status === "confirmed");
  const isOwner = currentCycle ? await isBudgetOwner(viewing, currentCycle) : false;

  const [branches, proposals, votingView, attendeeCount] = await Promise.all([
    moduleOn ? listBranches(viewing) : Promise.resolve([]),
    currentCycle && currentCycle.status === "proposals_open"
      ? listBudgetProposals(viewing, currentCycle.id)
      : Promise.resolve([]),
    currentCycle && currentCycle.status !== "proposals_open"
      ? getBudgetVotingView(viewing, currentCycle.id)
      : Promise.resolve(null),
    currentCycle ? getBudgetCycleAttendeeCount(viewing, currentCycle) : Promise.resolve(null),
  ]);
  const branchNameById = new Map(branches.map((b) => [b.id, b.name] as const));

  const memberNameById = currentCycle
    ? new Map(
        (await db.select().from(member).where(eq(member.communityId, viewing.communityId))).map(
          (m) => [m.id, m.name] as const,
        ),
      )
    : new Map<string, string>();

  const fixedCosts = (currentCycle?.fixedCosts as BudgetLineItem[] | undefined) ?? [];
  const fixedTotal = sumLineItems(fixedCosts, attendeeCount);
  const proposalsTotal = proposals.reduce(
    (sum, p) => sum + sumLineItems(p.lineItems as BudgetLineItem[], attendeeCount),
    0,
  );
  const confirmedIds = new Set((currentCycle?.confirmedProposalIds as string[] | null) ?? []);
  const myContributionSignal =
    votingView?.myVote?.contributionSignal !== undefined ? votingView?.myVote?.contributionSignal : null;

  // Confirmed cycles roll up only the funded set (the real, final
  // per-branch budget); anything still open rolls up every proposal
  // submitted so far, since nothing's been decided yet — "requested",
  // not "funded".
  const branchRollupProposals =
    currentCycle?.status === "confirmed"
      ? (votingView?.ranked ?? [])
          .filter((r) => confirmedIds.has(r.proposal.id))
          .map((r) => ({ branchId: r.proposal.branchId, lineItems: r.proposal.lineItems as BudgetLineItem[] }))
      : currentCycle?.status === "proposals_open"
        ? proposals.map((p) => ({ branchId: p.branchId, lineItems: p.lineItems as BudgetLineItem[] }))
        : (votingView?.ranked ?? []).map((r) => ({
            branchId: r.proposal.branchId,
            lineItems: r.proposal.lineItems as BudgetLineItem[],
          }));
  const branchTotals = currentCycle ? budgetByBranch(fixedCosts, branchRollupProposals, attendeeCount) : new Map();

  // What the header's primary action can open right now. A proposal needs
  // proposals to be open; a new round on the community's own budget needs an
  // Admin and no unfinished one.
  const canPropose = moduleOn && currentCycle?.status === "proposals_open";
  const canStartPeriod = moduleOn && isAdminNow && canStartNewCycle;
  const composing =
    compose === "proposal" && canPropose && currentCycle
      ? ("proposal" as const)
      : compose === "period" && canStartPeriod
        ? ("period" as const)
        : null;
  const backHref = budgetPath(cycleScope);
  // Which budget this is, so each page can point at the other.
  const isCommunityBudget = resolvedCycleId === null;
  const eventName = resolution.kind === "resolved" ? resolution.cycle.name : null;

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
      {canPropose ? (
        <Link href={`${backHref}?compose=proposal`} className={BUTTON_PRIMARY}>
          Submit a proposal
        </Link>
      ) : canStartPeriod ? (
        <Link href={`${backHref}?compose=period`} className={BUTTON_PRIMARY}>
          Open a spending round
        </Link>
      ) : null}
    </>
  );

  const headerDescription = !moduleOn
    ? undefined
    : composing === "proposal"
      ? `Submitting to ${currentCycle?.title}`
      : composing === "period"
        ? "Set up what the community is deciding on, and by when."
        : isCommunityBudget
          ? "The community's own budget, outside any event. Each event has a budget of its own."
          : eventName
            ? `${eventName}. Members propose what to spend on, everyone ranks the proposals, and the owner confirms the result.`
            : undefined;

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title={
          composing === "proposal"
            ? "Submit a proposal"
            : composing === "period"
              ? "Open a spending round"
              : isCommunityBudget
                ? "Community budget"
                : "Budget"
        }
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
          {submitted && (
            <div className="mt-4">
              <Banner tone="success">Proposal submitted.</Banner>
            </div>
          )}
          {updated && (
            <div className="mt-4">
              <Banner tone="success">Proposal updated.</Banner>
            </div>
          )}
          {cycleUpdated && (
            <div className="mt-4">
              <Banner tone="success">Budget updated.</Banner>
            </div>
          )}
          {votingOpened && (
            <div className="mt-4">
              <Banner tone="success">Proposals closed — voting is open.</Banner>
            </div>
          )}
          {voted && (
            <div className="mt-4">
              <Banner tone="success">Your vote was recorded.</Banner>
            </div>
          )}
          {confirmed && (
            <div className="mt-4">
              <Banner tone="success">Budget confirmed.</Banner>
            </div>
          )}
          {markedDone && (
            <div className="mt-4">
              <Banner tone="success">Marked done — closing this event won&rsquo;t warn about Budget.</Banner>
            </div>
          )}

          {composing === "proposal" && currentCycle && (
            <section>
              <div className="flex items-center justify-between">
                <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
                  You&rsquo;re proposing this as {viewing.name}.{" "}
                  {currentCycle.proposalDeadline
                    ? `Proposals close ${clock.deadline(currentCycle.proposalDeadline)}.`
                    : "Proposals stay open until the owner closes them."}
                </p>
                <Link href={backHref} className={BUTTON_GHOST}>
                  Cancel
                </Link>
              </div>
              <form action={submitBudgetProposalAction} className="mt-4 flex max-w-[640px] flex-col gap-3">
                <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
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
                  <LineItemsEditor name="lineItemsJson" initialItems={[]} branches={branches} minItems={1} />
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

          {composing === "period" && (
            <section>
              <div className="flex items-center justify-end">
                <Link href={backHref} className={BUTTON_GHOST}>
                  Cancel
                </Link>
              </div>
              <form action={createBudgetCycleAction} className="mt-2 flex max-w-[640px] flex-col gap-3">
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <input type="hidden" name="cycleId" value={resolvedCycleId ?? ""} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Title</span>
                  <input type="text" name="title" required className={INPUT} />
                </label>
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Fixed costs (optional)</span>
                  <LineItemsEditor name="fixedCostsJson" initialItems={[]} branches={branches} />
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Costs that are already certain, counted before any proposal.
                  </span>
                </div>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Proposals close (optional), {eventClock}</span>
                  <input type="datetime-local" name="proposalDeadline" className={`${INPUT} w-fit`} />
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Leave it empty and proposals stay open until the owner closes them.
                  </span>
                </label>
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Designate this scope&rsquo;s Budget owner under Settings → Access &amp; permissions.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Starting…">
                    Open round
                  </SubmitButton>
                  <Link href={backHref} className={BUTTON_SECONDARY}>
                    Cancel
                  </Link>
                </div>
              </form>
            </section>
          )}

          {!composing && !currentCycle && (
            <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
              {isCommunityBudget
                ? canStartPeriod
                  ? "No spending round is running. Open one to collect proposals."
                  : "No spending round is open right now. An Admin opens one when the community is ready to plan spending."
                : "This event has no budget — it was closed before it had one, so there is none to keep."}
            </p>
          )}

          {!composing && currentCycle && (
            <section className="mt-6">
              <div className="flex items-center gap-2">
                <SectionHeading>{currentCycle.title}</SectionHeading>
                <Tag tone={STATUS_TONE[currentCycle.status]}>{STATUS_LABEL[currentCycle.status] ?? currentCycle.status}</Tag>
              </div>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                {currentCycle.proposalDeadline
                  ? `Proposals close ${clock.deadline(currentCycle.proposalDeadline)}`
                  : "Proposals stay open until the owner closes them"}
                <br />
                Budget authority is configured separately under Settings → Access &amp; permissions.
              </p>

              {isOwner && currentCycle.status === "proposals_open" && (
                <details className="mt-2">
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
                        label="No deadline — keep proposals open until the owner closes them"
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

              {isOwner && currentCycle.status === "confirmed" && (
                <div className="mt-2">
                  {currentCycle.ownerMarkedDoneAt ? (
                    <p className="text-[length:var(--text-body)] text-[var(--success)]">
                      Marked done — closing this event won&rsquo;t warn about its Budget.
                    </p>
                  ) : (
                    <form action={markBudgetCycleDoneAction}>
                      <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                      <input type="hidden" name="cycleScope" value={cycleScope} />
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Mark this budget done
                      </button>
                    </form>
                  )}
                </div>
              )}

              <h3 className="mt-4 text-[length:var(--text-heading)] font-medium text-[var(--text)]">
                Fixed costs {fixedCosts.length > 0 && <>({formatAmount(fixedTotal)} total)</>}
              </h3>
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

              {branchTotals.size > 0 && (
                <>
                  <h3 className="mt-4 text-[length:var(--text-heading)] font-medium text-[var(--text)]">
                    {currentCycle.status === "confirmed" ? "Confirmed budget by branch" : "Requested so far, by branch"}
                  </h3>
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

              {currentCycle.status === "proposals_open" && (
                <>
                  <h3 className="mt-6 text-[length:var(--text-heading)] font-medium text-[var(--text)]">
                    Proposals ({proposals.length}
                    {proposals.length > 0 && <>, {formatAmount(proposalsTotal)} total</>})
                  </h3>
                  {proposals.length === 0 && (
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      None yet — be the first to{" "}
                      <Link href={`${backHref}?compose=proposal`} className="text-[var(--accent-1)] underline">
                        submit one
                      </Link>
                      .
                    </p>
                  )}
                  <div className="mt-2 flex flex-col gap-2">
                    {proposals.map((p) => {
                      const items = p.lineItems as BudgetLineItem[];
                      const liveTotal = sumLineItems(items, attendeeCount);
                      const mine = p.submittedBy === viewing.id;
                      return (
                        <div key={p.id} className={CARD}>
                          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                            {memberNameById.get(p.submittedBy) ?? "—"}
                            {p.branchId && <> · {branchNameById.get(p.branchId) ?? "—"}</>} ·{" "}
                            {formatAmount(liveTotal)} total
                          </p>
                          <p className="mt-1 text-[length:var(--text-body)] font-medium text-[var(--text)]">{p.title}</p>
                          {p.description && <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">{p.description}</p>}
                          <ul className="mt-1.5 flex flex-col gap-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">
                            {items.map((it, i) => (
                              <li key={i}>
                                {it.label}: {formatLineItemDetail(it, attendeeCount)}
                                {it.branchId && it.branchId !== p.branchId && (
                                  <> · {branchNameById.get(it.branchId) ?? "—"}</>
                                )}
                              </li>
                            ))}
                          </ul>

                          {mine && currentCycle.status === "proposals_open" && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[length:var(--text-body)] text-[var(--accent-1)]">Edit</summary>
                              <form action={updateBudgetProposalAction} className="mt-2 flex flex-col gap-2">
                                <input type="hidden" name="proposalId" value={p.id} />
                                <input type="hidden" name="cycleScope" value={cycleScope} />
                                <input type="text" name="title" defaultValue={p.title} required className={INPUT} />
                                <textarea name="description" defaultValue={p.description ?? ""} rows={2} className={INPUT} />
                                <SelectField name="branchId" defaultValue={p.branchId ?? ""} className={INPUT}>
                                  <option value="">No branch</option>
                                  {branches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.name}
                                    </option>
                                  ))}
                                </SelectField>
                                <LineItemsEditor name="lineItemsJson" initialItems={items} branches={branches} minItems={1} />
                                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                                  Save changes
                                </button>
                              </form>
                            </details>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {isOwner && (
                    <form action={closeProposalsToVotingAction} className="mt-6 border-t border-[var(--border)] pt-4">
                      <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                      <input type="hidden" name="cycleScope" value={cycleScope} />
                      <p className="mb-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
                        As owner, you decide when proposing ends. Closing it opens ranked voting and no more proposals can be added.
                      </p>
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Close proposals and open voting
                      </button>
                    </form>
                  )}
                </>
              )}

              {currentCycle.status !== "proposals_open" && votingView && (
                <BudgetVotingSection
                  currentCycle={currentCycle}
                  votingView={votingView}
                  isOwner={isOwner}
                  memberNameById={memberNameById}
                  branchNameById={branchNameById}
                  confirmedIds={confirmedIds}
                  myContributionSignal={myContributionSignal}
                  cycleScope={cycleScope}
                />
              )}
            </section>
          )}

        </>
      )}
    </main>
  );
}

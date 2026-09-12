import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member, task } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity, listBranches, requireAdmins } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  getBudgetCycleAttendeeCount,
  getBudgetVotingView,
  getCurrentBudgetCycle,
  isBudgetOwner,
  lineItemTotal,
  listBudgetProposals,
  sumLineItems,
} from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";
import { resolveSingleCycleScope } from "@/lib/cycles";
import { ForbiddenError } from "@/lib/errors";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag, type Tone } from "@/components/ui/kit";
import {
  closeProposalsToVotingAction,
  createBudgetCycleAction,
  markBudgetCycleDoneAction,
  submitBudgetProposalAction,
  updateBudgetCycleAction,
  updateBudgetProposalAction,
} from "./actions";
import BudgetVotingSection from "./BudgetVotingSection";
import LineItemsEditor from "./LineItemsEditor";

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
      ? `${formatAmount(item.amount)} per attendee — no Cycle linked, so this counts as ${formatAmount(0)} for now`
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

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not a full ISO
// string with a timezone offset — same helper .../participation/page.tsx
// already uses for its own datetime-local field.
function toDatetimeLocal(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

// See docs/spec.md's Budget and docs/development-plan.md's Phases
// 26-27: fixed costs & proposals while `proposals_open`, ranked-choice
// voting and owner confirmation once the owner closes proposals.
// Moved under /[cycleScope]/ in Phase 65 — Budget is the one
// single-owner-per-cycle page this phase touches (Event scheduling/
// Spatial planning ownership is Phase 68's job), so it needs a real
// "which cycle?" prompt when the aggregate scope is genuinely
// ambiguous. See the resolution comment below for exactly how far that
// goes and what's deliberately left untouched.
export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    updated?: string;
    cycleUpdated?: string;
    votingOpened?: string;
    voted?: string;
    confirmed?: string;
    markedDone?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { cycleScope } = await params;
  const { error, submitted, updated, cycleUpdated, votingOpened, voted, confirmed, markedDone } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "budget");

  let isAdminNow = false;
  try {
    await requireAdmins(viewing);
    isAdminNow = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  // Resolved purely to (a) prompt when the aggregate scope genuinely
  // covers 2+ open cycles, and (b) tie a *newly created* BudgetCycle to
  // the real Cycle being viewed. The BudgetCycle actually displayed
  // below still reads via the existing community-wide
  // getCurrentBudgetCycle, completely unchanged — this phase doesn't
  // touch createBudgetCycle's own "one active cycle at a time"
  // constraint, so full per-real-Cycle Budget concurrency isn't
  // guaranteed yet. With 0 or 1 open real Cycles (Cycles off entirely,
  // or just one running — by far the common case) this resolves
  // exactly as Budget has always behaved.
  const resolution = moduleOn ? await resolveSingleCycleScope(viewing, cycleScope) : ({ kind: "none" } as const);

  if (moduleOn && resolution.kind === "ambiguous") {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Budget</h1>
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">Scoped to multiple active cycles — pick one to see its budget:</p>
        <div className="mt-4 flex flex-wrap gap-2">
          {resolution.candidates.map((c) => (
            <Link key={c.id} href={`/${c.id}/budget`} className={BUTTON_SECONDARY}>
              {c.name}
            </Link>
          ))}
        </div>
      </main>
    );
  }
  const resolvedCycleId = resolution.kind === "resolved" ? resolution.cycle.id : null;

  const currentCycle = moduleOn ? await getCurrentBudgetCycle(viewing) : null;
  const canStartNewCycle = moduleOn && (!currentCycle || currentCycle.status === "confirmed");
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

  const ownerTask = currentCycle
    ? await db
        .select({ id: task.id, title: task.title })
        .from(task)
        .where(eq(task.id, currentCycle.ownerTaskId))
        .then((r) => r[0])
    : null;

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

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Budget</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
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
              <Banner tone="success">Budget cycle updated.</Banner>
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
              <Banner tone="success">Marked done — closing this cycle won&rsquo;t warn about Budget.</Banner>
            </div>
          )}

          {currentCycle && (
            <section className="mt-6">
              <div className="flex items-center gap-2">
                <SectionHeading>{currentCycle.title}</SectionHeading>
                <Tag tone={STATUS_TONE[currentCycle.status]}>{STATUS_LABEL[currentCycle.status] ?? currentCycle.status}</Tag>
              </div>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Proposal deadline {new Date(currentCycle.proposalDeadline).toLocaleString()}
                <br />
                Owner task: {ownerTask ? `"${ownerTask.title}"` : "—"} — whoever holds it is the
                budget owner.
              </p>

              {isOwner && currentCycle.status === "proposals_open" && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">
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
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Proposal deadline</span>
                      <input
                        type="datetime-local"
                        name="proposalDeadline"
                        defaultValue={toDatetimeLocal(new Date(currentCycle.proposalDeadline))}
                        className={`${INPUT} w-fit`}
                      />
                    </label>
                    <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                      Save changes
                    </button>
                  </form>
                </details>
              )}

              {isOwner && currentCycle.status === "confirmed" && (
                <div className="mt-2">
                  {currentCycle.ownerMarkedDoneAt ? (
                    <p className="text-[13px] text-[var(--success)]">
                      Marked done — closing this cycle&rsquo;s Cycle won&rsquo;t warn about Budget.
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

              <h3 className="mt-4 text-[15px] font-medium text-[var(--text)]">
                Fixed costs {fixedCosts.length > 0 && <>({formatAmount(fixedTotal)} total)</>}
              </h3>
              {fixedCosts.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None entered.</p>}
              {fixedCosts.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
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
                  <h3 className="mt-4 text-[15px] font-medium text-[var(--text)]">
                    {currentCycle.status === "confirmed" ? "Confirmed budget by branch" : "Requested so far, by branch"}
                  </h3>
                  <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-[var(--text)]">
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
                  <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">
                    Proposals ({proposals.length}
                    {proposals.length > 0 && <>, {formatAmount(proposalsTotal)} total</>})
                  </h3>
                  {proposals.length === 0 && <p className="mt-1 text-[13px] text-[var(--text-muted)]">None yet.</p>}
                  <div className="mt-2 flex flex-col gap-2">
                    {proposals.map((p) => {
                      const items = p.lineItems as BudgetLineItem[];
                      const liveTotal = sumLineItems(items, attendeeCount);
                      const mine = p.submittedBy === viewing.id;
                      return (
                        <div key={p.id} className={CARD}>
                          <p className="text-[12px] text-[var(--text-muted)]">
                            {memberNameById.get(p.submittedBy) ?? "—"}
                            {p.branchId && <> · {branchNameById.get(p.branchId) ?? "—"}</>} ·{" "}
                            {formatAmount(liveTotal)} total
                          </p>
                          <p className="mt-1 text-[14px] font-medium text-[var(--text)]">{p.title}</p>
                          {p.description && <p className="mt-1 text-[13px] text-[var(--text)]">{p.description}</p>}
                          <ul className="mt-1.5 flex flex-col gap-0.5 text-[13px] text-[var(--text-muted)]">
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
                              <summary className="cursor-pointer text-[13px] text-[var(--accent-1)]">Edit</summary>
                              <form action={updateBudgetProposalAction} className="mt-2 flex flex-col gap-2">
                                <input type="hidden" name="proposalId" value={p.id} />
                                <input type="hidden" name="cycleScope" value={cycleScope} />
                                <input type="text" name="title" defaultValue={p.title} required className={INPUT} />
                                <textarea name="description" defaultValue={p.description ?? ""} rows={2} className={INPUT} />
                                <select name="branchId" defaultValue={p.branchId ?? ""} className={INPUT}>
                                  <option value="">No branch</option>
                                  {branches.map((b) => (
                                    <option key={b.id} value={b.id}>
                                      {b.name}
                                    </option>
                                  ))}
                                </select>
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

                  <h3 className="mt-6 text-[15px] font-medium text-[var(--text)]">Submit a proposal</h3>
                  <form action={submitBudgetProposalAction} className="mt-2 flex max-w-[640px] flex-col gap-2">
                    <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                    <input type="hidden" name="cycleScope" value={cycleScope} />
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Title</span>
                      <input type="text" name="title" required className={INPUT} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Description</span>
                      <textarea name="description" rows={2} className={INPUT} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Branch (optional) — this proposal&rsquo;s default; a line item below can override it</span>
                      <select name="branchId" defaultValue="" className={INPUT}>
                        <option value="">No branch</option>
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex flex-col gap-1">
                      <span className={LABEL}>Line items</span>
                      <LineItemsEditor name="lineItemsJson" initialItems={[]} branches={branches} minItems={1} />
                    </div>
                    <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                      Submit proposal
                    </button>
                  </form>

                  {isOwner && (
                    <form action={closeProposalsToVotingAction} className="mt-6">
                      <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
                      <input type="hidden" name="cycleScope" value={cycleScope} />
                      <button type="submit" className={BUTTON_PRIMARY}>
                        Close proposals — open voting
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

          {isAdminNow && canStartNewCycle && (
            <section className="mt-8 border-t border-[var(--border)] pt-6">
              <SectionHeading>Start a new budget cycle</SectionHeading>
              <form action={createBudgetCycleAction} className="mt-3 flex max-w-[640px] flex-col gap-2">
                <input type="hidden" name="cycleScope" value={cycleScope} />
                <input type="hidden" name="cycleId" value={resolvedCycleId ?? ""} />
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Title</span>
                  <input type="text" name="title" required className={INPUT} />
                </label>
                <div className="flex flex-col gap-1">
                  <span className={LABEL}>Fixed costs (optional)</span>
                  <LineItemsEditor name="fixedCostsJson" initialItems={[]} branches={branches} />
                </div>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Proposal deadline</span>
                  <input type="datetime-local" name="proposalDeadline" required className={`${INPUT} w-fit`} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={LABEL}>Owner task ID</span>
                  <input
                    type="text"
                    name="ownerTaskId"
                    required
                    defaultValue={currentCycle?.ownerTaskId ?? ""}
                    placeholder="paste the task's ID from its /tasks/… URL"
                    className={INPUT}
                  />
                  <span className="text-[12px] text-[var(--text-muted)]">
                    Whoever holds this task is the budget owner.
                    {ownerTask && (
                      <> Pre-filled from the last cycle&rsquo;s owner task (&ldquo;{ownerTask.title}&rdquo;) — change it if that&rsquo;s not right this time.</>
                    )}
                  </span>
                </label>
                <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                  Start cycle
                </button>
              </form>
            </section>
          )}
        </>
      )}
    </main>
  );
}

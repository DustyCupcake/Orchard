import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { loginUrl } from "@/lib/login-destination";
import { getCommunity, listBranches } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { effectiveTimeZone } from "@/lib/dates";
import { ensureEventBudget, getContributionSummary, getEventPlan, isBudgetOwner } from "@/lib/budget";
import type { BudgetLineItem } from "@/lib/budget";
import { resolveSingleCycleScope } from "@/lib/cycles";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { updateBudgetCycleAction } from "../actions";
import { formatAmount, toDatetimeLocal } from "../format";
import LineItemsEditor from "../LineItemsEditor";
import { budgetPath, COMMUNITY_BUDGET_SCOPE } from "../paths";

export const dynamic = "force-dynamic";

// Configuration gets its own screen, the same way task configuration lives at
// /tasks/[id]/edit: a holder arrives here from a visible "Edit budget" button
// rather than hunting for a collapsed disclosure buried halfway down the
// overview. The form still posts to the existing Server Action, so every
// authority and validation rule is unchanged.
export default async function BudgetEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { cycleScope } = await params;
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) redirect(await loginUrl());

  const { error } = await searchParams;
  const backHref = budgetPath(cycleScope);
  const communityRow = await getCommunity(viewing);
  // The community's own budget has no fixed-cost row to edit.
  if (!isModuleEnabled(communityRow, "budget") || cycleScope === COMMUNITY_BUDGET_SCOPE) redirect(backHref);

  const resolution = await resolveSingleCycleScope(viewing, cycleScope);
  if (resolution.kind !== "resolved") redirect(backHref);
  const cycleId = resolution.cycle.id;

  const currentCycle = await ensureEventBudget(viewing, cycleId);
  const [isHolder, branches, plan, contributions] = await Promise.all([
    isBudgetOwner(viewing, { cycleId }),
    listBranches(viewing),
    currentCycle ? getEventPlan(viewing, currentCycle.id) : Promise.resolve(null),
    currentCycle ? getContributionSummary(viewing, currentCycle.id) : Promise.resolve(null),
  ]);
  // The Server Action re-checks all of this; the redirect is just so a
  // non-holder (or a finished budget) never lands on a form they can't use.
  if (!currentCycle || !isHolder || currentCycle.status !== "proposals_open") redirect(backHref);

  const fixedCosts = (currentCycle.fixedCosts as BudgetLineItem[]) ?? [];
  const eventClock = effectiveTimeZone(resolution.cycle, communityRow);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Edit budget"
        description={`${currentCycle.title} — title, fixed costs, proposal deadline and the ask. Saved changes show up on the budget overview.`}
        actions={
          <Link href={backHref} className={BUTTON_GHOST}>
            Back to budget
          </Link>
        }
      />

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      <form action={updateBudgetCycleAction} className={`mt-6 flex flex-col gap-4 ${CARD}`}>
        <input type="hidden" name="budgetCycleId" value={currentCycle.id} />
        <input type="hidden" name="cycleScope" value={cycleScope} />
        <input type="hidden" name="returnTo" value="edit" />

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Budget title</span>
          <input type="text" name="title" required defaultValue={currentCycle.title} className={INPUT} />
        </label>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Fixed costs</span>
          <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            The non-negotiable floor. Each line is a whole number, optionally multiplied by a fixed quantity or by the
            people coming — the running total updates as you edit.
          </p>
          <LineItemsEditor
            name="fixedCostsJson"
            initialItems={fixedCosts}
            branches={branches}
            attendeeCount={plan?.attendeeCount ?? null}
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className={LABEL}>Proposals close (optional), {eventClock}</span>
          <input
            type="datetime-local"
            name="proposalDeadline"
            defaultValue={currentCycle.proposalDeadline ? toDatetimeLocal(new Date(currentCycle.proposalDeadline), eventClock) : ""}
            className={`${INPUT} w-fit`}
          />
          <CheckField
            label="No deadline — keep proposals open until the owner finishes the budget"
            name="noDeadline"
            defaultChecked={!currentCycle.proposalDeadline}
          />
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            A deadline stops <em>new</em> proposals only; members can still back and you can still decide the ones already in.
          </span>
        </div>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Ask, per person (optional)</span>
          <input
            type="number"
            name="contributionPerMember"
            min={0}
            step={1}
            defaultValue={currentCycle.contributionPerMember ?? ""}
            placeholder={contributions?.suggestedAsk !== null && contributions?.suggestedAsk !== undefined ? String(contributions.suggestedAsk) : "Not set"}
            className={`${INPUT} w-36`}
          />
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            An average, not a bill.
            {contributions?.suggestedAsk !== null && contributions?.suggestedAsk !== undefined
              ? ` What's left to cover works out at about ${formatAmount(contributions.suggestedAsk)} each — you can ask for more or less.`
              : ""}{" "}
            Leave it empty to clear the ask.
          </span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton className={BUTTON_PRIMARY} pendingLabel="Saving…">
            Save changes
          </SubmitButton>
          <Link href={backHref} className={BUTTON_SECONDARY}>
            Cancel
          </Link>
        </div>
      </form>

      <p className="mt-4 text-[length:var(--text-meta)] text-[var(--text-muted)]">
        Some things stay as they are: money already entered in the ledger is never edited or deleted (a correction adds a
        reversing entry), and a member&rsquo;s proposal can only be changed by its submitter while it is open.
      </p>
    </main>
  );
}

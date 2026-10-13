import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { listMyContributions } from "@/lib/budget";
import { BUTTON_GHOST, CARD, Tag } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import { formatAmount } from "../../[cycleScope]/budget/format";
import { budgetPath, COMMUNITY_BUDGET_SCOPE } from "../../[cycleScope]/budget/paths";

export const dynamic = "force-dynamic";

const STATUS_TONE = { pending: "warning", confirmed: "success", rejected: "danger" } as const;
const STATUS_LABEL = { pending: "Waiting", confirmed: "Counted", rejected: "Rejected" } as const;

// Everything the viewer has paid in, across events and the community's own
// budget, grouped by what it was for — the one place those meet for a member
// (docs/plans/archive/budget-funds-plan.md 3b, D8). It is their own data and nobody
// else's: listMyContributions asks for entries about the viewer and cannot be
// widened, so nothing on this page can show another member's payment.
export default async function MyContributionsPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const moduleOn = isModuleEnabled(await getCommunity(viewing), "budget");
  const groups = moduleOn ? await listMyContributions(viewing) : [];
  const total = groups.reduce((sum, g) => sum + g.paid, 0);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="My contributions"
        description="Everything you've paid in, across events and the community's budget. Only you can see this page."
        actions={
          <Link href="/budget" className={BUTTON_GHOST}>
            Budgets
          </Link>
        }
      />

      {!moduleOn && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Not turned on for this Community yet — a current Admins holder can enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && groups.length === 0 && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          You haven&rsquo;t paid anything in yet. When you pay into an event or the community&rsquo;s budget, record it from that budget&rsquo;s page and it will
          show up here.
        </p>
      )}

      {groups.length > 0 && (
        <>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">
            <span className="font-semibold">{formatAmount(total)}</span> counted so far.
          </p>
          <div className="mt-4 flex flex-col gap-4">
            {groups.map((g) => (
              <section key={g.scopeCycleId ?? "community"} className={CARD}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">
                    <Link
                      href={g.scopeCycleId ? budgetPath(g.scopeCycleId) : budgetPath(COMMUNITY_BUDGET_SCOPE)}
                      className="text-[var(--accent-1)] hover:underline"
                    >
                      {g.title}
                    </Link>
                  </h2>
                  <p className="text-[length:var(--text-body)] text-[var(--text)]">
                    {formatAmount(g.paid)} counted
                    {g.waiting > 0 && <span className="text-[var(--text-muted)]">, {formatAmount(g.waiting)} waiting</span>}
                  </p>
                </div>
                <ul className="mt-2 flex flex-col gap-2">
                  {g.entries.map(({ entry, reversedBy }) => (
                    <li key={entry.id} className="text-[length:var(--text-body)]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--text)]">{entry.amount < 0 ? `−${formatAmount(-entry.amount)}` : formatAmount(entry.amount)}</span>
                        <span className="text-[var(--text)]">{entry.description}</span>
                        <Tag tone={STATUS_TONE[entry.status]}>{STATUS_LABEL[entry.status]}</Tag>
                        {reversedBy && <Tag tone="neutral">Reversed</Tag>}
                        {entry.reversesEntryId && <Tag tone="neutral">Reversal</Tag>}
                      </div>
                      <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                        {entry.occurredOn}
                        {entry.receiptNote && <> · {entry.receiptNote}</>}
                        {entry.decisionNote && <> · {entry.status === "rejected" ? "Reason given" : "Note"}: “{entry.decisionNote}”</>}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

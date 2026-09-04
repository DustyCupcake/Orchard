import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getContributionCommunityAverage, getOwnContribution, listVisibleContributors } from "@/lib/contribution";
import ContributionCategories from "@/components/ContributionCategories";
import { BUTTON_SECONDARY } from "@/components/ui/kit";
import { setContributionVisibleAction } from "./actions";

export const dynamic = "force-dynamic";

// A member's own picture — completed/active/future, broken down by
// category, computed live off Task/TaskAssignment. See
// docs/spec.md's "Contribution tracking" and
// docs/development-plan.md's Phase 23.
export default async function ContributionPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const [categories, visibleContributors, communityAverage] = await Promise.all([
    getOwnContribution(viewing),
    listVisibleContributors(viewing),
    getContributionCommunityAverage(viewing),
  ]);
  const others = visibleContributors.filter((m) => m.id !== viewing.id);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Your contribution</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        What you&rsquo;ve done, what you&rsquo;re carrying now, and what&rsquo;s coming — nothing
        entered by hand, all read off your task assignments.
      </p>

      <form action={setContributionVisibleAction} className="mt-4 flex items-center gap-2">
        <input type="hidden" name="visible" value={(!viewing.contributionVisible).toString()} />
        <button type="submit" className={BUTTON_SECONDARY}>
          {viewing.contributionVisible ? "Make this private again" : "Share this with the rest of the community"}
        </button>
        {viewing.contributionVisible && (
          <span className="text-[12px] text-[var(--text-muted)]">Currently visible to others.</span>
        )}
      </form>

      <p className="mt-4 text-[13px] text-[var(--text-muted)]">
        {communityAverage
          ? "Each category also shows the average across this cycle’s currently active members (Participation “coming”) in parentheses."
          : (
            <>
              No community average yet — nobody&rsquo;s declared{" "}
              <Link href="/participation" className="text-[var(--accent-1)] hover:underline">
                Participation
              </Link>{" "}
              &ldquo;coming&rdquo; for the current cycle.
            </>
          )}
      </p>

      <div className="mt-4">
        <ContributionCategories categories={categories} averages={communityAverage} />
      </div>

      {others.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-[22px] font-semibold text-[var(--text)]">Shared by others</h2>
          <ul>
            {others.map((m) => (
              <li key={m.id} className="border-b border-[var(--border)] py-2 last:border-b-0">
                <Link href={`/contribution/${m.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {m.name}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

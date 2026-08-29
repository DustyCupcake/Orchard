import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getContributionCommunityAverage, getOwnContribution, listVisibleContributors } from "@/lib/contribution";
import Nav from "@/components/Nav";
import ContributionCategories from "@/components/ContributionCategories";
import { setContributionVisibleAction } from "./actions";

export const dynamic = "force-dynamic";

// A member's own picture — completed/active/future, broken down by
// category, computed live off Task/TaskAssignment. See
// docs/spec.md's "Contribution tracking" and
// docs/development-plan.md's Phase 23.
export default async function ContributionPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const [categories, visibleContributors, communityAverage] = await Promise.all([
    getOwnContribution(currentMember),
    listVisibleContributors(currentMember),
    getContributionCommunityAverage(currentMember),
  ]);
  const others = visibleContributors.filter((m) => m.id !== currentMember.id);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Your contribution</h1>
      <p style={{ color: "#666" }}>
        What you&rsquo;ve done, what you&rsquo;re carrying now, and what&rsquo;s coming — nothing
        entered by hand, all read off your task assignments.
      </p>

      <form action={setContributionVisibleAction} style={{ marginBottom: "1.5rem" }}>
        <input type="hidden" name="visible" value={(!currentMember.contributionVisible).toString()} />
        <button type="submit">
          {currentMember.contributionVisible
            ? "Make this private again"
            : "Share this with the rest of the community"}
        </button>
        {currentMember.contributionVisible && (
          <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
            Currently visible to others.
          </span>
        )}
      </form>

      {communityAverage ? (
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          Each category also shows the average across this cycle&rsquo;s currently active members
          (Participation &ldquo;coming&rdquo;) in parentheses.
        </p>
      ) : (
        <p style={{ color: "#666", fontSize: "0.85rem" }}>
          No community average yet — nobody&rsquo;s declared <Link href="/participation">Participation</Link>{" "}
          &ldquo;coming&rdquo; for the current cycle.
        </p>
      )}

      <ContributionCategories categories={categories} averages={communityAverage} />

      {others.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Shared by others</h2>
          <ul>
            {others.map((m) => (
              <li key={m.id}>
                <Link href={`/contribution/${m.id}`} style={{ color: "inherit" }}>
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

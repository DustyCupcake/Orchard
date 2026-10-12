import BudgetScreen, { type BudgetSearchParams } from "../../[cycleScope]/budget/BudgetScreen";
import { COMMUNITY_BUDGET_SCOPE } from "../../[cycleScope]/budget/paths";

export const dynamic = "force-dynamic";

// The community's own budget, outside any event. Events each have a budget of
// their own at /{event}/budget; this is the one that belongs to no event.
export default async function CommunityBudgetPage({ searchParams }: { searchParams: Promise<BudgetSearchParams> }) {
  return <BudgetScreen cycleScope={COMMUNITY_BUDGET_SCOPE} searchParams={await searchParams} />;
}

import BudgetScreen, { type BudgetSearchParams } from "./BudgetScreen";

export const dynamic = "force-dynamic";

// The page itself is BudgetScreen, shared with the community's own budget at
// /budget/fund — see ./paths.ts for why that one has a route of its own.
export default async function BudgetPage({
  params,
  searchParams,
}: {
  params: Promise<{ cycleScope: string }>;
  searchParams: Promise<BudgetSearchParams>;
}) {
  const { cycleScope } = await params;
  return <BudgetScreen cycleScope={cycleScope} searchParams={await searchParams} />;
}

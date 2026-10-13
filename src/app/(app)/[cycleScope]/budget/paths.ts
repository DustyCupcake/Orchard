// "fund" is not a URL segment: the community's own budget lives at
// /budget/fund, because [cycleScope] resolves only `active` or a real event id
// and so can't address it. Everything that builds a Budget link or redirect
// from a scope goes through here, so a form on the community's page lands
// back on it rather than on /fund/budget (a 404).
export const COMMUNITY_BUDGET_SCOPE = "fund";

export function budgetPath(cycleScope: string): string {
  return cycleScope === COMMUNITY_BUDGET_SCOPE ? "/budget/fund" : `/${cycleScope}/budget`;
}

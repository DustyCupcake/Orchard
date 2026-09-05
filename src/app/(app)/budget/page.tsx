import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveDefaultScopeSegment } from "@/lib/cycles";

export const dynamic = "force-dynamic";

// The real page moved to /[cycleScope]/budget
// (docs/development-plan.md's Phase 65) — every existing link to the
// bare /budget (dashboard, Calendar, and this page's own nav-config.ts
// entry) stays pointed here unchanged; this shim transparently
// resolves the visitor's current default scope.
export default async function BudgetRedirect() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const scope = await resolveDefaultScopeSegment(viewing);
  redirect(`/${scope}/budget`);
}

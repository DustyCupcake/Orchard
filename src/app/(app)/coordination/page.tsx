import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveDefaultScopeSegment } from "@/lib/cycles";

export const dynamic = "force-dynamic";

// The real Coordination page moved to /[cycleScope]/coordination
// (docs/cycle-scope-remediation-plan.md §5.3) — every existing link to
// the bare /coordination (the board's coordination hub menu) stays
// pointed here unchanged; this shim transparently resolves the
// visitor's current default scope rather than needing every call site
// updated.
export default async function CoordinationRedirect() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const scope = await resolveDefaultScopeSegment(viewing);
  redirect(`/${scope}/coordination`);
}
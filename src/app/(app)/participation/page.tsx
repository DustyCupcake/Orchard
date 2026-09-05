import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { resolveDefaultScopeSegment } from "@/lib/cycles";

export const dynamic = "force-dynamic";

// The real page moved to /[cycleScope]/participation
// (docs/development-plan.md's Phase 65) — every existing link to the
// bare /participation (task-packs, dashboard, contribution, members,
// Calendar, and this page's own nav-config.ts entry) stays pointed
// here unchanged; this shim transparently resolves the visitor's
// current default scope rather than needing every one of those call
// sites updated.
export default async function ParticipationRedirect() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const scope = await resolveDefaultScopeSegment(viewing);
  redirect(`/${scope}/participation`);
}

import { redirect } from "next/navigation";
import { getNavContext } from "@/lib/nav";
import { getViewingContext } from "@/lib/view-as";
import AppShell from "@/components/nav/AppShell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { real, viewing, viewAs } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  // Every field on NavContext gets computed against `viewing` (the
  // View-as target when active, otherwise just the real member) so the
  // whole shell — module visibility, badge count, pinned items — reads
  // exactly as that member would see it. `viewAs` itself is the one
  // piece the layout has to fill in afterward, since it names the real
  // member too (for the banner/End button), which getNavContext never
  // sees. See src/lib/view-as.ts.
  const ctx = await getNavContext(viewing);
  ctx.viewAs = viewAs ? { targetId: viewAs.viewedMember.id, targetName: viewAs.viewedMember.name } : null;

  return <AppShell ctx={ctx}>{children}</AppShell>;
}

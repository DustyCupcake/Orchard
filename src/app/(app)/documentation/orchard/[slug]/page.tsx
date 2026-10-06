import { notFound, redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getDocPage } from "@/lib/docs";
import DocPageShell from "@/components/docs/DocPageShell";

// One Orchard documentation page. The whole of it is the shell — the
// title, standfirst, section rail, rendered blocks and previous/next
// all come from the registry, so there is nothing page-specific to
// write here.
//
// A slug that doesn't resolve is a 404 rather than a redirect, and a
// page hidden by its module's rollout state redirects to the index: a
// member following a link to documentation for a feature this
// community hasn't switched on should land somewhere that makes sense,
// not on a 404 that reads like the link was wrong.
//
// See the index page's comment for why this static segment coexists
// with /documentation/[id] without a collision.
export const dynamic = "force-dynamic";

export default async function OrchardDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { slug } = await params;
  const page = getDocPage(slug);
  if (!page) {
    notFound();
  }

  if (page.moduleKey) {
    const communityRow = await getCommunity(viewing);
    if (!isModuleEnabled(communityRow, page.moduleKey)) {
      redirect("/documentation/orchard");
    }
  }

  return <DocPageShell page={page} />;
}

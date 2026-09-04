import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext, isSupportHolder } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { Banner, BUTTON_SECONDARY, BUTTON_GHOST } from "@/components/ui/kit";
import { activateViewAsAction } from "./actions";

export const dynamic = "force-dynamic";

// "The main community view" — mirrors board/page.tsx's own hub-button
// row for Tasks: most of the Community nav group's other destinations
// are also reachable as buttons from here, with the sidebar's own
// sub-list as the alternate way to get to them.
const HUB_LINKS = [
  { href: "/messages", label: "Messages" },
  { href: "/assemblies", label: "Assemblies" },
  { href: "/documentation", label: "Documentation" },
  { href: "/participation", label: "Cycles" },
  { href: "/settings", label: "Settings" },
] as const;

// Core, not module-gated — every Community needs some version of a
// member directory to reach another member's visible contact methods
// or activate Emergency access (see docs/spec.md's "Member contact &
// privacy" and docs/development-plan.md's Phase 46). Plain name list;
// each member's own visible-to-you methods live on /members/[id].
export default async function MembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing, viewAs } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }
  const { error } = await searchParams;

  // "View as" triggers reflect the *real* member's own Support-holder
  // status, and only show at all when nothing's currently being viewed
  // as — starting a second View-as session mid-session isn't a case
  // this phase supports (see src/lib/view-as.ts).
  const [canActivateViewAs, communityRow, members] = await Promise.all([
    !viewAs ? isSupportHolder(real) : Promise.resolve(false),
    getCommunity(viewing),
    db
      .select({ id: member.id, name: member.name })
      .from(member)
      .where(eq(member.communityId, viewing.communityId))
      .orderBy(member.name),
  ]);
  // Feedback only makes sense as a hub button once a standing form is
  // actually configured — same gate src/lib/nav.ts's own visibleModules
  // uses for the sidebar's Feedback item.
  const feedbackOn = communityRow.postCycleFeedbackFormId !== null;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Members</h1>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <div className="mt-6 flex flex-wrap gap-2">
        {HUB_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={BUTTON_SECONDARY}>
            {l.label}
          </Link>
        ))}
        {feedbackOn && (
          <Link href="/feedback" className={BUTTON_SECONDARY}>
            Feedback
          </Link>
        )}
      </div>

      <p className="mt-6 text-[13px] text-[var(--text-muted)]">
        Contact info shown per member follows their own visibility choice. Emergency-only methods
        stay hidden here — see each member&rsquo;s own page for Emergency access.
      </p>

      <ul className="mt-4">
        {members.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2.5 last:border-b-0">
            {m.id === viewing.id ? (
              <Link href="/profile" className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                {m.name} (you)
              </Link>
            ) : (
              <Link href={`/members/${m.id}`} className="text-[14px] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                {m.name}
              </Link>
            )}
            {canActivateViewAs && m.id !== real.id && (
              <form action={activateViewAsAction}>
                <input type="hidden" name="targetMemberId" value={m.id} />
                <button type="submit" className={BUTTON_GHOST}>
                  View as
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}

import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext, isSupportHolder } from "@/lib/view-as";
import { isAdmin } from "@/lib/settings/admins";
import { resolveDefaultScopeSegment, resolveViewScopeFromSegment } from "@/lib/cycles";
import { listComingMembers } from "@/lib/participation";
import { listCommunityIndicators } from "@/lib/profile-questions/indicators";
import { Banner, BUTTON_GHOST, BUTTON_PRIMARY } from "@/components/ui/kit";
import ActionMenu from "@/components/ui/ActionMenu";
import PageHeader from "@/components/ui/PageHeader";
import CommunityIndicators from "@/components/CommunityIndicators";
import { activateViewAsAction } from "./actions";

export const dynamic = "force-dynamic";

// Core, not module-gated — every Community needs some version of a
// member directory to reach another member's visible contact methods
// or activate Emergency access (see docs/spec.md's "Member contact &
// privacy" and docs/plans/development-plan.md's Phase 46). Plain name list;
// each member's own visible-to-you methods live on /members/[id].
// Community-wide navigation belongs to /community, not this directory.
//
// Two things here are new, and they are the same decision.
//
// **The published community indicators live on this page**, not on the
// Dashboard or /community. They are answers *about* members, drawn from
// questions the members themselves asked and answered, so the directory
// is the page that owns them. They were on both hubs, and on both they
// were crowd-pacing furniture that pushed the actionable half of the page
// down. /community still has its own numbers — active members, branches,
// tiers — which is a summary you read in a second; these are several
// cards of a graph, and a page that has something to do has room for one
// of the two, not both.
//
// **The page follows the view scope**, exactly as the Dashboard and the
// board already do: with the switcher on one event, the directory is that
// event's attendees and the indicators break out for them; with it on
// "all open events" (or with no events at all), both describe the whole
// Community. That is what gives the per-event indicator setting something
// to control again — /members is the page that can be *about* an event,
// so it is where a community-wide chart can honestly be one event's chart.
//
// Both halves read the same switcher rather than adding a second control
// to this page: one question ("who am I looking at?") gets one answer,
// and a page that could disagree with the switcher above it would be
// reporting a population nobody chose.
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
  const [canActivateViewAs, canImport] = await Promise.all([
    !viewAs ? isSupportHolder(real) : Promise.resolve(false),
    // Not to a viewing session: the import writes member rows, and a
    // session rendering as someone else has no business doing that even
    // with Admin. The action re-checks via assertNotViewingAs regardless.
    !viewAs ? isAdmin(viewing) : Promise.resolve(false),
  ]);

  // The same off-URL nav-switcher resolution the Dashboard reads, since
  // /members isn't itself under /[cycleScope]. A *single* cycle is the
  // only narrowing that has an event to narrow to — "all open events" is
  // an aggregate of two or more, and the honest population for a chart is
  // then the whole Community rather than a guess at which event was meant.
  const activeScopeSegment = await resolveDefaultScopeSegment(viewing);
  const activeScope = await resolveViewScopeFromSegment(viewing, activeScopeSegment);
  const scopedCycle = activeScope?.kind === "single" ? activeScope.cycle : null;

  const [members, indicatorResult] = await Promise.all([
    scopedCycle
      ? listComingMembers(viewing, scopedCycle.id)
      : db
          .select({ id: member.id, name: member.name })
          .from(member)
          .where(eq(member.communityId, viewing.communityId))
          .orderBy(member.name),
    // The community's own per-event policy is read inside
    // listCommunityIndicators, which already knows which Community it's
    // reading; it resolves the request above and reports back if it
    // narrows it, so the section below can say why rather than quietly
    // showing all-member figures under a scope that reads as one event's.
    listCommunityIndicators(
      viewing,
      scopedCycle
        ? { requested: { kind: "event", cycleId: scopedCycle.id, cycleName: scopedCycle.name } }
        : {},
    ),
  ]);

  // The population is stated rather than left to be inferred from the
  // list's length: a directory that quietly drops from forty names to
  // eight looks broken, and a proportion reading "of 8" is a claim about
  // a group. Only said when it's narrowed — the community-wide list is the
  // default and needs no caption.
  const scopeNote = scopedCycle ? (
    <>
      The {members.length} member{members.length === 1 ? "" : "s"} coming to{" "}
      <strong className="font-semibold text-[var(--text)]">{scopedCycle.name}</strong>.
    </>
  ) : null;

  return (
    // 760 rather than the directory's old 640: the indicator cards below
    // are the widest thing on the page now, and a proportion bar squeezed
    // into 640 reads as a different component than the one on /calendar.
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Members"
        description={scopeNote}
        actions={
          <>
            {/* The one primary action. Everything else about a roster is
                either the list itself or a link away, so this is the only
                thing on the page worth a filled button. */}
            <Link href="/members/data" className={BUTTON_PRIMARY}>
              Member data
            </Link>
            {/* Import is a one-off, Admin-only, and writes member rows —
                so it goes in the overflow rather than beside the primary
                action it would compete with, and it is only offered when
                the viewer can actually run it. See ./import/page.tsx. */}
            {canImport && (
              <ActionMenu label="More actions">
                <Link href="/members/import">Import members</Link>
              </ActionMenu>
            )}
          </>
        }
      />

      {error && <Banner tone="danger">{error}</Banner>}

      {members.length === 0 ? (
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          {scopedCycle
            ? "Nobody has said they're coming to this event yet."
            : "This community has no members yet."}
        </p>
      ) : (
        <ul>
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2.5 last:border-b-0">
              {m.id === viewing.id ? (
                <Link href="/profile" className="text-[length:var(--text-body)] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
                  {m.name} (you)
                </Link>
              ) : (
                <Link href={`/members/${m.id}`} className="text-[length:var(--text-body)] font-medium text-[var(--text)] hover:text-[var(--accent-1)]">
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
      )}

      <CommunityIndicators
        scope={indicatorResult.scope}
        indicators={indicatorResult.indicators}
        scopeFallback={indicatorResult.scopeFallback}
      />
    </main>
  );
}

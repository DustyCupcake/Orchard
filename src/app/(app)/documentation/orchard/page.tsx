import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { DOC_SECTIONS, RELEASE_NOTES } from "@/lib/docs";
import { BUTTON_PRIMARY } from "@/components/ui/kit";

// The Orchard documentation section: everything about the tool itself,
// as opposed to the community's own pages at /documentation.
//
// Content is authored in src/lib/docs/content/ and read from the
// registry — nothing here is stored, so nothing here can be edited or
// deleted by a member, and it needs no migration or per-install seed.
// See src/lib/docs/types.ts for the block vocabulary and the "why
// belongs in a callout" rule the whole section is written against.
//
// This route is a static segment sitting alongside the existing
// /documentation/[id] dynamic route. Next.js resolves static segments
// ahead of dynamic ones, so /documentation/orchard reaches this page
// and never the wiki detail page. That's also why every slug in the
// registry is a plain word: wiki page ids are UUIDs, so a uuid can
// never collide with a slug. Don't "simplify" this into a shared
// route — a wiki id and a doc slug are different namespaces that only
// look like they could be merged.

export const dynamic = "force-dynamic";

export default async function OrchardDocsPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  // Pages describing an optional module are hidden when the Community
  // has that module switched off — the same gate the nav applies, so a
  // community with Budget off isn't shown documentation for a feature
  // it doesn't have. Fetched once here rather than per page; the
  // per-page gate is the same `moduleKey` check in [slug]/page.tsx, so
  // a direct link to a hidden page lands on the index rather than on
  // a page describing something the community doesn't run.
  const communityRow = await getCommunity(viewing);

  const visibleSections = DOC_SECTIONS.map((section) => ({
    ...section,
    pages: section.pages.filter(
      (p) => !p.moduleKey || isModuleEnabled(communityRow, p.moduleKey),
    ),
  })).filter((section) => section.pages.length > 0);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <Link
        href="/documentation"
        className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline"
      >
        ← Library
      </Link>

      <h1 className="mt-2 text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        Orchard documentation
      </h1>
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
        How the tool works, how to use it, and why it behaves the way it does — including
        the reasoning behind the controls that don&rsquo;t explain themselves.
      </p>

      {visibleSections.map((section) => (
        <section key={section.key} className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">{section.title}</h2>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{section.summary}</p>
          <ul className="mt-3 flex flex-col gap-2">
            {section.pages.map((page) => (
              <li key={page.slug} className="text-[length:var(--text-body)]">
                <Link
                  href={`/documentation/orchard/${page.slug}`}
                  className="font-medium text-[var(--text)] hover:text-[var(--accent-1)]"
                >
                  {page.title}
                </Link>
                <p className="text-[var(--text-muted)]">{page.summary}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-10">
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">What&rsquo;s new</h2>
        <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
          What changed for people using it, in the order it shipped.
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {RELEASE_NOTES.map((note) => (
            <li key={note.source} className="border-b border-[var(--border)] pb-3 last:border-b-0">
              <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">{formatNoteDate(note.date)}</p>
              <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{note.title}</p>
              <p className="mt-0.5 text-[length:var(--text-body)] text-[var(--text-muted)]">{note.summary}</p>
            </li>
          ))}
        </ul>
      </section>

      <div className="mt-10 border-t border-[var(--border)] pt-4">
        <Link href="/documentation" className={BUTTON_PRIMARY}>
          Community pages
        </Link>
      </div>
    </main>
  );
}

// ISO dates in the content, so the entries sort correctly in source
// order and the test can assert the ordering. Rendered here rather than
// at the point of writing so the content stays a plain string and
// doesn't depend on a server's locale or timezone.
function formatNoteDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  if (!y || !m || !d || !months[m - 1]) return iso;
  return `${d} ${months[m - 1]} ${y}`;
}

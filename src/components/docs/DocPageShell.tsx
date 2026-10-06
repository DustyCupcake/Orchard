import Link from "next/link";
import type { DocPage } from "@/lib/docs/types";
import { getSectionForPage, getDocNeighbours, DOC_SECTIONS } from "@/lib/docs";
import DocBlocks from "./DocBlocks";

// The frame every doc page wears: a link back to the index, the
// section this page belongs to, the page's own standfirst, the section
// rail, its blocks, and the previous/next pair.
//
// The rail sits directly under the standfirst, above the body, because
// that's where a reader looks for "what else is in here" before they
// start reading — and because there is no search in this app, so the
// index and the rail are the entire navigation story. Every section
// stays visible while you're inside one of them, so a member who lands
// mid-sequence can see where they are and jump sideways without
// going back.

export default function DocPageShell({ page }: { page: DocPage }) {
  const section = getSectionForPage(page.slug);
  const { previous, next } = getDocNeighbours(page.slug);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <Link
        href="/documentation/orchard"
        className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline"
      >
        ← All Orchard documentation
      </Link>

      <h1 className="mt-2 text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">
        {page.title}
      </h1>
      {section && (
        <p className="mt-1 text-[length:var(--text-meta)] font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {section.title}
        </p>
      )}
      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">{page.summary}</p>

      <nav className="mt-5 border-t border-[var(--border)] pt-4">
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {DOC_SECTIONS.map((s) => {
            const here = s.pages.some((p) => p.slug === page.slug);
            return (
              <li key={s.key}>
                <Link
                  href="/documentation/orchard"
                  className={
                    here
                      ? "text-[length:var(--text-body)] font-semibold text-[var(--accent-1)]"
                      : "text-[length:var(--text-body)] font-medium text-[var(--text-muted)] hover:text-[var(--text)]"
                  }
                >
                  {s.title}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6">
        <DocBlocks blocks={page.blocks} />
      </div>

      {(previous || next) && (
        <nav className="mt-10 flex flex-wrap justify-between gap-4 border-t border-[var(--border)] pt-4">
          {previous ? (
            <Link
              href={`/documentation/orchard/${previous.slug}`}
              className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline"
            >
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={`/documentation/orchard/${next.slug}`}
              className="text-[length:var(--text-body)] font-medium text-[var(--accent-1)] hover:underline"
            >
              {next.title} →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}

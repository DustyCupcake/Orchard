import { using } from "./content/using";
import { howItWorks } from "./content/how-it-works";
import { why } from "./content/why";
import { RELEASE_NOTES, type ReleaseNote } from "./content/releases";
import type { DocPage, DocSection } from "./types";

// The registry: every page in every section, plus lookup and the
// previous/next pair the page footer walks.
//
// Order is meaningful and is the section order on the index page. Each
// section's own `pages` array is read in order, so "how to use it"
// stays ahead of "how it works" stays ahead of "why" — which is the
// order someone arriving cold actually needs them in.

export const DOC_SECTIONS: DocSection[] = [using, howItWorks, why];

// Release notes are deliberately not a DocSection. They're dated
// entries in reverse chronological order rather than a reading
// sequence, so forcing them into the same shape would mean inventing an
// order they don't have. The section list carries the three prose
// sections; this is the fourth destination on the index, and it's
// rendered from its own component.
export { RELEASE_NOTES };
export type { ReleaseNote };

// Flat namespace, because the route is /documentation/orchard/[slug]
// rather than /documentation/orchard/<section>/<slug>. One namespace
// means a `see-also` in any page can name any other page by slug
// alone, and a link can't be ambiguous. Uniqueness across sections is
// asserted by tests/orchard-docs.test.ts.
export const ALL_PAGES: DocPage[] = DOC_SECTIONS.flatMap((s) => s.pages);

const PAGE_BY_SLUG = new Map(ALL_PAGES.map((p) => [p.slug, p]));

export function getDocPage(slug: string): DocPage | undefined {
  return PAGE_BY_SLUG.get(slug);
}

export function getSectionForPage(slug: string): DocSection | undefined {
  return DOC_SECTIONS.find((s) => s.pages.some((p) => p.slug === slug));
}

/**
 * The pages either side of this one, for the footer's previous/next
 * pair. Flattened across section boundaries rather than staying inside
 * one, so the last page of a section leads into the first page of the
 * next — a reader who works through them in order shouldn't hit a
 * dead end at a section boundary and have to go back to the index to
 * carry on.
 *
 * Returns nulls at either end rather than dropping the link, so the
 * footer renders the same two slots regardless of position and the
 * row never reflows between pages.
 */
export function getDocNeighbours(slug: string): { previous: DocPage | null; next: DocPage | null } {
  const i = ALL_PAGES.findIndex((p) => p.slug === slug);
  if (i === -1) return { previous: null, next: null };
  return {
    previous: i > 0 ? ALL_PAGES[i - 1] : null,
    next: i < ALL_PAGES.length - 1 ? ALL_PAGES[i + 1] : null,
  };
}

export type { DocPage, DocSection };

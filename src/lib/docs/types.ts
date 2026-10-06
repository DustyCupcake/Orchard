// The content vocabulary for the Orchard documentation section.
//
// Deliberately typed blocks rather than markdown: this content ships in
// the app bundle (see src/lib/docs/content/), so it needs no filesystem
// read, no markdown dependency, and no .dockerignore change — and every
// shape here is checked by `tsc`.
//
// The vocabulary is small on purpose, and it is the union of what the
// existing prose in docs/overview.md and docs/spec.md actually does —
// nothing speculative. Every kind here is used by at least one page
// today; the first page that needs a seventh gets it added to this
// union and to DocBlocks.tsx, which is a two-place change the compiler
// points at. An earlier draft carried `steps` and an `ordered` flag on
// `list` as well, and nothing used either — two ways to say "in this
// order" is exactly the duplication the rest of this codebase keeps
// collapsing, so they're gone rather than left as spare capacity.
//
// The one block that matters most for this section is `callout`. It is
// the only kind that carries reasoning, which is what keeps the rest of
// each page free of it.

export type DocBlock =
  | { kind: "para"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "callout"; title?: string; text: string }
  // A link to another page in this section, so the "why" pages can
  // cross-reference the how-to pages and vice versa without hardcoding
  // hrefs. Resolved by the renderer against the registry; an unknown
  // slug is a test failure rather than a dead link (tests/orchard-docs).
  | { kind: "see-also"; slugs: string[] };

export type DocPage = {
  // Globally unique across every section, because the route is
  // /documentation/orchard/[slug] — one flat namespace, not
  // /documentation/orchard/<section>/<slug>. Asserted by
  // tests/orchard-docs.test.ts.
  slug: string;
  title: string;
  // One line, shown on the section index and used as the page's own
  // standfirst. Phrased as the question a member would actually arrive
  // with, since there is no search in this app and the index is the
  // only way in (see the section's own index page).
  summary: string;
  // Pages for optional modules are hidden when the Community has that
  // module switched off — the same `modulesEnabled` gate the nav uses,
  // via `moduleKey` below. Everything else is always visible.
  moduleKey?: string;
  blocks: DocBlock[];
};

export type DocSection = {
  key: string;
  title: string;
  // One line per section, shown under the section's title on the index.
  summary: string;
  pages: DocPage[];
};

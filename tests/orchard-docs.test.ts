import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DOC_SECTIONS, ALL_PAGES, RELEASE_NOTES, getDocPage, getSectionForPage, getDocNeighbours } from "@/lib/docs";
import { MODULE_DEFINITIONS } from "@/lib/modules";

// The Orchard documentation section is static content, so these are
// pure structural assertions — no database, and nothing here needs one.
// The point of every test below is that a mistake in the content fails
// the suite rather than shipping.
//
// The failure modes each one covers is the reason they're here at all:
// a duplicate slug would make a `see-also` link ambiguous, a broken
// `see-also` slug would ship as a dead link, a page gated on a module
// key that doesn't exist would never be filtered and would show a
// community documentation for a feature it doesn't run, and an
// un-summarised CHANGELOG entry is the one place this content rots
// silently rather than loudly.

const REPO_ROOT = path.resolve(__dirname, "..");

describe("Orchard documentation registry", () => {
  it("has sections, in reading order", () => {
    expect(DOC_SECTIONS.length).toBeGreaterThan(0);
    // Using first, then the model, then the reasoning. Asserted as
    // keys rather than titles so re-titling a section doesn't fail a
    // test about ordering.
    expect(DOC_SECTIONS.map((s) => s.key)).toEqual(["using", "how-it-works", "why"]);
  });

  it("gives every section at least one page and a summary", () => {
    for (const section of DOC_SECTIONS) {
      expect(section.pages.length, `section ${section.key} has no pages`).toBeGreaterThan(0);
      expect(section.summary.length, `section ${section.key} has no summary`).toBeGreaterThan(0);
      expect(section.title.length).toBeGreaterThan(0);
    }
  });

  it("keeps slugs unique across every section, not just within one", () => {
    // The route is /documentation/orchard/[slug] — one flat namespace
    // rather than /documentation/orchard/<section>/<slug>. A duplicate
    // across sections would make getDocPage return whichever came
    // first and silently shadow the other.
    const seen = new Map<string, string>();
    for (const section of DOC_SECTIONS) {
      for (const page of section.pages) {
        const prior = seen.get(page.slug);
        expect(prior, `slug "${page.slug}" is used by both ${prior} and ${section.key}`).toBeUndefined();
        seen.set(page.slug, section.key);
      }
    }
  });

  it("gives every page a title, a summary, and blocks", () => {
    for (const page of ALL_PAGES) {
      expect(page.title.length, `page ${page.slug} has no title`).toBeGreaterThan(0);
      expect(page.summary.length, `page ${page.slug} has no summary`).toBeGreaterThan(0);
      expect(page.blocks.length, `page ${page.slug} has no blocks`).toBeGreaterThan(0);
    }
  });

  it("declares a moduleKey only when it is a real module", () => {
    // A page gated on a key that isn't in MODULE_DEFINITIONS would
    // never be filtered by isModuleEnabled, so a community with that
    // module off would still be shown documentation for it — the
    // exact thing the gate exists to prevent.
    const known = new Set<string>(MODULE_DEFINITIONS.map((m) => m.key));
    for (const page of ALL_PAGES) {
      if (page.moduleKey === undefined) continue;
      expect(known.has(page.moduleKey), `page ${page.slug} gates on unknown module "${page.moduleKey}"`).toBe(true);
    }
  });

  it("resolves every see-also slug to a real page", () => {
    for (const page of ALL_PAGES) {
      for (const block of page.blocks) {
        if (block.kind !== "see-also") continue;
        expect(block.slugs.length, `page ${page.slug} has an empty see-also`).toBeGreaterThan(0);
        for (const slug of block.slugs) {
          expect(getDocPage(slug), `page ${page.slug} links to unknown page "${slug}"`).toBeDefined();
        }
      }
    }
  });

  it("never links a page to itself", () => {
    for (const page of ALL_PAGES) {
      for (const block of page.blocks) {
        if (block.kind !== "see-also") continue;
        expect(block.slugs, `page ${page.slug} links to itself`).not.toContain(page.slug);
      }
    }
  });

  it("gives every table a header row and a matching cell count on each row", () => {
    // A short row against a longer header renders as a table whose
    // columns silently stop lining up, which reads as broken rather
    // than as a mistake someone should fix.
    for (const page of ALL_PAGES) {
      for (const block of page.blocks) {
        if (block.kind !== "table") continue;
        expect(block.head.length, `table on ${page.slug} has no columns`).toBeGreaterThan(0);
        for (const row of block.rows) {
          expect(row.length, `table on ${page.slug} has a row of ${row.length}, header has ${block.head.length}`).toBe(
            block.head.length,
          );
        }
      }
    }
  });

  it("uses every block kind at least once", () => {
    // The vocabulary is deliberately the union of what the existing
    // prose actually needs, nothing speculative — see the comment at
    // the top of src/lib/docs/types.ts. This is the test that keeps
    // that true: a kind added to the union has to be used by a real
    // page, or the reasoning for adding it was a guess. It also means
    // a kind left in the union after its last page goes away gets
    // noticed, rather than sitting in DocBlocks.tsx as spare capacity
    // that looks like a feature.
    //
    // Adding a new kind therefore means: use it, or don't add it.
    const EXPECTED = ["para", "heading", "list", "table", "callout", "see-also"];
    const used = new Set(ALL_PAGES.flatMap((p) => p.blocks.map((b) => b.kind)));
    for (const kind of EXPECTED) {
      expect(used.has(kind as never), `no page uses the "${kind}" block kind`).toBe(true);
    }
    // ...and nothing crept in that isn't in the expected list, so this
    // fails on an *added* kind too rather than only on an unused one.
    expect([...used].sort()).toEqual([...EXPECTED].sort());
  });

  it("gives every list at least one item", () => {
    for (const page of ALL_PAGES) {
      for (const block of page.blocks) {
        if (block.kind !== "list") continue;
        expect(block.items.length, `list on ${page.slug} is empty`).toBeGreaterThan(0);
      }
    }
  });

  it("agrees with itself: every page resolves, and to its own section", () => {
    for (const page of ALL_PAGES) {
      expect(getDocPage(page.slug)).toBe(page);
      expect(getSectionForPage(page.slug)?.pages).toContain(page);
    }
    expect(getDocPage("no-such-page")).toBeUndefined();
    expect(getSectionForPage("no-such-page")).toBeUndefined();
  });
});

describe("Orchard documentation neighbours", () => {
  it("walks the whole set in order, crossing section boundaries", () => {
    // Flattened across sections on purpose — see getDocNeighbours. A
    // reader working through in order shouldn't hit a dead end at a
    // section boundary and have to go back to the index to carry on.
    for (let i = 0; i < ALL_PAGES.length; i++) {
      const { previous, next } = getDocNeighbours(ALL_PAGES[i].slug);
      expect(previous?.slug ?? null).toBe(i > 0 ? ALL_PAGES[i - 1].slug : null);
      expect(next?.slug ?? null).toBe(i < ALL_PAGES.length - 1 ? ALL_PAGES[i + 1].slug : null);
    }
  });

  it("returns both ends null for an unknown slug", () => {
    expect(getDocNeighbours("no-such-page")).toEqual({ previous: null, next: null });
  });
});

describe("Orchard release notes", () => {
  it("is newest first", () => {
    const dates = RELEASE_NOTES.map((n) => n.date);
    const sorted = [...dates].sort().reverse();
    expect(dates).toEqual(sorted);
  });

  it("gives every note an ISO date, a title, a summary and at least one point", () => {
    for (const note of RELEASE_NOTES) {
      expect(note.date, `note "${note.title}" has a non-ISO date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.title.length).toBeGreaterThan(0);
      expect(note.summary.length).toBeGreaterThan(0);
      expect(note.points.length, `note "${note.title}" has no points`).toBeGreaterThan(0);
    }
  });

  it("cites a CHANGELOG entry that still exists", () => {
    // `source` is the CHANGELOG `##` heading a note was written from.
    // Without this the citation silently rots into a dead reference
    // and nobody notices, because a string in a TS file referencing a
    // heading in a markdown file has no compiler opinion about it.
    const changelog = readFileSync(path.join(REPO_ROOT, "CHANGELOG.md"), "utf8");
    const headings = new Set(
      changelog
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .map((line) => line.slice(3).trim()),
    );
    for (const note of RELEASE_NOTES) {
      expect(headings.has(note.source), `note "${note.title}" cites a CHANGELOG entry that no longer exists: ${note.source}`).toBe(
        true,
      );
    }
  });

  it("cites each CHANGELOG entry at most once", () => {
    const seen = new Map<string, string>();
    for (const note of RELEASE_NOTES) {
      const prior = seen.get(note.source);
      expect(prior, `two release notes cite the same CHANGELOG entry: ${note.source}`).toBeUndefined();
      seen.set(note.source, note.title);
    }
  });
});

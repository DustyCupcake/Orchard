import Link from "next/link";
import type { DocBlock } from "@/lib/docs/types";
import { getDocPage } from "@/lib/docs";

// The one place a DocBlock becomes markup.
//
// Extracted for the same reason kit.tsx was: the first three pages would
// otherwise each carry their own switch over block kinds, and the fourth
// would drift. The vocabulary is a discriminated union (see
// src/lib/docs/types.ts), so adding a kind fails to typecheck here
// rather than rendering as nothing.
//
// `see-also` resolves slugs against the registry at render time rather
// than taking hrefs in the content, so a page names another page by
// slug and a renamed page is caught by
// tests/orchard-docs.test.ts instead of shipping as a dead link.
export default function DocBlocks({ blocks }: { blocks: DocBlock[] }) {
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) => (
        <Block key={i} block={block} />
      ))}
    </div>
  );
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case "para":
      return <p className="text-[length:var(--text-body)] leading-relaxed text-[var(--text)]">{block.text}</p>;

    case "heading":
      return (
        <h2 className="mt-3 text-[length:var(--text-title)] font-semibold text-[var(--text)] first:mt-0">{block.text}</h2>
      );

    case "list":
      return (
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[length:var(--text-body)] leading-relaxed text-[var(--text)] marker:text-[var(--text-muted)]">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );

    // A real table rather than a list, for the one thing in this section
    // that genuinely is a comparison — the four mechanisms for asking
    // people something, which differ on three axes at once and read as
    // mush when each is a paragraph. Everywhere else prose wins: a
    // table is a claim that these are the same kind of thing, and
    // almost nothing else here is.
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[length:var(--text-body)]">
            <thead>
              <tr>
                {block.head.map((h) => (
                  <th
                    key={h}
                    className="border-b border-[var(--border)] pb-1.5 pr-4 text-left text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row) => (
                <tr key={row.join("|")}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="border-b border-[var(--border)] py-1.5 pr-4 align-top text-[var(--text)] last:pr-0"
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    // The one block that carries reasoning. Deliberately not a Banner:
    // a Banner is a page's own state message, and a callout here is
    // standing documentation that happens to be worth pulling out of
    // the flow. Tinted with the accent rather than a status colour so
    // it never reads as a warning or an error — nothing about a
    // counter-intuitive default is an error.
    case "callout":
      return (
        <aside className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--accent-1-soft)] px-3.5 py-3">
          {block.title && (
            <p className="text-[length:var(--text-body)] font-semibold text-[var(--text)]">{block.title}</p>
          )}
          <p className={`text-[length:var(--text-body)] leading-relaxed text-[var(--text)] ${block.title ? "mt-1" : ""}`}>
            {block.text}
          </p>
        </aside>
      );

    // Not reasoning (that is the callout) and not a state message (that is
    // a Banner): a fixed label that says this is intended and not built, so
    // the status doesn't depend on how the sentence beside it is worded.
    case "planned":
      return (
        <aside className="rounded-[var(--radius-md)] border border-dashed border-[var(--border-strong)] px-3.5 py-3">
          <p className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Planned — not built yet
          </p>
          <p className="mt-1 text-[length:var(--text-body)] leading-relaxed text-[var(--text-muted)]">{block.text}</p>
        </aside>
      );

    case "see-also":
      return (
        <nav className="mt-2 border-t border-[var(--border)] pt-3">
          <p className="text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            See also
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {block.slugs.map((slug) => {
              const page = getDocPage(slug);
              // A slug with no page is a test failure, not a runtime
              // case — see tests/orchard-docs.test.ts. Rendered as
              // plain text rather than a null so a slip is visible
              // rather than silently missing.
              if (!page) return <li key={slug} className="text-[length:var(--text-body)] text-[var(--text-muted)]">{slug}</li>;
              return (
                <li key={slug} className="text-[length:var(--text-body)]">
                  <Link
                    href={`/documentation/orchard/${slug}`}
                    className="font-medium text-[var(--accent-1)] hover:underline"
                  >
                    {page.title}
                  </Link>
                  <span className="text-[var(--text-muted)]"> — {page.summary}</span>
                </li>
              );
            })}
          </ul>
        </nav>
      );
  }
}

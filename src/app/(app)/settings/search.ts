// The settings search's matcher. Pure and import-free so the client search box
// can use it directly; the entries come from ./search-index.ts via the page.

export type SettingsSearchEntry = {
  /** The tab the setting lives on — a key from ./tabs.ts. */
  tab: string;
  tabLabel: string;
  /** The id of the block to jump to, or null for "the tab itself". */
  anchor: string | null;
  title: string;
  /** One line on what the setting is for, in the page's own words. */
  summary: string;
  /** Other words someone might type for it — "colors", "sso", "invite". */
  keywords: string;
};

export function settingsEntryHref(entry: Pick<SettingsSearchEntry, "tab" | "anchor">): string {
  return `/settings?tab=${entry.tab}${entry.anchor ? `#${entry.anchor}` : ""}`;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Every word of the query has to appear somewhere in an entry (a prefix of a
 * word counts: "invit" finds "invited"). Title hits rank above keyword hits,
 * which rank above summary and tab-name hits; ties keep the index's order,
 * which is the order the settings appear on their tabs.
 */
export function searchSettings(
  entries: readonly SettingsSearchEntry[],
  query: string,
  limit = 8,
): SettingsSearchEntry[] {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { entry: SettingsSearchEntry; score: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const title = normalize(entry.title);
    const keywords = normalize(entry.keywords);
    const rest = normalize(`${entry.summary} ${entry.tabLabel}`);
    let score = 0;
    for (const token of tokens) {
      const inWords = (hay: string) => hay.split(" ").some((w) => w.startsWith(token));
      if (inWords(title)) score += 10;
      else if (title.includes(token)) score += 6;
      else if (inWords(keywords)) score += 5;
      else if (keywords.includes(token)) score += 3;
      else if (inWords(rest)) score += 2;
      else if (rest.includes(token)) score += 1;
      else return; // this word matches nothing here: not a result
    }
    scored.push({ entry, score, order });
  });

  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.entry);
}

// A lightweight string-similarity check for Pack import's branch
// reconciliation — docs/development-plan.md's Phase 59: catching
// "Wood" vs. "Woods" as a suggested near-match instead of forcing
// "create new" on anything short of an exact name. Plain Levenshtein
// edit distance, hand-rolled rather than a dependency — a small,
// self-contained algorithm this codebase already takes the same
// approach to elsewhere (date resolution, Requirement matching).
// Deliberately scoped to Pack import's branch-name reconciliation
// only, per spec's own naming — not a general-purpose fuzzy-matching
// utility for reuse elsewhere (e.g. Requirement's `custom` free-form
// flags).

function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  let previousRow = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const currentRow = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1, // deletion
        currentRow[j - 1] + 1, // insertion
        previousRow[j - 1] + cost, // substitution
      );
    }
    previousRow = currentRow;
  }
  return previousRow[n];
}

// 1 = identical, 0 = completely different — normalized against the
// longer of the two strings, so "wood"/"woods" (distance 1, longer
// length 5) scores 0.8.
function similarityRatio(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return 1 - levenshteinDistance(a, b) / longer;
}

// Resolved threshold — spec names no exact number. 0.7 catches genuine
// near-misses (typos, singular/plural, minor punctuation) without
// over-eagerly matching two names that just happen to share a few
// letters: "Wood"/"Woods" scores 0.8, "Kicthen"/"Kitchen" ~0.86,
// "Fruit"/"Support" ~0.14 — comfortably on the correct side either way.
const SIMILARITY_THRESHOLD = 0.7;

export interface NameMatchCandidate {
  id: string;
  name: string;
}

// Never applied automatically — the caller pre-fills a review row's
// default with the result, but every row stays exactly as freely
// editable (remap to any other existing branch, or override to
// "create new" even with a near-match found) as Phase 55 already
// made it. Returns null when nothing clears the threshold, same as
// finding no candidate at all.
export function findClosestNameMatch(
  hint: string,
  candidates: NameMatchCandidate[],
): NameMatchCandidate | null {
  const lowerHint = hint.toLowerCase();
  let best: NameMatchCandidate | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = similarityRatio(lowerHint, candidate.name.toLowerCase());
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore >= SIMILARITY_THRESHOLD ? best : null;
}

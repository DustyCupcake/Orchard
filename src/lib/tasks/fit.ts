// The one definition of "who might be a fit for this", used to order
// the people a coordinator can ask — see docs/spec.md's Coordination
// mechanics: the self-assign check's "suggest a person (tag-matches
// surfaced)" option, and the fitted-ask tools that show a member's
// capacity next to the ask.
//
// Deliberately a *ranking*, not a recommendation. Task.tags and
// member.tags are both free-text arrays people fill in themselves, so an
// overlap count is the honest amount of signal available: a member
// tagged "welding" on a task tagged "welding, prep" is visibly a
// stronger candidate than one sharing nothing, and the coordinator still
// makes the call. Spec is explicit that automatically weighting or
// default-ranking who gets *suggested* is deferred as matching
// automation, so nothing here claims a fit — it only orders people the
// coordinator already chose to ask, and never removes anyone from the
// list. A member sharing zero tags is still offerable, just last.

export interface TagFitCandidate {
  id: string;
  name: string;
  tags: string[];
}

/** The task tags a candidate matches, case-insensitively. */
function matchedTags(candidateTags: string[], taskTags: string[]): string[] {
  if (taskTags.length === 0 || candidateTags.length === 0) return [];
  const wanted = new Set(taskTags.map((t) => t.toLowerCase()));
  return candidateTags.filter((t) => wanted.has(t.toLowerCase()));
}

/**
 * Candidates ordered by tag overlap with the task: most matches first,
 * then alphabetical so two equally-matched people don't swap places
 * between renders. Every candidate is returned — this reorders, it
 * never filters.
 */
export function rankByTagFit<T extends TagFitCandidate>(candidates: T[], taskTags: string[]): T[] {
  if (taskTags.length === 0) {
    return [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  }
  return [...candidates].sort((a, b) => {
    const diff = matchedTags(b.tags, taskTags).length - matchedTags(a.tags, taskTags).length;
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

/** The same overlap count, for showing a match count beside a name. */
export function tagFitCount(candidateTags: string[], taskTags: string[]): number {
  return matchedTags(candidateTags, taskTags).length;
}

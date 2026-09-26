import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assembly, community } from "@/db/schema";
import { FOUNDING_SETTINGS_TEMPLATE_KEY } from "./founding-settings";

// How long the /settings nudge stays up after it was first shown. Two
// weeks is deliberately short: this is a starting-here pointer, not a
// nag. A community that wants to decide its settings together can run
// the template whenever it likes (the Assembly outlives this prompt);
// what we don't want is a banner that follows someone around a year
// after they quietly settled everything in person.
const PROMPT_WINDOW_DAYS = 14;
const PROMPT_WINDOW_MS = PROMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type FoundersPromptState = "hidden" | "show";

/**
 * Whether /settings should offer to decide the community's settings
 * together through an Assembly.
 *
 * Two independent conditions end it, per the product owner's rule:
 * the settings Assembly actually exists, or two weeks have passed since
 * we first offered. The first is read off `assembly.templateKey` rather
 * than mirrored onto the community row, so the truth stays with the
 * Assembly — there's no second place to keep in sync, and deleting the
 * Assembly correctly brings the offer back.
 *
 * The second needs a clock, and `community.foundersAssemblyPromptedAt`
 * is it — deliberately not a "community created" date, because this is
 * single-tenant self-hosted software: a deployment that has been running
 * for a year and only just started using the tool properly must still
 * get offered this. So the anchor is "when we first showed it", not
 * "how old the install is".
 */
export async function getFoundersAssemblyPromptState(
  communityId: string,
  now: Date = new Date(),
): Promise<FoundersPromptState> {
  const existing = await db
    .select({ id: assembly.id })
    .from(assembly)
    .where(
      and(
        eq(assembly.communityId, communityId),
        eq(assembly.templateKey, FOUNDING_SETTINGS_TEMPLATE_KEY),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return "hidden";
  }

  const [row] = await db
    .select({ promptedAt: community.foundersAssemblyPromptedAt })
    .from(community)
    .where(eq(community.id, communityId));
  if (!row) {
    return "hidden";
  }

  // Never shown: stamp the anchor now. This is the one write on this
  // path, and it fires at most once per Community for its entire
  // lifetime — guarded on the column actually being null, so a
  // concurrent second render can't move the anchor. It's deliberately
  // a plain read-path write rather than a dismissal button: the
  // requirement is a time limit, not a choice the user has to make, and
  // making someone click a "no thanks" just to stop a banner reappearing
  // on their next visit is worse than the banner.
  if (row.promptedAt === null) {
    await db
      .update(community)
      .set({ foundersAssemblyPromptedAt: now })
      .where(and(eq(community.id, communityId), isNull(community.foundersAssemblyPromptedAt)));
    return "show";
  }

  return now.getTime() - row.promptedAt.getTime() < PROMPT_WINDOW_MS ? "show" : "hidden";
}

// Exported for the settings page's own copy, and for the test that pins
// the two-week window — a magic number in a test is a magic number.
export const FOUNDERS_PROMPT_WINDOW_DAYS = PROMPT_WINDOW_DAYS;

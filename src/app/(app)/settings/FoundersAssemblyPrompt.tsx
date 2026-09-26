import Link from "next/link";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/components/ui/kit";
import {
  FOUNDING_SETTINGS_GROUPS,
  FOUNDING_SETTINGS_ITEMS,
  FOUNDING_SETTINGS_TEMPLATE_KEY,
  FOUNDING_SETTINGS_TITLE,
} from "@/lib/assemblies";

// The nudge on /settings offering to settle the community's settings
// together instead of whoever holds Admins just setting them.
//
// Placement is this screen's whole point: this is where someone goes
// precisely because they're about to configure something, which is the
// one moment an Assembly offer is relevant rather than promotional.
// docs/spec.md's "Two tiers of setting, not one" already commits a
// community to deciding its foundational settings collectively — the
// gap was never the principle, it was that there was no way to run one.
//
// Shown only while eligible (getFoundersAssemblyPromptState): it goes
// away the moment a settings Assembly exists, and on its own after a
// fortnight. It carries no dismiss button, because there's nothing to
// dismiss *to* — the two weeks are the answer to "I don't want this",
// and adding a "no thanks" that hides it would just mean it reappeared
// for the next person who didn't click it.
export default function FoundersAssemblyPrompt() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--accent-1)] bg-[var(--accent-1-softer)] p-3.5">
      <h2 className="text-[15px] font-semibold text-[var(--text)]">
        Not sure what to set? Decide it together instead.
      </h2>
      <p className="mt-1 text-[13px] text-[var(--text)]">
        An Assembly is this community&rsquo;s own decision-making tool, and a prepared agenda of{" "}
        {FOUNDING_SETTINGS_ITEMS.length} settings questions across{" "}
        {FOUNDING_SETTINGS_GROUPS.length} areas comes with it — recruitment and invites, who holds
        authority, critical tasks and endorsement, which modules are on, how you work together, and
        what you hold about each other.
      </p>
      <p className="mt-1.5 text-[12px] text-[var(--text-muted)]">
        Anyone can propose it, anyone can add to the agenda, and the whole community votes. Results
        stay advisory — when it closes you get every answer printed next to the setting it applies
        to, and you make the changes by hand. Nothing here decides anything on its own.
      </p>
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <Link
          href={`/assemblies/new?template=${FOUNDING_SETTINGS_TEMPLATE_KEY}`}
          className={BUTTON_PRIMARY}
        >
          Start the {FOUNDING_SETTINGS_TITLE} Assembly
        </Link>
        <Link href="/assemblies" className={BUTTON_SECONDARY}>
          See existing Assemblies
        </Link>
      </div>
    </div>
  );
}

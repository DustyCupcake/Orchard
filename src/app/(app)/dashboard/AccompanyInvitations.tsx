import type { member as memberTable } from "@/db/schema";
import { SUGGESTION_REASON_TO_THEM, joinReasons, listMyAccompanyInvitations } from "@/lib/tasks/suggestions";
import { BUTTON_GHOST, BUTTON_PRIMARY } from "@/components/ui/kit";
import { claimAccompanimentAction, dismissAccompanimentSuggestionAction } from "./actions";

type Member = typeof memberTable.$inferSelect;

// docs/plans/accompaniment-plan.md §3.5. A new member with nobody yet, and this member is among the
// people with a reason to be asked: they invited them, vouched for them, or said yes after the
// interview. A pull, on their own dashboard, not an email, and saying why they are being asked.
// "Not me" hides it for them and nothing else; nobody is told and nothing is held against them.
// Says nothing at all when there is nothing to say.
export default async function AccompanyInvitations({ viewing }: { viewing: Member }) {
  const invitations = await listMyAccompanyInvitations(viewing);
  if (invitations.length === 0) return null;
  return (
    <section className="mt-8 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-sunken)] p-5">
      <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Someone new would be glad of you</h2>
      <ul className="mt-2 flex flex-col gap-4">
        {invitations.map((i) => (
          <li key={i.taskId}>
            <p className="text-[length:var(--text-body)] text-[var(--text)]">
              <strong>{i.newcomerName}</strong> has joined and doesn&rsquo;t have anyone to accompany them yet. You were
              thought of because {joinReasons(i.reasons, SUGGESTION_REASON_TO_THEM)}. Would you like to be the person
              they can ask questions of and check in with?
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <form action={claimAccompanimentAction}>
                <input type="hidden" name="taskId" value={i.taskId} />
                <button type="submit" className={BUTTON_PRIMARY}>
                  I&rsquo;ll accompany them
                </button>
              </form>
              <form action={dismissAccompanimentSuggestionAction}>
                <input type="hidden" name="taskId" value={i.taskId} />
                <button type="submit" className={BUTTON_GHOST}>
                  Not me
                </button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

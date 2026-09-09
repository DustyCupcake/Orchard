import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { branch, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { listCycles } from "@/lib/cycles";
import { listAllDistinctTags } from "@/lib/tags";
import { COMMITMENT_PREFERENCE_AXIS_KEY, listTraitAxes } from "@/lib/trait-axes";
import EffortFields from "@/components/EffortFields";
import AxisScaleField from "@/components/AxisScaleField";
import { Banner, BUTTON_PRIMARY, INPUT, LABEL } from "@/components/ui/kit";
import { submitProposal } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProposePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [communityMembers, branches, cycles, communityRow, tagSuggestions, traitAxesRaw] = await Promise.all([
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
    db.select().from(branch).where(eq(branch.communityId, viewing.communityId)),
    listCycles(viewing),
    getCommunity(viewing),
    listAllDistinctTags(viewing),
    listTraitAxes(viewing),
  ]);
  // Commitment preference has no task-side value at all — its task-side
  // value is derived live from Effort instead (src/lib/trait-axes.ts).
  const traitAxes = traitAxesRaw.filter((a) => a.key !== COMMITMENT_PREFERENCE_AXIS_KEY);

  return (
    <main className="mx-auto max-w-[520px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Propose a task</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Just a title and a rough description is enough — no need to know its branch, tags, or
        criticality. Whoever does branch coordination will fill that in when they review it.
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      <form action={submitProposal} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className={LABEL}>Title</span>
          <input type="text" name="title" required className={INPUT} />
        </label>

        <label className="flex flex-col gap-1">
          <span className={LABEL}>Description (optional, rough is fine)</span>
          <textarea name="description" rows={4} className={INPUT} />
        </label>

        <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
          <input type="checkbox" name="wantsToClaim" /> I&rsquo;d like to claim this myself
        </label>

        <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <legend className="px-1 text-[12px] text-[var(--text-muted)]">I&rsquo;d suggest this person (optional)</legend>
          <select name="suggestedMemberId" defaultValue="" className={`${INPUT} w-full`}>
            <option value="">— nobody in particular —</option>
            {communityMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="text"
            name="suggestedMemberNote"
            placeholder="why they'd be a good fit (optional)"
            className={`${INPUT} mt-2 w-full`}
          />
        </fieldset>

        <details className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <summary className="cursor-pointer text-[13px] font-medium text-[var(--text)]">Add more, if you know it (optional)</summary>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Still just a suggestion — whoever reviews this can change any of it before activating.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select name="branchId" defaultValue="" className={INPUT}>
              <option value="">Branch…</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>

            {communityRow.cyclesEnabled && (
              <select name="cycleId" defaultValue="" className={INPUT}>
                <option value="">No cycle (unscoped)</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}

            <EffortFields />
          </div>

          <input
            type="text"
            name="tags"
            placeholder="tags (comma-separated)"
            list="tag-suggestions"
            className={`${INPUT} mt-2 w-full`}
          />
          <datalist id="tag-suggestions">
            {tagSuggestions.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>

          {traitAxes.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              <span className={LABEL}>What kind of task is this? (optional — helps surface it to a good fit)</span>
              {traitAxes.map((axis) => (
                <AxisScaleField key={axis.id} axis={axis} name={`axis_${axis.id}`} />
              ))}
            </div>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-1.5 text-[13px] text-[var(--text-muted)]">
              Capacity:
              <input type="number" name="capacity" placeholder="1" min={1} className={`${INPUT} w-20`} />
            </label>
            <label className="flex items-center gap-2 text-[13px] text-[var(--text)]">
              <input type="checkbox" name="critical" /> Critical
            </label>
          </div>

          <label className="mt-2 flex flex-col gap-1">
            <span className={LABEL}>Due date</span>
            <input type="date" name="dueDate" className={`${INPUT} w-fit`} />
          </label>
        </details>

        <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
          Submit proposal
        </button>
      </form>
    </main>
  );
}

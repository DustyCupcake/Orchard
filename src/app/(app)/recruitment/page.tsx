import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getRecruitmentPipeline, isRecruitmentTaskHolder } from "@/lib/recruitment";
import { Tag } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  evaluation_in_progress: "Evaluation in progress",
  call_pending: "Call pending",
  call_scheduled: "Call scheduled",
  decision_pending: "Decision pending",
  accepted: "Accepted",
  declined: "Declined",
  accompaniment_assigned: "Accompaniment assigned",
};

// "Evaluated-but-uncalled, called-but-undecided" — docs/development-
// plan.md's Phase 35. The same subset src/lib/recruitment/pipeline.ts's
// listRecruitmentActionItems surfaces on /dashboard, flagged here too
// so the pipeline view itself makes the same cases legible in place.
const NEEDS_ACTION_STAGES = new Set(["call_pending", "decision_pending"]);

function timeSince(date: Date): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (days < 1) return "today";
  return days === 1 ? "1 day" : `${days} days`;
}

const TH = "border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
const TD = "border-b border-[var(--border)] px-2 py-2 text-[var(--text)]";

// "A list of everyone currently in flight, their computed stage, and
// how long they've sat there — the same 'list of people and where
// they are' instinct as a task board" — see docs/spec.md's Recruitment
// pipeline view & computed status, and docs/development-plan.md's
// Phase 35. Holder-only, per spec: "not a community-wide view."
export default async function RecruitmentPipelinePage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");
  const isHolder = moduleOn && (await isRecruitmentTaskHolder(viewing));

  const pipeline = isHolder ? await getRecruitmentPipeline(viewing) : null;

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Recruitment pipeline</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && !isHolder && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Only a current recruitment-task holder can see this view. See{" "}
          <Link href="/applications" className="text-[var(--accent-1)] hover:underline">
            Applications
          </Link>{" "}
          for what&rsquo;s visible to everyone else.
        </p>
      )}

      {pipeline && (
        <>
          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">Context</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Informational only — never a scoring formula. What &ldquo;balanced&rdquo; means for
              this group is a human call.
            </p>
            {pipeline.capacity ? (
              <p className="mt-2 text-[13px] text-[var(--text)]">
                Capacity {pipeline.capacity.capacity ?? "unset"} · {pipeline.capacity.comingCount} coming
                this cycle
                {pipeline.capacity.remainingCapacity !== null && (
                  <>
                    {" · "}
                    {pipeline.capacity.remainingCapacity < 0
                      ? `${-pipeline.capacity.remainingCapacity} over capacity`
                      : `${pipeline.capacity.remainingCapacity} remaining`}
                  </>
                )}
              </p>
            ) : (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">No current cycle — remaining capacity isn&rsquo;t tracked.</p>
            )}

            {pipeline.composition.tierCounts.length > 0 && (
              <p className="mt-1 text-[13px] text-[var(--text)]">
                Tiers: {pipeline.composition.tierCounts.map((t) => `${t.name} ${t.count}`).join(" · ")}
              </p>
            )}
            {pipeline.composition.branchSpread.length > 0 && (
              <p className="mt-1 text-[13px] text-[var(--text)]">
                Branches:{" "}
                {pipeline.composition.branchSpread.map((b) => `${b.name} ${b.memberCount}`).join(" · ")}
              </p>
            )}
          </section>

          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">Candidates ({pipeline.candidates.length})</h2>
            {pipeline.candidates.length === 0 && (
              <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nobody in flight right now.</p>
            )}
            {pipeline.candidates.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={TH}>Submitted</th>
                      <th className={TH}>Stage</th>
                      <th className={TH}>Time in stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.candidates.map((c) => (
                      <tr key={c.id} className="hover:bg-[var(--surface-sunken)]">
                        <td className={TD}>{new Date(c.submittedAt).toLocaleDateString()}</td>
                        <td className={TD}>
                          <span className="flex items-center gap-2">
                            {STAGE_LABEL[c.stage] ?? c.stage}
                            {NEEDS_ACTION_STAGES.has(c.stage) && <Tag tone="warning">needs action</Tag>}
                          </span>
                        </td>
                        <td className={TD}>{timeSince(c.stageSince)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-3 text-[13px] text-[var(--text-muted)]">
              Evaluate recommendations, manage the wider-discussion window, or view an
              applicant&rsquo;s own answers on{" "}
              <Link href="/applications" className="text-[var(--accent-1)] hover:underline">
                Applications
              </Link>
              .
            </p>
          </section>
        </>
      )}
    </main>
  );
}

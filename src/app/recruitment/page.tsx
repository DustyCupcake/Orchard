import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import { getRecruitmentPipeline, isRecruitmentTaskHolder } from "@/lib/recruitment";
import Nav from "@/components/Nav";

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

// "A list of everyone currently in flight, their computed stage, and
// how long they've sat there — the same 'list of people and where
// they are' instinct as a task board" — see docs/spec.md's Recruitment
// pipeline view & computed status, and docs/development-plan.md's
// Phase 35. Holder-only, per spec: "not a community-wide view."
export default async function RecruitmentPipelinePage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");
  const isHolder = moduleOn && (await isRecruitmentTaskHolder(currentMember));

  const pipeline = isHolder ? await getRecruitmentPipeline(currentMember) : null;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 860 }}>
      <Nav memberName={currentMember.name} />
      <h1>Recruitment pipeline</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && !isHolder && (
        <p style={{ color: "#666" }}>
          Only a current recruitment-task holder can see this view. See{" "}
          <Link href="/applications">Applications</Link> for what&rsquo;s visible to everyone else.
        </p>
      )}

      {pipeline && (
        <>
          <section style={{ marginTop: "1rem", marginBottom: "1.5rem" }}>
            <h2>Context</h2>
            <p style={{ color: "#666", fontSize: "0.85rem" }}>
              Informational only — never a scoring formula. What &ldquo;balanced&rdquo; means for
              this group is a human call.
            </p>
            {pipeline.capacity ? (
              <p>
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
              <p style={{ color: "#666" }}>No current cycle — remaining capacity isn&rsquo;t tracked.</p>
            )}

            {pipeline.composition.tierCounts.length > 0 && (
              <p style={{ fontSize: "0.85rem" }}>
                Tiers: {pipeline.composition.tierCounts.map((t) => `${t.name} ${t.count}`).join(" · ")}
              </p>
            )}
            {pipeline.composition.branchSpread.length > 0 && (
              <p style={{ fontSize: "0.85rem" }}>
                Branches:{" "}
                {pipeline.composition.branchSpread.map((b) => `${b.name} ${b.memberCount}`).join(" · ")}
              </p>
            )}
          </section>

          <section>
            <h2>Candidates ({pipeline.candidates.length})</h2>
            {pipeline.candidates.length === 0 && (
              <p style={{ color: "#666" }}>Nobody in flight right now.</p>
            )}
            {pipeline.candidates.length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ borderCollapse: "collapse", width: "100%" }}>
                  <thead>
                    <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                      <th style={{ padding: "0.4rem" }}>Submitted</th>
                      <th style={{ padding: "0.4rem" }}>Stage</th>
                      <th style={{ padding: "0.4rem" }}>Time in stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pipeline.candidates.map((c) => (
                      <tr key={c.id} style={{ borderBottom: "1px solid #eee" }}>
                        <td style={{ padding: "0.4rem" }}>{new Date(c.submittedAt).toLocaleDateString()}</td>
                        <td style={{ padding: "0.4rem" }}>
                          {STAGE_LABEL[c.stage] ?? c.stage}
                          {NEEDS_ACTION_STAGES.has(c.stage) && (
                            <span style={{ marginLeft: "0.5rem", color: "#a15c00", fontWeight: 600 }}>
                              ⚠ needs action
                            </span>
                          )}
                        </td>
                        <td style={{ padding: "0.4rem" }}>{timeSince(c.stageSince)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p style={{ marginTop: "0.75rem", fontSize: "0.85rem", color: "#666" }}>
              Evaluate recommendations, manage the wider-discussion window, or view an
              applicant&rsquo;s own answers on <Link href="/applications">Applications</Link>.
            </p>
          </section>
        </>
      )}
    </main>
  );
}

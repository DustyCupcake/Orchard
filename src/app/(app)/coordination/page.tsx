import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { listCapacitySignal } from "@/lib/profile-questions";
import { isCoordinationHolder } from "@/lib/coordination";

export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  has_room: "has room",
  about_right: "about right",
  over: "over",
};

// The Coordination view's capacity-aware fitted asks + availability
// non-response list, combined — see docs/spec.md's Coordination
// mechanics and docs/development-plan.md's Phase 16. Community-wide,
// same scope as the Escalation view: Availability isn't branch-scoped
// data, so there's no branch to narrow it by.
export default async function CoordinationPage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const authorized = await isCoordinationHolder(currentMember, null);
  if (!authorized) {
    return (
      <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
        <h1>Coordination</h1>
        <p style={{ color: "crimson" }}>
          Only a current holder of any branch&rsquo;s coordination-tagged task can see this.
        </p>
      </main>
    );
  }

  const { phaseName, questionLabel, entries } = await listCapacitySignal(currentMember);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Coordination</h1>

      {!phaseName && (
        <p style={{ color: "#666" }}>
          No current phase to show Availability for — a phase needs an end date in the future (or
          none set) on the most recently started cycle.
        </p>
      )}
      {phaseName && !questionLabel && (
        <p style={{ color: "#666" }}>
          Current phase is &ldquo;{phaseName}&rdquo;, but no Profile question feeds the capacity
          signal for it yet — add one on the settings screen (scope &ldquo;phase&rdquo;, phase name
          &ldquo;{phaseName}&rdquo;, feeds capacity signal on).
        </p>
      )}
      {phaseName && questionLabel && (
        <>
          <p style={{ color: "#666" }}>
            &ldquo;{questionLabel}&rdquo; for the current phase (&ldquo;{phaseName}&rdquo;).
          </p>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>
                <th style={{ padding: "0.3rem" }}>Member</th>
                <th style={{ padding: "0.3rem" }}>Availability</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.memberId} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "0.3rem" }}>{e.memberName}</td>
                  <td style={{ padding: "0.3rem" }}>
                    {!e.hasAnswer && <span style={{ color: "crimson" }}>no answer</span>}
                    {e.hasAnswer && e.deferred && (
                      <span style={{ color: "#a06a00" }}>doesn&rsquo;t know yet</span>
                    )}
                    {e.hasAnswer && !e.deferred && e.capacityVisibility === "open" && (
                      <span>
                        {e.declaredHours ?? "—"} hrs/wk declared
                        {e.loadHours !== null ? ` (${e.loadHours} hrs/wk currently held)` : ""}
                      </span>
                    )}
                    {e.hasAnswer && !e.deferred && e.capacityVisibility === "flag_only" && (
                      <span>{e.flag ? FLAG_LABEL[e.flag] : "declared, not comparable"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}

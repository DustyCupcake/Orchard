import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import {
  isConflictTeamMember,
  listConflictReportExclusions,
  listConflictReports,
  listConflictTeamMemberIds,
} from "@/lib/conflict";
import Nav from "@/components/Nav";
import {
  acknowledgeConflictReportAction,
  escalateConflictReportAction,
  fileConflictReportAction,
  recusePeerAction,
  recuseSelfAction,
  resolveConflictReportAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function ConflictReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const communityRow = await getCommunity(currentMember);
  const moduleOn = Boolean(communityRow.conflictTeamTaskId);

  const [isTeamMember, teamMemberIds, reports, communityMembers] = await Promise.all([
    moduleOn ? isConflictTeamMember(currentMember) : false,
    moduleOn ? listConflictTeamMemberIds(currentMember.communityId) : [],
    moduleOn ? listConflictReports(currentMember) : [],
    db.select().from(member).where(eq(member.communityId, currentMember.communityId)),
  ]);
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));
  const excludableMembers = teamMemberIds
    .filter((id) => id !== currentMember.id)
    .map((id) => ({ id, name: memberNameById.get(id) ?? "—" }));

  const exclusionsByReport = new Map<string, { memberId: string; addedBy: string }[]>();
  await Promise.all(
    reports.map(async (r) => {
      const rows = await listConflictReportExclusions(currentMember, r.id);
      exclusionsByReport.set(r.id, rows);
    }),
  );

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Conflict management</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Not set up for this Community yet — a current Admins holder can designate the conflict
          team task on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          <p style={{ color: "#666" }}>
            Reports are visible only to you and whoever&rsquo;s handling it, unless you choose to
            escalate. Filing one takes nothing but wanting to talk to someone.
          </p>

          {error && <p style={{ color: "crimson" }}>{error}</p>}

          <section style={{ marginTop: "1rem" }}>
            <h2>File a report</h2>
            <form
              action={fileConflictReportAction}
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 480 }}
            >
              <textarea
                name="description"
                rows={3}
                placeholder="Optional — detail can come later, in the actual conversation"
                style={{ padding: "0.5rem" }}
              />
              {excludableMembers.length > 0 && (
                <fieldset>
                  <legend style={{ fontSize: "0.85rem" }}>
                    Exclude specific current team members from seeing this (optional)
                  </legend>
                  {excludableMembers.map((m) => (
                    <label key={m.id} style={{ display: "block", fontSize: "0.85rem" }}>
                      <input type="checkbox" name="excludeMemberIds" value={m.id} /> {m.name}
                    </label>
                  ))}
                </fieldset>
              )}
              <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                File report
              </button>
            </form>
          </section>

          <section style={{ marginTop: "2rem" }}>
            <h2>Reports</h2>
            {reports.length === 0 && <p style={{ color: "#666" }}>Nothing visible to you right now.</p>}

            {reports.map((r) => {
              const exclusions = exclusionsByReport.get(r.id) ?? [];
              const isReporter = r.reportedBy === currentMember.id;
              const isPointOfContact = r.acknowledgedBy === currentMember.id;
              const overdue =
                !r.acknowledgedAt &&
                Date.now() - new Date(r.createdAt).getTime() > communityRow.conflictAckWindowHours * 3600_000;

              return (
                <div
                  key={r.id}
                  style={{
                    border: "1px solid #ccc",
                    borderRadius: 6,
                    padding: "0.75rem",
                    marginBottom: "0.75rem",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "#666" }}>
                    Reported by {memberNameById.get(r.reportedBy) ?? "—"} —{" "}
                    {new Date(r.createdAt).toLocaleString()}
                    {r.escalated && <span style={{ color: "#a15c00" }}> · escalated</span>}
                    {overdue && <span style={{ color: "crimson" }}> · overdue for acknowledgment</span>}
                  </p>
                  {r.description && <p>{r.description}</p>}

                  {exclusions.length > 0 && (
                    <p style={{ fontSize: "0.8rem", color: "#666" }}>
                      Excluded: {exclusions.map((e) => memberNameById.get(e.memberId) ?? "—").join(", ")}
                    </p>
                  )}

                  {!r.acknowledgedAt && (
                    <p style={{ fontSize: "0.85rem", color: "#666" }}>Not yet acknowledged.</p>
                  )}
                  {r.acknowledgedAt && !r.resolvedAt && (
                    <p style={{ fontSize: "0.85rem", color: "#666" }}>
                      Point of contact: {memberNameById.get(r.acknowledgedBy!) ?? "—"}
                    </p>
                  )}
                  {r.resolvedAt && (
                    <p style={{ fontSize: "0.85rem", color: "#2a7a2a" }}>
                      Resolved: {r.resolutionNote}
                    </p>
                  )}

                  <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                    {isTeamMember && !r.acknowledgedAt && (
                      <form action={acknowledgeConflictReportAction}>
                        <input type="hidden" name="reportId" value={r.id} />
                        <button type="submit">Acknowledge — I&rsquo;ll take this</button>
                      </form>
                    )}

                    {isPointOfContact && !r.resolvedAt && (
                      <form
                        action={resolveConflictReportAction}
                        style={{ display: "flex", gap: "0.5rem" }}
                      >
                        <input type="hidden" name="reportId" value={r.id} />
                        <input
                          type="text"
                          name="resolutionNote"
                          required
                          placeholder="Resolution note"
                          style={{ padding: "0.3rem" }}
                        />
                        <button type="submit">Mark resolved</button>
                      </form>
                    )}

                    {isReporter && !r.escalated && (
                      <form action={escalateConflictReportAction}>
                        <input type="hidden" name="reportId" value={r.id} />
                        <button type="submit">Escalate to the whole team</button>
                      </form>
                    )}

                    {isTeamMember && (
                      <form action={recuseSelfAction}>
                        <input type="hidden" name="reportId" value={r.id} />
                        <button type="submit">Recuse myself</button>
                      </form>
                    )}

                    {isTeamMember && excludableMembers.length > 0 && (
                      <form action={recusePeerAction} style={{ display: "flex", gap: "0.3rem" }}>
                        <input type="hidden" name="reportId" value={r.id} />
                        <select name="memberId" required defaultValue="" style={{ padding: "0.3rem" }}>
                          <option value="" disabled>
                            Recuse a teammate…
                          </option>
                          {excludableMembers
                            .filter((m) => !exclusions.some((e) => e.memberId === m.id))
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                        <button type="submit">Recuse</button>
                      </form>
                    )}
                  </div>
                </div>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}

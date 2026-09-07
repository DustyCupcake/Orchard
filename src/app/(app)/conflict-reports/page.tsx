import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { listGrantingTaskIds } from "@/lib/permissions";
import {
  isConflictTeamMember,
  listConflictReportExclusions,
  listConflictReports,
  listConflictTeamMemberIds,
} from "@/lib/conflict";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, Tag } from "@/components/ui/kit";
import {
  acknowledgeConflictReportAction,
  escalateConflictReportAction,
  fileConflictReportAction,
  recusePeerAction,
  recuseSelfAction,
  resolveConflictReportAction,
} from "./actions";

export const dynamic = "force-dynamic";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-[22px] font-semibold text-[var(--text)]">{children}</h2>;
}

export default async function ConflictReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const conflictTeamGrantingTaskIds = await listGrantingTaskIds(communityRow.id, "conflict_team");
  const moduleOn = conflictTeamGrantingTaskIds.length > 0;

  const [isTeamMember, teamMemberIds, reports, communityMembers] = await Promise.all([
    moduleOn ? isConflictTeamMember(viewing) : false,
    moduleOn ? listConflictTeamMemberIds(viewing.communityId) : [],
    moduleOn ? listConflictReports(viewing) : [],
    db.select().from(member).where(eq(member.communityId, viewing.communityId)),
  ]);
  const memberNameById = new Map(communityMembers.map((m) => [m.id, m.name]));
  const excludableMembers = teamMemberIds
    .filter((id) => id !== viewing.id)
    .map((id) => ({ id, name: memberNameById.get(id) ?? "—" }));

  const exclusionsByReport = new Map<string, { memberId: string; addedBy: string }[]>();
  await Promise.all(
    reports.map(async (r) => {
      const rows = await listConflictReportExclusions(viewing, r.id);
      exclusionsByReport.set(r.id, rows);
    }),
  );

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Conflict management</h1>

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          Not set up for this Community yet — a current Admins holder can designate the conflict
          team task on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          <p className="mt-2 text-[13px] text-[var(--text-muted)]">
            Reports are visible only to you and whoever&rsquo;s handling it, unless you choose to
            escalate. Filing one takes nothing but wanting to talk to someone.
          </p>

          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <section className="mt-6">
            <SectionHeading>File a report</SectionHeading>
            <form action={fileConflictReportAction} className="mt-3 flex max-w-[480px] flex-col gap-2">
              <textarea
                name="description"
                rows={3}
                placeholder="Optional — detail can come later, in the actual conversation"
                className={INPUT}
              />
              {excludableMembers.length > 0 && (
                <fieldset className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                  <legend className="px-1 text-[12px] text-[var(--text-muted)]">
                    Exclude specific current team members from seeing this (optional)
                  </legend>
                  <div className="flex flex-col gap-1">
                    {excludableMembers.map((m) => (
                      <label key={m.id} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                        <input type="checkbox" name="excludeMemberIds" value={m.id} /> {m.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                File report
              </button>
            </form>
          </section>

          <section className="mt-8">
            <SectionHeading>Reports</SectionHeading>
            {reports.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing visible to you right now.</p>}

            <div className="mt-3 flex flex-col gap-3">
              {reports.map((r) => {
                const exclusions = exclusionsByReport.get(r.id) ?? [];
                const isReporter = r.reportedBy === viewing.id;
                const isPointOfContact = r.acknowledgedBy === viewing.id;
                const overdue =
                  !r.acknowledgedAt &&
                  Date.now() - new Date(r.createdAt).getTime() > communityRow.conflictAckWindowHours * 3600_000;

                return (
                  <div key={r.id} className={CARD}>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-[12px] text-[var(--text-muted)]">
                        Reported by {memberNameById.get(r.reportedBy) ?? "—"} —{" "}
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                      {r.escalated && <Tag tone="warning">escalated</Tag>}
                      {overdue && <Tag tone="danger">overdue for acknowledgment</Tag>}
                    </div>
                    {r.description && <p className="mt-2 text-[13px] text-[var(--text)]">{r.description}</p>}

                    {exclusions.length > 0 && (
                      <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                        Excluded: {exclusions.map((e) => memberNameById.get(e.memberId) ?? "—").join(", ")}
                      </p>
                    )}

                    {!r.acknowledgedAt && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Not yet acknowledged.</p>}
                    {r.acknowledgedAt && !r.resolvedAt && (
                      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
                        Point of contact: {memberNameById.get(r.acknowledgedBy!) ?? "—"}
                      </p>
                    )}
                    {r.resolvedAt && (
                      <p className="mt-2 text-[13px] text-[var(--success)]">Resolved: {r.resolutionNote}</p>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      {isTeamMember && !r.acknowledgedAt && (
                        <form action={acknowledgeConflictReportAction}>
                          <input type="hidden" name="reportId" value={r.id} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            Acknowledge — I&rsquo;ll take this
                          </button>
                        </form>
                      )}

                      {isPointOfContact && !r.resolvedAt && (
                        <form action={resolveConflictReportAction} className="flex gap-2">
                          <input type="hidden" name="reportId" value={r.id} />
                          <input type="text" name="resolutionNote" required placeholder="Resolution note" className={INPUT} />
                          <button type="submit" className={BUTTON_PRIMARY}>
                            Mark resolved
                          </button>
                        </form>
                      )}

                      {isReporter && !r.escalated && (
                        <form action={escalateConflictReportAction}>
                          <input type="hidden" name="reportId" value={r.id} />
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Escalate to the whole team
                          </button>
                        </form>
                      )}

                      {isTeamMember && (
                        <form action={recuseSelfAction}>
                          <input type="hidden" name="reportId" value={r.id} />
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Recuse myself
                          </button>
                        </form>
                      )}

                      {isTeamMember && excludableMembers.length > 0 && (
                        <form action={recusePeerAction} className="flex gap-2">
                          <input type="hidden" name="reportId" value={r.id} />
                          <select name="memberId" required defaultValue="" className={INPUT}>
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
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Recuse
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}

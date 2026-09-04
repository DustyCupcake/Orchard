import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { listCapacitySignal } from "@/lib/profile-questions";
import { isCoordinationHolder } from "@/lib/coordination";
import { listEngagementPatternsForCoordinator } from "@/lib/engagement";
import { Tag, type Tone, Banner } from "@/components/ui/kit";

export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  has_room: "has room",
  about_right: "about right",
  over: "over",
};

const PATTERN_TONE: Record<string, Tone> = {
  noted: "neutral",
  soft_flag: "warning",
  pattern: "danger",
};
const PATTERN_LABEL: Record<string, string> = {
  noted: "noted",
  soft_flag: "soft flag",
  pattern: "pattern — worth a conversation",
};

// The Coordination view's capacity-aware fitted asks + availability
// non-response list, combined — see docs/spec.md's Coordination
// mechanics and docs/development-plan.md's Phase 16. Community-wide,
// same scope as the Escalation view: Availability isn't branch-scoped
// data, so there's no branch to narrow it by.
export default async function CoordinationPage() {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const authorized = await isCoordinationHolder(viewing, null);
  if (!authorized) {
    return (
      <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
        <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Coordination</h1>
        <div className="mt-4">
          <Banner tone="danger">Only a current holder of any branch&rsquo;s coordination-tagged task can see this.</Banner>
        </div>
      </main>
    );
  }

  const { phaseName, questionLabel, entries } = await listCapacitySignal(viewing);
  const engagementPatterns = await listEngagementPatternsForCoordinator(viewing);

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Coordination</h1>

      {engagementPatterns.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[22px] font-semibold text-[var(--text)]">Engagement patterns</h2>
          <p className="mt-1 text-[13px] text-[var(--text-muted)]">
            Members on tasks you coordinate with open non-responses — never an automatic
            consequence, just a real signal worth a human conversation.
          </p>
          <ul className="mt-3">
            {engagementPatterns.map((p) => (
              <li key={p.memberId} className="flex items-center justify-between gap-3 border-b border-[var(--border)] py-2 text-[13px] last:border-b-0">
                <span className="text-[var(--text)]">{p.memberName}</span>
                <span className="flex items-center gap-2">
                  <span className="text-[var(--text-muted)]">
                    {p.openCount} open non-response{p.openCount === 1 ? "" : "s"}
                  </span>
                  <Tag tone={PATTERN_TONE[p.level] ?? "neutral"}>{PATTERN_LABEL[p.level] ?? p.level}</Tag>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8">
        {!phaseName && (
          <p className="text-[13px] text-[var(--text-muted)]">
            No current phase to show Availability for — a phase needs an end date in the future (or
            none set) on the most recently started cycle.
          </p>
        )}
        {phaseName && !questionLabel && (
          <p className="text-[13px] text-[var(--text-muted)]">
            Current phase is &ldquo;{phaseName}&rdquo;, but no Profile question feeds the capacity
            signal for it yet — add one on the settings screen (scope &ldquo;phase&rdquo;, phase name
            &ldquo;{phaseName}&rdquo;, feeds capacity signal on).
          </p>
        )}
        {phaseName && questionLabel && (
          <>
            <p className="text-[13px] text-[var(--text-muted)]">
              &ldquo;{questionLabel}&rdquo; for the current phase (&ldquo;{phaseName}&rdquo;).
            </p>
            <table className="mt-3 w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Member
                  </th>
                  <th className="border-b border-[var(--border)] px-2 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    Availability
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.memberId} className="hover:bg-[var(--surface-sunken)]">
                    <td className="border-b border-[var(--border)] px-2 py-2 text-[var(--text)]">{e.memberName}</td>
                    <td className="border-b border-[var(--border)] px-2 py-2">
                      {!e.hasAnswer && <span className="text-[var(--danger)]">no answer</span>}
                      {e.hasAnswer && e.deferred && <span className="text-[var(--warning)]">doesn&rsquo;t know yet</span>}
                      {e.hasAnswer && !e.deferred && e.capacityVisibility === "open" && (
                        <span className="text-[var(--text)]">
                          {e.declaredHours ?? "—"} hrs/wk declared
                          {e.loadHours !== null ? ` (${e.loadHours} hrs/wk currently held)` : ""}
                        </span>
                      )}
                      {e.hasAnswer && !e.deferred && e.capacityVisibility === "flag_only" && (
                        <span className="text-[var(--text)]">{e.flag ? FLAG_LABEL[e.flag] : "declared, not comparable"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </main>
  );
}

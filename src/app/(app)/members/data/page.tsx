import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getConsentGaps, getMemberData } from "@/lib/member-data";

export const dynamic = "force-dynamic";

const TH = "border-b border-[var(--border)] px-2 py-2 text-left text-[length:var(--text-micro)] font-semibold uppercase tracking-wide text-[var(--text-muted)]";
const TD = "border-b border-[var(--border)] px-2 py-2 align-top text-[var(--text)]";

/**
 * The roster-wide read. Replaces `/sensitive-data`, which could only ever
 * show four hardcoded `member` columns; this shows every question the
 * viewer is allowed to read about other people, which is a superset that
 * happens to include the sensitive ones.
 *
 * Deliberately not only sensitive data. A coordinator planning an event
 * wants the same grid either way — pick the columns, read the values,
 * count them — and a page that only showed the sensitive ones would be a
 * worse version of this one that people had to keep two of.
 */
export default async function MemberDataPage({
  searchParams,
}: {
  searchParams: Promise<{ columns?: string; q?: string; view?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const params = await searchParams;
  // `columns` is a repeated query param (`?columns=a&columns=b`), the
  // shape the codebase already uses for multi-value form fields, because
  // a comma-joined string would break on any label containing a comma —
  // and free-text question labels very often do.
  const requested = params.columns
    ? Array.isArray(params.columns)
      ? params.columns
      : [params.columns]
    : undefined;
  const filter = params.q ?? "";
  const asReport = params.view === "report";

  const [data, all] = await Promise.all([
    getMemberData(viewing, { questionIds: requested, filter }),
    // Fetched separately so the column picker can list the withheld ones
    // with their reason. Cheap: the selection only changes which columns
    // are rendered, and the unavailable list doesn't depend on it.
    getMemberData(viewing, {}),
  ]);
  const consentGaps = await getConsentGaps(
    viewing.communityId,
    data.columns.map((c) => c.question.id),
  );
  const gapByQuestion = new Map(consentGaps.map((g) => [g.questionId, g]));

  const allColumns: { id: string; label: string; withheld: boolean }[] = [
    ...all.columns.map((c) => ({ id: c.question.id, label: c.question.label, withheld: false })),
    ...all.unavailable.map((u) => ({ id: u.id, label: u.label, withheld: true })),
  ];

  return (
    <main className="mx-auto max-w-[1000px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">Member data</h1>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        Everything your Community asks about its members, in one table. Pick the columns, filter to a
        value, or read the counts. You only ever see a question you&rsquo;re entitled to — anyone
        else&rsquo;s answer is absent rather than hidden, so nothing is here for you to
        accidentally reveal.
      </p>
      <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
        A question per event is asked again each time, so it isn&rsquo;t here — that&rsquo;s{" "}
        <Link href="/questions" className="text-[var(--accent-1)] hover:underline">
          /questions
        </Link>
        . For a single person,{" "}
        <Link href="/members" className="text-[var(--accent-1)] hover:underline">
          their own page
        </Link>
        .
      </p>

      {allColumns.length > 0 && (
        <form method="get" className="mt-4 flex flex-col gap-2">
          <input type="hidden" name="view" value={asReport ? "report" : "table"} />
          {filter && <input type="hidden" name="q" value={filter} />}
          <span className="text-[length:var(--text-meta)] font-medium text-[var(--text)]">Columns</span>
          <div className="flex flex-wrap gap-3">
            {allColumns.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-[length:var(--text-body)] text-[var(--text)]">
                <input
                  type="checkbox"
                  name="columns"
                  value={c.id}
                  defaultChecked={!c.withheld && (!requested || requested.includes(c.id))}
                  disabled={c.withheld}
                />
                {c.label}
                {c.withheld && (
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    — restricted, you&rsquo;re not in the audience
                  </span>
                )}
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">Contains</span>
              <input
                type="text"
                name="q"
                defaultValue={filter}
                placeholder="e.g. peanut"
                className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1.5 text-[length:var(--text-body)] text-[var(--text)]"
              />
            </label>
            <button type="submit" className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)]">
              Apply
            </button>
            <Link
              href="/members/data"
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)]"
            >
              All columns
            </Link>
            <Link
              href={asReport ? "/members/data" : "/members/data?view=report"}
              className="rounded-[var(--radius-md)] border border-[var(--border)] px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--surface-sunken)]"
            >
              {asReport ? "Show the table" : "Show reports"}
            </Link>
          </div>
        </form>
      )}

      {data.columns.length === 0 && (
        <p className="mt-6 text-[length:var(--text-body)] text-[var(--text-muted)]">
          No columns selected. Tick one above — or{" "}
          <Link href="/members/data" className="text-[var(--accent-1)] hover:underline">
            show all
          </Link>
          .
        </p>
      )}

      {data.columns.length > 0 && asReport && (
        <div className="mt-6 flex flex-col gap-4">
          {data.columns.map((c) => {
            const gap = gapByQuestion.get(c.question.id);
            return (
              <section key={c.question.id} className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
                <h2 className="text-[length:var(--text-heading)] font-semibold text-[var(--text)]">{c.question.label}</h2>
                <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                  {filter
                    ? `${c.entries.length} matching, of ${c.population} members`
                    : `${c.entries.length} of ${c.population} have answered`}
                  {c.deferredCount > 0 && ` · ${c.deferredCount} said &ldquo;I don&rsquo;t know yet&rdquo;`}
                  {c.declinedCount > 0 && ` · ${c.declinedCount} preferred not to say`}
                  {gap && ` · gated on &ldquo;${gap.purposeLabel}&rdquo;, which ${gap.consentedCount} have agreed to`}
                </p>
                {c.breakdown && (
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {c.breakdown.map((b) => (
                      <li
                        key={b.option}
                        className="rounded-[var(--radius-md)] border border-[var(--border)] px-2 py-1 text-[length:var(--text-body)] text-[var(--text)]"
                      >
                        {b.option} <span className="text-[var(--text-muted)]">{b.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* The values are listed as well as counted, because the
                    count is a planning input and the value is what you
                    actually need to act on — "3 gluten-free" doesn't tell
                    you which dishes to swap. */}
                {c.entries.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {c.entries.map((e) => (
                      <li key={e.memberId} className="text-[length:var(--text-body)] text-[var(--text)]">
                        <Link
                          href={`/members/${e.memberId}`}
                          className="font-medium text-[var(--accent-1)] hover:underline"
                        >
                          {e.memberName}
                        </Link>
                        <span className="text-[var(--text-muted)]"> — {e.display}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {data.columns.length > 0 && !asReport && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-[length:var(--text-body)]">
            <thead>
              <tr>
                <th className={TH}>Member</th>
                {data.columns.map((c) => (
                  <th key={c.question.id} className={TH}>
                    {c.question.label}
                    {c.question.sensitive && (
                      <span className="block font-normal normal-case text-[var(--text-muted)]">
                        restricted
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => {
                const rowEmpty = data.columns.every(
                  (c) => !c.entries.some((e) => e.memberId === m.id),
                );
                return (
                  <tr key={m.id} className="hover:bg-[var(--surface-sunken)]">
                    <td className={TD}>
                      <Link href={`/members/${m.id}`} className="text-[var(--text)] hover:underline">
                        {m.name}
                      </Link>
                    </td>
                    {data.columns.map((c) => {
                      const entry = c.entries.find((e) => e.memberId === m.id);
                      return (
                        <td key={c.question.id} className={TD}>
                          {entry ? (
                            entry.display
                          ) : rowEmpty ? (
                            <span className="text-[var(--text-muted)]">—</span>
                          ) : (
                            <span className="text-[var(--text-muted)]">&nbsp;</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

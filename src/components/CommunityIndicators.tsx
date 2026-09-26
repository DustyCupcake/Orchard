import type { CommunityIndicator, IndicatorData, IndicatorScope } from "@/lib/profile-questions/indicators";

/**
 * The published indicators.
 *
 * Plain Server Component, no "use client" — there's nothing here to
 * interact with, and the numbers are decided on the server, so shipping
 * this to the client would only be weight.
 *
 * Nothing here is coordinator-gated, and that is the point rather than an
 * oversight: an indicator's entire purpose is to tell the community
 * something about itself. Gating the breakdown meant most members saw
 * "3 of 4 answered" — which is a set of facts about a small, nameable
 * group — and no actual content, which is the worst of both. The
 * protections that belong here are consent (a member can decline, and a
 * pre-publication answer is asked about before it's counted) and the
 * community's own choice of what to publish, not a permission tier.
 *
 * Three things every number here obeys:
 *
 *  - **A share is always shown with its denominator**, and the denominator
 *    is named. "62%" on its own is a claim about a population nobody can
 *    see the size of, and 62% of four members and 62% of four hundred read
 *    identically. When the population is one event's attendees rather
 *    than the whole community, the heading says so — otherwise the same
 *    indicator silently means two different things on two different
 *    pages, which is the one failure a proportion can't survive.
 *  - **A refusal is never silence.** "Preferred not to say" and "haven't"
 *    are different states with different meanings, and neither is folded
 *    into the other or into the distribution.
 *  - **"Something else" is a row like any other.** The escape hatch
 *    exists so a closed vocabulary doesn't exclude people, and folding
 *    their answers into a neighbouring option — or dropping them, which
 *    would make the parts fail to sum — undoes exactly that. It's a
 *    count, never the words.
 */
export default function CommunityIndicators({
  scope,
  indicators,
  scopeFallback,
}: {
  scope: IndicatorScope;
  indicators: CommunityIndicator[];
  /** Why the requested scope was narrowed, when it was. */
  scopeFallback?: string | null;
}) {
  if (indicators.length === 0) return null;
  // Every indicator on a page shares one population, so the count comes
  // off the first — and naming it in the heading is what stops the same
  // indicator silently meaning two different things on two pages.
  const population = indicators[0].population;

  return (
    <section className="mt-6">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        About this community
      </h2>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Chosen by this community from its own standing questions. Everyone here chose to answer their
        own; nobody is named.
        {/* Only stated when the population isn't the whole community —
            on /community it would just be noise, and the heading already
            says who's being described. */}
        {scope.kind === "event" ? (
          <>
            {" "}
            Each one describes the {population} member{population === 1 ? "" : "s"} coming to{" "}
            <strong className="font-semibold text-[var(--text)]">{scope.cycleName}</strong>.
          </>
        ) : (
          scopeFallback && (
            <>
              {" "}
              <span className="text-[var(--text)]">{scopeFallback}</span>
            </>
          )
        )}
      </p>
      <ul className="mt-3 flex flex-col gap-3">
        {indicators.map((ind) => (
          <Indicator key={ind.questionId} indicator={ind} />
        ))}
      </ul>
    </section>
  );
}

function Indicator({ indicator }: { indicator: CommunityIndicator }) {
  const { data, answered, declined, population, label } = indicator;
  // Everyone who could have answered and didn't: neither a real answer,
  // a refusal, nor a pending consent — and never anyone who opted out,
  // since those aren't in the population at all. Held as a single number
  // rather than folded into "declined" so the two are never confused —
  // one is a gap to fill, the other is a decision to respect.
  const notAnswered = Math.max(0, population - answered - declined);

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
      <p className="text-[14px] font-medium text-[var(--text)]">{label}</p>
      <Coverage
        answered={answered}
        declined={declined}
        notAnswered={notAnswered}
        population={population}
      />

      {data.family === "summary" ? (
        <SummaryFigures data={data} />
      ) : (
        <SplitRows data={data} answered={answered} distribution={data.family === "distribution"} />
      )}
    </li>
  );
}

function Coverage({
  answered,
  declined,
  notAnswered,
  population,
}: {
  answered: number;
  declined: number;
  notAnswered: number;
  population: number;
}) {
  const parts = [`${answered} of ${population} answered`];
  if (declined > 0) parts.push(`${declined} preferred not to say`);
  if (notAnswered > 0) parts.push(`${notAnswered} haven't`);
  return (
    <p className="mt-0.5 text-[12px] text-[var(--text-muted)]">{parts.join(" · ")}</p>
  );
}

function SplitRows({
  data,
  answered,
  distribution,
}: {
  data: Extract<IndicatorData, { family: "split" | "distribution" }>;
  answered: number;
  distribution: boolean;
}) {
  if (answered === 0) {
    return (
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Nobody&rsquo;s answered this yet, so there&rsquo;s nothing to show.
      </p>
    );
  }

  return (
    <ul className="mt-2.5 flex flex-col gap-1.5">
      {data.rows.map((row) => {
        // The denominator differs by family, and this is the whole reason
        // `distribution` is a separate family: for a pick-any question the
        // honest denominator is the number of people, not the number of
        // picks, so 3 of 5 people means 60% of *people* — and a
        // distribution is not a share of anything, so a bar is scaled
        // against the busiest row rather than drawn as a slice of one.
        const share = Math.round((row.count / answered) * 100);
        const widest = distribution
          ? Math.max(1, ...data.rows.map((r) => r.count))
          : answered;
        const width = Math.round((row.count / widest) * 100);
        return (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span className="text-[var(--text)]">{row.label}</span>
              <span className="text-[12px] text-[var(--text-muted)]">
                {row.count} · {share}%
              </span>
            </div>
            <div className="mt-0.5 h-1 w-full overflow-hidden rounded-[var(--radius-sm)] bg-[var(--surface-sunken)]">
              <div
                className="h-full rounded-[var(--radius-sm)] bg-[var(--accent-1)]"
                style={{ width: `${width}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function SummaryFigures({ data }: { data: Extract<IndicatorData, { family: "summary" }> }) {
  if (data.figures.length === 0) {
    return (
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Nobody&rsquo;s answered this yet, so there&rsquo;s nothing to show.
      </p>
    );
  }
  return (
    <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
      {data.figures.map((f) => (
        <div key={f.label}>
          <dt className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">{f.label}</dt>
          <dd className="text-[15px] font-medium text-[var(--text)]">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

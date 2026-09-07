import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getAssembly } from "@/lib/assemblies";
import { Banner, BUTTON_PRIMARY, CARD, INPUT, Tag, type Tone } from "@/components/ui/kit";
import { addAgendaItemAction, submitAssemblyResponseAction } from "./actions";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building — anyone can add an item",
  notice: "Notice — agenda locked, voting opens soon",
  voting: "Voting open",
  closed: "Closed",
};

const PHASE_TONE: Record<string, Tone> = {
  agenda: "neutral",
  notice: "neutral",
  voting: "warning",
  closed: "neutral",
};

export default async function AssemblyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;
  const a = await getAssembly(viewing, id);

  return (
    <main className="mx-auto max-w-[640px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">{a.title}</h1>
      {a.description && <p className="mt-2 text-[13px] text-[var(--text)]">{a.description}</p>}
      <div className="mt-2 flex items-center gap-2">
        <Tag tone={PHASE_TONE[a.phase]}>{PHASE_LABEL[a.phase] ?? a.phase}</Tag>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        Agenda closes {a.agendaEndsAt.toLocaleString()} · Voting opens {a.noticeEndsAt.toLocaleString()} ·
        Closes {a.votingEndsAt.toLocaleString()}
      </p>
      {a.phase === "closed" && (
        <p className="mt-2 text-[13px] text-[var(--text-muted)]">
          Closed. Results below are final — turning any of this into an actual change is a
          separate, deliberate step someone takes by hand.
        </p>
      )}

      {error && (
        <div className="mt-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {a.questions.length === 0 && <p className="mt-6 text-[13px] text-[var(--text-muted)]">No agenda items yet.</p>}
      <div className="mt-6 flex flex-col gap-2">
        {a.questions.map((q) => {
          const tally =
            q.responseType !== "free_text"
              ? q.options.map((o) => ({
                  option: o,
                  count: q.responses.filter((r) => {
                    const v = r.value as string | string[];
                    return Array.isArray(v) ? v.includes(o) : v === o;
                  }).length,
                }))
              : null;
          return (
            <div key={q.id} className={CARD}>
              <p className="text-[14px] font-medium text-[var(--text)]">{q.text}</p>

              {a.phase === "voting" && (
                <form action={submitAssemblyResponseAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="assemblyId" value={a.id} />
                  <input type="hidden" name="questionId" value={q.id} />
                  {q.responseType === "free_text" && (
                    <input
                      type="text"
                      name="value"
                      defaultValue={typeof q.myResponse?.value === "string" ? q.myResponse.value : ""}
                      className={INPUT}
                    />
                  )}
                  {q.responseType === "single_choice" && (
                    <div className="flex flex-col gap-1">
                      {q.options.map((o) => (
                        <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                          <input type="radio" name="value" value={o} defaultChecked={q.myResponse?.value === o} /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {q.responseType === "multi_choice" && (
                    <div className="flex flex-col gap-1">
                      {q.options.map((o) => (
                        <label key={o} className="flex items-center gap-2 text-[13px] text-[var(--text)]">
                          <input
                            type="checkbox"
                            name="value_multi"
                            value={o}
                            defaultChecked={Array.isArray(q.myResponse?.value) && q.myResponse.value.includes(o)}
                          />{" "}
                          {o}
                        </label>
                      ))}
                    </div>
                  )}
                  <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                    {q.myResponse ? "Update answer" : "Vote"}
                  </button>
                </form>
              )}

              {tally && q.responses.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-[var(--text-muted)]">
                  {tally.map((t) => (
                    <li key={t.option}>
                      {t.option}: {t.count}
                    </li>
                  ))}
                </ul>
              )}
              {!tally && q.responses.length > 0 && (
                <ul className="mt-2 flex flex-col gap-0.5 text-[13px] text-[var(--text-muted)]">
                  {q.responses.map((r) => (
                    <li key={r.id}>{String(r.value)}</li>
                  ))}
                </ul>
              )}
              {q.responses.length === 0 && (
                <p className="mt-2 text-[12px] text-[var(--text-muted)]">No responses yet.</p>
              )}
            </div>
          );
        })}
      </div>

      {a.phase === "agenda" && (
        <form action={addAgendaItemAction} className="mt-6 flex max-w-[500px] flex-col gap-2">
          <input type="hidden" name="assemblyId" value={a.id} />
          <input type="text" name="text" required placeholder="Add an agenda item" className={INPUT} />
          <select name="responseType" defaultValue="free_text" className={INPUT}>
            <option value="free_text">Free text</option>
            <option value="single_choice">Single choice</option>
            <option value="multi_choice">Multi choice</option>
          </select>
          <input type="text" name="options" placeholder="options for choice types, comma-separated" className={INPUT} />
          <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
            Add to agenda
          </button>
        </form>
      )}
    </main>
  );
}

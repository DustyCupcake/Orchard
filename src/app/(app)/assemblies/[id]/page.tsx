import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getAssembly } from "@/lib/assemblies";
import { addAgendaItemAction, submitAssemblyResponseAction } from "./actions";

export const dynamic = "force-dynamic";

const PHASE_LABEL: Record<string, string> = {
  agenda: "Agenda building — anyone can add an item",
  notice: "Notice — agenda locked, voting opens soon",
  voting: "Voting open",
  closed: "Closed",
};

export default async function AssemblyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { id } = await params;
  const { error } = await searchParams;
  const a = await getAssembly(currentMember, id);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>{a.title}</h1>
      {a.description && <p>{a.description}</p>}
      <p style={{ color: "#666" }}>
        {PHASE_LABEL[a.phase] ?? a.phase}
        <br />
        Agenda closes {a.agendaEndsAt.toLocaleString()} · Voting opens {a.noticeEndsAt.toLocaleString()} ·
        Closes {a.votingEndsAt.toLocaleString()}
      </p>
      {a.phase === "closed" && (
        <p style={{ color: "#666" }}>
          Closed. Results below are final — turning any of this into an actual change is a
          separate, deliberate step someone takes by hand.
        </p>
      )}

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {a.questions.length === 0 && <p style={{ color: "#666" }}>No agenda items yet.</p>}
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
          <div
            key={q.id}
            style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
          >
            <strong>{q.text}</strong>

            {a.phase === "voting" && (
              <form
                action={submitAssemblyResponseAction}
                style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}
              >
                <input type="hidden" name="assemblyId" value={a.id} />
                <input type="hidden" name="questionId" value={q.id} />
                {q.responseType === "free_text" && (
                  <input
                    type="text"
                    name="value"
                    defaultValue={typeof q.myResponse?.value === "string" ? q.myResponse.value : ""}
                    style={{ padding: "0.4rem" }}
                  />
                )}
                {q.responseType === "single_choice" && (
                  <div>
                    {q.options.map((o) => (
                      <label key={o} style={{ display: "block" }}>
                        <input type="radio" name="value" value={o} defaultChecked={q.myResponse?.value === o} />{" "}
                        {o}
                      </label>
                    ))}
                  </div>
                )}
                {q.responseType === "multi_choice" && (
                  <div>
                    {q.options.map((o) => (
                      <label key={o} style={{ display: "block" }}>
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
                <button type="submit" style={{ padding: "0.3rem 0.8rem", width: "fit-content" }}>
                  {q.myResponse ? "Update answer" : "Vote"}
                </button>
              </form>
            )}

            {tally && q.responses.length > 0 && (
              <ul style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {tally.map((t) => (
                  <li key={t.option}>
                    {t.option}: {t.count}
                  </li>
                ))}
              </ul>
            )}
            {!tally && q.responses.length > 0 && (
              <ul style={{ fontSize: "0.85rem", margin: "0.3rem 0 0" }}>
                {q.responses.map((r) => (
                  <li key={r.id}>{String(r.value)}</li>
                ))}
              </ul>
            )}
            {q.responses.length === 0 && (
              <p style={{ fontSize: "0.8rem", color: "#666", margin: "0.3rem 0 0" }}>No responses yet.</p>
            )}
          </div>
        );
      })}

      {a.phase === "agenda" && (
        <form
          action={addAgendaItemAction}
          style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "1rem", maxWidth: 500 }}
        >
          <input type="hidden" name="assemblyId" value={a.id} />
          <input type="text" name="text" required placeholder="Add an agenda item" style={{ padding: "0.4rem" }} />
          <select name="responseType" defaultValue="free_text" style={{ padding: "0.4rem" }}>
            <option value="free_text">Free text</option>
            <option value="single_choice">Single choice</option>
            <option value="multi_choice">Multi choice</option>
          </select>
          <input
            type="text"
            name="options"
            placeholder="options for choice types, comma-separated"
            style={{ padding: "0.4rem" }}
          />
          <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
            Add to agenda
          </button>
        </form>
      )}
    </main>
  );
}

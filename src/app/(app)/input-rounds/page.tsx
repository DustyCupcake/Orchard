import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getNextCutoffAt, listCurrentRoundQuestions } from "@/lib/input-rounds";
import { submitQuestionResponseAction } from "./actions";

export const dynamic = "force-dynamic";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The "single sitting" answering surface for the Community's current
// Input round — see docs/spec.md's "Input rounds". Every question
// bundled into the current round, across every task, answered from
// one place rather than hunting through individual task pages.
export default async function InputRoundsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [{ round, questions }, nextCutoffAt] = await Promise.all([
    listCurrentRoundQuestions(currentMember),
    getNextCutoffAt(currentMember),
  ]);

  const reminderDue = nextCutoffAt ? nextCutoffAt.getTime() - Date.now() < MS_PER_DAY : false;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <h1>Input round</h1>
      <p style={{ color: "#666" }}>
        Small, task-specific questions batch on a fixed cadence rather than pinging you one at a
        time — pose one from any task&rsquo;s detail page any time; answer everything currently
        open here, in one sitting.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {reminderDue && nextCutoffAt && (
        <p style={{ color: "#a15c00" }}>
          Get your questions in — the next round cuts on {nextCutoffAt.toLocaleString()}.
        </p>
      )}

      {!round && <p style={{ color: "#666" }}>No round open right now.</p>}
      {round && questions.length === 0 && (
        <p style={{ color: "#666" }}>The current round has no questions in it.</p>
      )}

      {questions.map(({ question, taskId, taskTitle, branchName, myResponse }) => (
        <div
          key={question.id}
          style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
        >
          <div style={{ fontSize: "0.8rem", color: "#666" }}>
            {branchName} ·{" "}
            <Link href={`/tasks/${taskId}`} style={{ color: "inherit" }}>
              {taskTitle}
            </Link>
            {question.priority ? " · can't move forward without this" : ""}
            {question.deadline ? ` · needed by ${new Date(question.deadline).toLocaleDateString()}` : ""}
          </div>
          <strong>{question.text}</strong>

          <form
            action={submitQuestionResponseAction}
            style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginTop: "0.4rem" }}
          >
            <input type="hidden" name="questionId" value={question.id} />
            {question.responseType === "free_text" && (
              <input
                type="text"
                name="value"
                defaultValue={typeof myResponse?.value === "string" ? myResponse.value : ""}
                style={{ padding: "0.4rem" }}
              />
            )}
            {question.responseType === "single_choice" && (
              <div>
                {question.options.map((o) => (
                  <label key={o} style={{ display: "block" }}>
                    <input type="radio" name="value" value={o} defaultChecked={myResponse?.value === o} />{" "}
                    {o}
                  </label>
                ))}
              </div>
            )}
            {question.responseType === "multi_choice" && (
              <div>
                {question.options.map((o) => (
                  <label key={o} style={{ display: "block" }}>
                    <input
                      type="checkbox"
                      name="value_multi"
                      value={o}
                      defaultChecked={Array.isArray(myResponse?.value) && myResponse.value.includes(o)}
                    />{" "}
                    {o}
                  </label>
                ))}
              </div>
            )}
            <button type="submit" style={{ padding: "0.3rem 0.8rem", width: "fit-content" }}>
              {myResponse ? "Update answer" : "Answer"}
            </button>
          </form>
        </div>
      ))}
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { getNextCutoffAt, listCurrentRoundQuestions } from "@/lib/input-rounds";
import { Banner, BUTTON_PRIMARY, INPUT, Tag } from "@/components/ui/kit";
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
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const [{ round, questions }, nextCutoffAt] = await Promise.all([
    listCurrentRoundQuestions(viewing),
    getNextCutoffAt(viewing),
  ]);

  const reminderDue = nextCutoffAt ? nextCutoffAt.getTime() - Date.now() < MS_PER_DAY : false;

  return (
    <main className="mx-auto max-w-[720px] px-6 py-10 md:px-12 md:py-14">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Input round</h1>
      <p className="mt-2 text-[13px] text-[var(--text-muted)]">
        Small, task-specific questions batch on a fixed cadence rather than pinging you one at a
        time — pose one from any task&rsquo;s detail page any time; answer everything currently
        open here, in one sitting.
      </p>

      {error && <div className="mt-4"><Banner tone="danger">{error}</Banner></div>}

      {reminderDue && nextCutoffAt && (
        <div className="mt-4">
          <Banner tone="warning">Get your questions in — the next round cuts on {nextCutoffAt.toLocaleString()}.</Banner>
        </div>
      )}

      {!round && <p className="mt-6 text-[13px] text-[var(--text-muted)]">No round open right now.</p>}
      {round && questions.length === 0 && (
        <p className="mt-6 text-[13px] text-[var(--text-muted)]">The current round has no questions in it.</p>
      )}

      <div className="mt-6">
        {questions.map(({ question, taskId, taskTitle, branchName, myResponse }) => (
          <div key={question.id} className="mb-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3.5">
            <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--text-muted)]">
              {branchName} ·{" "}
              <Link href={`/tasks/${taskId}`} className="font-medium text-[var(--accent-1)] hover:underline">
                {taskTitle}
              </Link>
              {question.priority && <Tag tone="warning">can&rsquo;t move forward without this</Tag>}
              {question.deadline && <Tag>needed by {new Date(question.deadline).toLocaleDateString()}</Tag>}
            </div>
            <p className="mt-1 text-[14px] font-medium text-[var(--text)]">{question.text}</p>

            <form action={submitQuestionResponseAction} className="mt-2 flex flex-col gap-2">
              <input type="hidden" name="questionId" value={question.id} />
              {question.responseType === "free_text" && (
                <input
                  type="text"
                  name="value"
                  defaultValue={typeof myResponse?.value === "string" ? myResponse.value : ""}
                  className={INPUT}
                />
              )}
              {question.responseType === "single_choice" && (
                <div className="flex flex-col gap-1">
                  {question.options.map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-[13px] text-[var(--text)]">
                      <input type="radio" name="value" value={o} defaultChecked={myResponse?.value === o} /> {o}
                    </label>
                  ))}
                </div>
              )}
              {question.responseType === "multi_choice" && (
                <div className="flex flex-col gap-1">
                  {question.options.map((o) => (
                    <label key={o} className="flex items-center gap-1.5 text-[13px] text-[var(--text)]">
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
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                {myResponse ? "Update answer" : "Answer"}
              </button>
            </form>
          </div>
        ))}
      </div>
    </main>
  );
}

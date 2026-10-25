import type { profileQuestion as profileQuestionTable } from "@/db/schema";
import { KITCHEN_SIGNALS, type KitchenSignal } from "@/db/schema";
import { kitchenSignalBlocker } from "@/lib/profile-questions/questions";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY, LABEL, SELECT, Tag } from "@/components/ui/kit";
import { SettingsPanel } from "./ui";
import { addKitchenStarterQuestionAction, setKitchenSignalAction } from "./actions";

type Question = typeof profileQuestionTable.$inferSelect;

// What each signal means to a cook, in the words the Kitchen will use. The
// three are asked separately because the kitchen does something different
// with each, and this is the one place an Admin decides which question is
// which — see docs/plans/archive/kitchen-redesign-plan.md D2/D3.
const COPY: Record<KitchenSignal, { title: string; what: string }> = {
  allergy: {
    title: "Allergies",
    what: "What a cook has to keep safe. Shown in red and by name, and checked against each dish's allergen flags.",
  },
  intolerance: {
    title: "Intolerances",
    what: "Makes someone unwell but isn't dangerous. Shown in amber and by name, and checked where a dish can declare it (lactose, gluten).",
  },
  dislike: {
    title: "Dislikes",
    what: "Foods people would rather avoid. Counted, never named — menu input, not a safety check.",
  },
};

/** How many of the three kitchen signals have no live question wired to
 *  them. Shared with the Modules tab, which prompts when this is non-zero. */
export function unwiredKitchenSignals(questions: Question[]): KitchenSignal[] {
  return KITCHEN_SIGNALS.filter((s) => !questions.some((q) => q.kitchenSignal === s && !q.archivedAt));
}

/**
 * The Kitchen's three dietary questions, one row each: which question is
 * wired, or a one-click add of the starter question, or pick one you
 * already have.
 *
 * Shown only while the Kitchen module is on. Wiring grants no access and
 * widens nobody's audience — it names which answers the kitchen interprets,
 * and the kitchen still reads them only through the question's own audience
 * and each member's consent — so there is no consent step here.
 */
export default function KitchenQuestionsPanel({ questions }: { questions: Question[] }) {
  const live = questions.filter((q) => !q.archivedAt);
  const unwired = unwiredKitchenSignals(questions);

  return (
    <div id="kitchen-questions" className="scroll-mt-6">
      <SettingsPanel
        title="Kitchen questions"
        description={
          unwired.length === 0
            ? "All three are set up. The kitchen reads these answers only through each question's own audience and each member's consent."
            : `${unwired.length} of 3 aren't set up yet. Until they are, the kitchen's dietary view has nothing to show.`
        }
      >
        {KITCHEN_SIGNALS.map((signal) => {
          const wired = live.find((q) => q.kitchenSignal === signal) ?? null;
          // Anything that could carry this signal and isn't already carrying
          // another one. The rules are the library's, so this list can't
          // offer a question the action would then refuse.
          const eligible = live.filter(
            (q) => q.id !== wired?.id && !q.kitchenSignal && kitchenSignalBlocker(signal, q) === null,
          );
          return (
            <div
              key={signal}
              className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                  {COPY[signal].title}
                </span>
                {wired ? <Tag tone="success">set up</Tag> : <Tag tone="warning">not set up</Tag>}
              </div>
              <p className="max-w-[640px] text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
                {COPY[signal].what}
              </p>

              {wired ? (
                <>
                  <p className="text-[length:var(--text-body)] text-[var(--text)]">
                    Answers to <strong>{wired.label}</strong>{" "}
                    <span className="text-[var(--text-muted)]">
                      ({wired.sensitive ? "restricted" : "public"},{" "}
                      {wired.responseType === "multi_choice" ? "pick any" : "written answer"})
                    </span>
                  </p>
                  {wired.responseType === "text" && signal !== "dislike" && (
                    <p className="text-[length:var(--text-meta)] leading-relaxed text-[var(--text-muted)]">
                      This is a written answer. The kitchen will show it as written but can&rsquo;t check it against
                      a menu. Add the starter question for ticks the kitchen can check, then move this over to it
                      below.
                    </p>
                  )}
                </>
              ) : null}

              <div className="flex flex-wrap items-end gap-2">
                {!wired && (
                  <form action={addKitchenStarterQuestionAction}>
                    <input type="hidden" name="signal" value={signal} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Add the starter question
                    </button>
                  </form>
                )}
                {(eligible.length > 0 || wired) && (
                  <details className="text-[length:var(--text-meta)]">
                    <summary className="cursor-pointer text-[var(--accent-1)]">
                      {wired ? "Use a different question" : "or use one you already have"}
                    </summary>
                    <form
                      action={setKitchenSignalAction}
                      className="mt-2 flex flex-wrap items-end gap-2 rounded-[var(--radius-md)] border border-[var(--border)] p-2"
                    >
                      <input type="hidden" name="signal" value={signal} />
                      <label className="flex flex-col gap-1">
                        <span className={LABEL}>Question</span>
                        <select name="questionId" className={SELECT} defaultValue="" required>
                          <option value="" disabled>
                            Choose…
                          </option>
                          {eligible.map((q) => (
                            <option key={q.id} value={q.id}>
                              {q.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="submit" className={BUTTON_SECONDARY}>
                        Use this one
                      </button>
                      {eligible.length === 0 && (
                        <span className="text-[var(--text-muted)]">
                          Nothing else here can carry it — a{" "}
                          {signal === "dislike" ? "pick-any list" : "restricted pick-any list or written answer"},
                          asked once.
                        </span>
                      )}
                    </form>
                  </details>
                )}
                {wired && (
                  <form action={setKitchenSignalAction}>
                    <input type="hidden" name="signal" value={signal} />
                    <input type="hidden" name="clear" value="1" />
                    <button type="submit" className={BUTTON_GHOST}>
                      Stop using it
                    </button>
                  </form>
                )}
              </div>
            </div>
          );
        })}
      </SettingsPanel>
    </div>
  );
}

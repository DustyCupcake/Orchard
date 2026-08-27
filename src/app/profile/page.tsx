import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { listOnceEverAnswers, listOutstandingQuestions } from "@/lib/profile-questions";
import Nav from "@/components/Nav";
import { submitProfileAnswerAction, updateProfile } from "./actions";

export const dynamic = "force-dynamic";

function QuestionForm({
  questionId,
  responseType,
  options,
  feedsCapacitySignal,
  defaultValue,
  defaultCapacityVisibility,
}: {
  questionId: string;
  responseType: "free_text" | "single_choice" | "multi_choice";
  options: string[];
  feedsCapacitySignal: boolean;
  defaultValue?: unknown;
  defaultCapacityVisibility?: "flag_only" | "open";
}) {
  return (
    <form
      action={submitProfileAnswerAction}
      style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}
    >
      <input type="hidden" name="questionId" value={questionId} />
      {responseType === "free_text" && (
        <input
          type="text"
          name="value"
          defaultValue={typeof defaultValue === "string" ? defaultValue : ""}
          style={{ padding: "0.4rem" }}
        />
      )}
      {responseType === "single_choice" && (
        <div>
          {options.map((o) => (
            <label key={o} style={{ display: "block" }}>
              <input type="radio" name="value" value={o} defaultChecked={defaultValue === o} /> {o}
            </label>
          ))}
        </div>
      )}
      {responseType === "multi_choice" && (
        <div>
          {options.map((o) => (
            <label key={o} style={{ display: "block" }}>
              <input
                type="checkbox"
                name="value_multi"
                value={o}
                defaultChecked={Array.isArray(defaultValue) && defaultValue.includes(o)}
              />{" "}
              {o}
            </label>
          ))}
        </div>
      )}
      {feedsCapacitySignal && (
        <label style={{ fontSize: "0.8rem" }}>
          Visible to coordinators as
          <select
            name="capacityVisibility"
            defaultValue={defaultCapacityVisibility ?? "flag_only"}
            style={{ marginLeft: "0.4rem", padding: "0.2rem" }}
          >
            <option value="flag_only">a coarse flag only</option>
            <option value="open">the exact number</option>
          </select>
        </label>
      )}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <button type="submit" name="status" value="answered" style={{ padding: "0.3rem 0.8rem" }}>
          Save
        </button>
        <button type="submit" name="status" value="deferred" style={{ padding: "0.3rem 0.8rem" }}>
          I don&rsquo;t know yet
        </button>
      </div>
    </form>
  );
}

export default async function ProfilePage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const [communityTiers, outstanding, onceEverAnswers] = await Promise.all([
    db.select().from(tier).where(eq(tier.communityId, currentMember.communityId)),
    listOutstandingQuestions(currentMember),
    listOnceEverAnswers(currentMember),
  ]);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <Nav memberName={currentMember.name} />
      <h1>Your profile</h1>
      <form action={updateProfile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Name
          <br />
          <input
            type="text"
            name="name"
            defaultValue={currentMember.name}
            required
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <label>
          Tags (comma-separated)
          <br />
          <input
            type="text"
            name="tags"
            defaultValue={currentMember.tags.join(", ")}
            placeholder="carpentry, spanish, night-owl"
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        {communityTiers.length > 0 && (
          <fieldset>
            <legend>Tiers (manual assignment for now)</legend>
            {communityTiers.map((t) => (
              <label key={t.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  name="tierIds"
                  value={t.id}
                  defaultChecked={currentMember.tierIds.includes(t.id)}
                />{" "}
                {t.name}
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Save
        </button>
      </form>

      {outstanding.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Questions for you</h2>
          {outstanding.map(({ question, existingAnswer }) => (
            <div
              key={question.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>
                {question.label}
                {question.required ? " *" : ""}
              </strong>
              {existingAnswer?.status === "deferred" && (
                <p style={{ color: "#666", fontSize: "0.8rem", margin: "0.2rem 0" }}>
                  You said you didn&rsquo;t know yet.
                </p>
              )}
              <QuestionForm
                questionId={question.id}
                responseType={question.responseType}
                options={question.options}
                feedsCapacitySignal={question.feedsCapacitySignal}
              />
            </div>
          ))}
        </section>
      )}

      {onceEverAnswers.length > 0 && (
        <section style={{ marginTop: "2rem" }}>
          <h2>Your answers</h2>
          {onceEverAnswers.map(({ question, answer }) => (
            <div
              key={question.id}
              style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
            >
              <strong>{question.label}</strong>
              <QuestionForm
                questionId={question.id}
                responseType={question.responseType}
                options={question.options}
                feedsCapacitySignal={question.feedsCapacitySignal}
                defaultValue={answer.value}
                defaultCapacityVisibility={answer.capacityVisibility}
              />
            </div>
          ))}
        </section>
      )}
    </main>
  );
}

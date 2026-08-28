import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { getPostCycleFeedbackForm, listPostCycleFeedbackResponses } from "@/lib/forms";
import type { FormField } from "@/lib/forms";
import { ForbiddenError } from "@/lib/errors";
import Nav from "@/components/Nav";
import { submitFeedbackAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function FeedbackPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; submitted?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, submitted } = await searchParams;

  const form = await getPostCycleFeedbackForm(currentMember);

  let responses: Awaited<ReturnType<typeof listPostCycleFeedbackResponses>> = [];
  let canReview = false;
  try {
    responses = await listPostCycleFeedbackResponses(currentMember);
    canReview = true;
  } catch (err) {
    if (!(err instanceof ForbiddenError)) throw err;
  }

  const memberNameById = canReview
    ? new Map(
        (await db.select().from(member).where(eq(member.communityId, currentMember.communityId))).map(
          (m) => [m.id, m.name] as const,
        ),
      )
    : new Map<string, string>();

  const fields = (form?.fields as FormField[] | undefined) ?? [];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 640 }}>
      <Nav memberName={currentMember.name} />
      <h1>Feedback</h1>

      {!form && (
        <p style={{ color: "#666" }}>
          Not set up for this Community yet — a current Admins holder can define a form and pick
          it as the post-cycle feedback survey on the Settings screen.
        </p>
      )}

      {form && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {submitted && <p style={{ color: "#2a7a2a" }}>Thanks — your response was recorded.</p>}

          <section style={{ marginTop: "1rem" }}>
            <h2>{form.title}</h2>
            {form.description && <p style={{ color: "#666" }}>{form.description}</p>}

            <form
              action={submitFeedbackAction}
              style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
            >
              {fields.map((f) => (
                <label key={f.key}>
                  {f.label}
                  {f.required ? " *" : ""}
                  <br />
                  {f.responseType === "free_text" && (
                    <textarea
                      name={`field_${f.key}`}
                      required={f.required}
                      rows={3}
                      style={{ padding: "0.5rem", width: "100%" }}
                    />
                  )}
                  {f.responseType === "single_choice" && (
                    <div>
                      {(f.options ?? []).map((o) => (
                        <label key={o} style={{ display: "block", fontWeight: 400 }}>
                          <input type="radio" name={`field_${f.key}`} value={o} required={f.required} /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                  {f.responseType === "multi_choice" && (
                    <div>
                      {(f.options ?? []).map((o) => (
                        <label key={o} style={{ display: "block", fontWeight: 400 }}>
                          <input type="checkbox" name={`field_${f.key}`} value={o} /> {o}
                        </label>
                      ))}
                    </div>
                  )}
                </label>
              ))}

              {form.allowAnonymous && (
                <label>
                  <input type="checkbox" name="anonymous" /> submit anonymously
                </label>
              )}

              <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
                Submit
              </button>
            </form>
          </section>

          {canReview && (
            <section style={{ marginTop: "2rem" }}>
              <h2>Responses ({responses.length})</h2>
              {responses.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
              {responses.map((r) => (
                <div
                  key={r.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <p style={{ margin: 0, fontSize: "0.8rem", color: "#666" }}>
                    {r.submittedBy ? memberNameById.get(r.submittedBy) ?? "—" : "Anonymous"} —{" "}
                    {new Date(r.submittedAt).toLocaleString()}
                  </p>
                  <ul style={{ margin: "0.3rem 0 0" }}>
                    {fields.map((f) => {
                      const v = (r.values as Record<string, unknown>)[f.key];
                      const display = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                      return (
                        <li key={f.key}>
                          <strong>{f.label}:</strong> {display || "—"}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

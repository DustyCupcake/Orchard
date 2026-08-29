import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  getMyRecruitmentSubscription,
  getRecruitmentApplicationForm,
  isRecruitmentTaskHolder,
  listApplicationAlerts,
  listApplicationsForEvaluation,
} from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import { ForbiddenError } from "@/lib/errors";
import Nav from "@/components/Nav";
import { setRecruitmentSubscriptionAction, submitEvaluationAction } from "./actions";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  proceed: "Proceed",
  wider_discussion: "Wider discussion",
  decline: "Decline",
};

// See docs/spec.md's Recruitment ("Evaluation + decision logic",
// "Recruitment-mode subscription") and docs/development-plan.md's
// Phase 33.
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; subscribed?: string; unsubscribed?: string; evaluated?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, subscribed, unsubscribed, evaluated } = await searchParams;

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");

  const [subscription, isHolder, form] = await Promise.all([
    moduleOn ? getMyRecruitmentSubscription(currentMember) : Promise.resolve(null),
    moduleOn ? isRecruitmentTaskHolder(currentMember) : Promise.resolve(false),
    moduleOn ? getRecruitmentApplicationForm(currentMember) : Promise.resolve(null),
  ]);
  const fields = (form?.fields as FormField[] | undefined) ?? [];

  let alerts: Awaited<ReturnType<typeof listApplicationAlerts>> = [];
  let full: Awaited<ReturnType<typeof listApplicationsForEvaluation>> = [];
  if (moduleOn && isHolder) {
    full = await listApplicationsForEvaluation(currentMember);
  } else if (moduleOn) {
    try {
      alerts = await listApplicationAlerts(currentMember);
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
    }
  }

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 760 }}>
      <Nav memberName={currentMember.name} />
      <h1>Applications</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {subscribed && <p style={{ color: "#2a7a2a" }}>You&rsquo;re subscribed to application alerts.</p>}
          {unsubscribed && <p style={{ color: "#2a7a2a" }}>Unsubscribed.</p>}
          {evaluated && <p style={{ color: "#2a7a2a" }}>Your recommendation was saved.</p>}

          <section style={{ marginTop: "1rem" }}>
            <form action={setRecruitmentSubscriptionAction}>
              <input type="hidden" name="active" value={(!subscription?.active).toString()} />
              <button type="submit" style={{ padding: "0.4rem 1rem" }}>
                {subscription?.active ? "Unsubscribe from alerts" : "Subscribe to application alerts"}
              </button>
              {subscription?.active && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
                  You&rsquo;ll see new applications below.
                </span>
              )}
            </form>
          </section>

          {!form && (
            <p style={{ color: "#666", marginTop: "1rem" }}>
              No application form configured yet — a current Admins holder can pick one under
              Recruitment on the Settings screen.
            </p>
          )}

          {form && !isHolder && (
            <section style={{ marginTop: "1.5rem" }}>
              <h2>Pending applications</h2>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                You&rsquo;re not a current recruitment-task holder, so you see that something&rsquo;s
                pending, not the applicant&rsquo;s own answers.
              </p>
              {!subscription?.active && alerts.length === 0 && (
                <p style={{ color: "#666" }}>Subscribe above to see this list.</p>
              )}
              {subscription?.active && alerts.length === 0 && <p style={{ color: "#666" }}>Nothing pending.</p>}
              {alerts.map((a) => (
                <div
                  key={a.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <p style={{ margin: 0, fontSize: "0.85rem" }}>
                    Submitted {new Date(a.submittedAt).toLocaleString()} — {a.evaluationsFiled}/
                    {a.evaluatorsNeeded} evaluations filed
                    {a.outcome && (
                      <>
                        {" "}
                        · <strong>{OUTCOME_LABEL[a.outcome] ?? a.outcome}</strong>
                      </>
                    )}
                  </p>
                </div>
              ))}
            </section>
          )}

          {form && isHolder && (
            <section style={{ marginTop: "1.5rem" }}>
              <h2>Applications ({full.length})</h2>
              {full.length === 0 && <p style={{ color: "#666" }}>Nothing pending.</p>}
              {full.map(({ response, evaluations, outcome, evaluationsFiled, evaluatorsNeeded }) => {
                const myEvaluation = evaluations.find((e) => e.evaluatorId === currentMember.id);
                return (
                  <div
                    key={response.id}
                    style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}
                  >
                    <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "#666" }}>
                      Submitted {new Date(response.submittedAt).toLocaleString()}
                    </p>
                    <ul style={{ margin: "0 0 0.5rem" }}>
                      {fields.map((f) => {
                        const v = (response.values as Record<string, unknown>)[f.key];
                        const display = Array.isArray(v) ? v.join(", ") : String(v ?? "");
                        return (
                          <li key={f.key}>
                            <strong>{f.label}:</strong> {display || "—"}
                          </li>
                        );
                      })}
                    </ul>

                    <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
                      {evaluationsFiled}/{evaluatorsNeeded} evaluations filed
                      {outcome && (
                        <>
                          {" "}
                          · outcome: <strong>{OUTCOME_LABEL[outcome] ?? outcome}</strong>
                        </>
                      )}
                    </p>
                    {evaluations.length > 0 && (
                      <ul style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
                        {evaluations.map((e) => (
                          <li key={e.id}>
                            {e.evaluatorId === currentMember.id ? "You" : "Another evaluator"}:{" "}
                            {e.recommendation}
                            {e.notes ? ` — ${e.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}

                    <form
                      action={submitEvaluationAction}
                      style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}
                    >
                      <input type="hidden" name="formResponseId" value={response.id} />
                      <label style={{ fontSize: "0.85rem" }}>
                        Your recommendation
                        <br />
                        <select
                          name="recommendation"
                          defaultValue={myEvaluation?.recommendation ?? "unsure"}
                          style={{ padding: "0.3rem" }}
                        >
                          <option value="proceed">Proceed</option>
                          <option value="unsure">Unsure</option>
                          <option value="decline">Decline</option>
                        </select>
                      </label>
                      <label style={{ fontSize: "0.85rem" }}>
                        Notes (optional)
                        <br />
                        <textarea
                          name="notes"
                          rows={2}
                          defaultValue={myEvaluation?.notes ?? ""}
                          style={{ padding: "0.3rem", width: "100%" }}
                        />
                      </label>
                      <button type="submit" style={{ padding: "0.3rem 0.6rem", width: "fit-content" }}>
                        {myEvaluation ? "Update recommendation" : "File recommendation"}
                      </button>
                    </form>
                  </div>
                );
              })}
            </section>
          )}
        </>
      )}
    </main>
  );
}

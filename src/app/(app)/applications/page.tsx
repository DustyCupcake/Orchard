import Link from "next/link";
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
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import {
  raiseObjectionAction,
  resolveWiderDiscussionAction,
  setRecruitmentSubscriptionAction,
  submitEvaluationAction,
} from "./actions";

export const dynamic = "force-dynamic";

const OUTCOME_LABEL: Record<string, string> = {
  proceed: "Proceed",
  wider_discussion: "Wider discussion",
  decline: "Decline",
};

const RESOLUTION_LABEL: Record<string, string> = {
  accepted: "Accepted",
  declined: "Declined",
};

// See docs/spec.md's Recruitment ("Evaluation + decision logic",
// "Recruitment-mode subscription", "Wider discussion window",
// "Accompaniment", "Rejection templates") and docs/development-plan.md's
// Phases 33-34.
export default async function ApplicationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    subscribed?: string;
    unsubscribed?: string;
    evaluated?: string;
    objectionRaised?: string;
    decisionResolved?: string;
  }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error, subscribed, unsubscribed, evaluated, objectionRaised, decisionResolved } = await searchParams;

  const communityRow = await getCommunity(currentMember);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");

  const [subscription, isHolder, form, appUrl] = await Promise.all([
    moduleOn ? getMyRecruitmentSubscription(currentMember) : Promise.resolve(null),
    moduleOn ? isRecruitmentTaskHolder(currentMember) : Promise.resolve(false),
    moduleOn ? getRecruitmentApplicationForm(currentMember) : Promise.resolve(null),
    resolveAppUrlFromHeaders(),
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
          {objectionRaised && <p style={{ color: "#2a7a2a" }}>Your objection was recorded.</p>}
          {decisionResolved && <p style={{ color: "#2a7a2a" }}>Decision resolved.</p>}

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
                    {a.resolution && (
                      <>
                        {" "}
                        · <strong>{RESOLUTION_LABEL[a.resolution] ?? a.resolution}</strong>
                      </>
                    )}
                    {a.widerDiscussionStatus && <> · window {a.widerDiscussionStatus}</>}
                  </p>
                  {a.widerDiscussionStatus === "open" && subscription?.active && (
                    <form action={raiseObjectionAction} style={{ marginTop: "0.4rem", display: "flex", gap: "0.4rem" }}>
                      <input type="hidden" name="formResponseId" value={a.id} />
                      <input
                        type="text"
                        name="note"
                        required
                        placeholder="Raise an objection…"
                        style={{ padding: "0.3rem", flex: 1 }}
                      />
                      <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                        Raise objection
                      </button>
                    </form>
                  )}
                </div>
              ))}
            </section>
          )}

          {form && isHolder && (
            <section style={{ marginTop: "1.5rem" }}>
              <h2>Applications ({full.length})</h2>
              {full.length === 0 && <p style={{ color: "#666" }}>Nothing pending.</p>}
              {full.map(({ response, evaluations, outcome, evaluationsFiled, evaluatorsNeeded, decision, widerDiscussionStatus, objections }) => {
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

                    {decision && (
                      <div style={{ marginTop: "0.6rem", paddingTop: "0.6rem", borderTop: "1px solid #eee" }}>
                        <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                          Decision: <strong>{OUTCOME_LABEL[decision.ruleOutcome] ?? decision.ruleOutcome}</strong>
                          {decision.resolution && (
                            <>
                              {" "}
                              → <strong>{RESOLUTION_LABEL[decision.resolution] ?? decision.resolution}</strong>
                            </>
                          )}
                        </p>

                        {decision.introCallPollId && (
                          <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                            Intro call scheduled —{" "}
                            <Link href={`/scheduling-polls/${decision.introCallPollId}`}>manage as a member</Link>.
                            {decision.introCallToken && (
                              <>
                                {" "}
                                Send the applicant this link to submit their own availability:{" "}
                                <span style={{ wordBreak: "break-all" }}>
                                  {appUrl}/intro-call/{decision.introCallToken}
                                </span>
                              </>
                            )}
                          </p>
                        )}

                        {widerDiscussionStatus && (
                          <>
                            <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                              Wider-discussion window: <strong>{widerDiscussionStatus}</strong>
                              {decision.widerDiscussionDeadline &&
                                ` (closes ${new Date(decision.widerDiscussionDeadline).toLocaleString()})`}
                            </p>
                            {objections.length > 0 && (
                              <ul style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                                {objections.map((o) => (
                                  <li key={o.id}>
                                    {o.note} <span style={{ color: "#666" }}>({new Date(o.raisedAt).toLocaleDateString()})</span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {!decision.resolution && (
                              <form action={resolveWiderDiscussionAction} style={{ display: "flex", gap: "0.4rem" }}>
                                <input type="hidden" name="formResponseId" value={response.id} />
                                <button type="submit" name="resolution" value="accepted" style={{ padding: "0.3rem 0.6rem" }}>
                                  Resolve: accepted
                                </button>
                                <button type="submit" name="resolution" value="declined" style={{ padding: "0.3rem 0.6rem" }}>
                                  Resolve: declined
                                </button>
                              </form>
                            )}
                          </>
                        )}

                        {decision.resolution === "declined" && communityRow.recruitmentRejectionTemplate && (
                          <details style={{ marginTop: "0.3rem" }}>
                            <summary style={{ cursor: "pointer", fontSize: "0.8rem" }}>Rejection template</summary>
                            <p style={{ fontSize: "0.85rem", whiteSpace: "pre-wrap" }}>
                              {communityRow.recruitmentRejectionTemplate}
                            </p>
                          </details>
                        )}

                        {decision.accompanimentTaskId && (
                          <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
                            <Link href={`/tasks/${decision.accompanimentTaskId}`}>Accompaniment task</Link> created.
                          </p>
                        )}
                      </div>
                    )}
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

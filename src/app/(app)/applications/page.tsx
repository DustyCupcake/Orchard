import Link from "next/link";
import { redirect } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db";
import { cycle, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  getMyRecruitmentSubscription,
  getRecruitmentApplicationForm,
  isRecruitmentTaskHolder,
  listApplicationAlerts,
  listApplicationsForEvaluation,
  listConversationsForEvaluation,
  listHeldRecruitmentScopes,
  listOpenIntroCallsForSubscriber,
  listOutstandingReferralInvites,
} from "@/lib/recruitment";
import type { FormField } from "@/lib/forms";
import { ForbiddenError } from "@/lib/errors";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import {
  askMembersToSupportAction,
  confirmInterviewAction,
  markInterviewHeldAction,
  setRecruitmentSubscriptionAction,
  submitArrivalEvaluationAction,
  submitEvaluationAction,
  supportApplicationAction,
} from "./actions";
import SelectField from "@/components/ui/SelectField";

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

// §4.3's objection lifecycle, as the evaluators see it. They get the
// note and the state and never the name — the identity is shielded to the
// mediation body (J7), and this list is deliberately the same shape it
// was before the redesign so that the *only* thing that changed for the
// evaluators is that they can no longer wave a standing concern through.
const OBJECTION_STATE_LABEL: Record<string, string> = {
  standing: "standing — with the mediation body",
  cleared: "cleared",
  upheld: "the concern stood, and they didn't join",
  overruled: "overruled by the mediation body",
  withdrawn: "withdrawn by whoever raised it",
  asked_for_more: "the person was asked for more",
  moot: "answered by how the arrival was decided",
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
    supported?: string;
    asked?: string;
    interviewConfirmed?: string;
    interviewHeld?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, subscribed, unsubscribed, evaluated, supported, asked, interviewConfirmed, interviewHeld } = await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");

  const [subscription, isHolder, form, appUrl, openIntroCalls, heldScopes, cycles] = await Promise.all([
    moduleOn ? getMyRecruitmentSubscription(viewing) : Promise.resolve(null),
    moduleOn ? isRecruitmentTaskHolder(viewing) : Promise.resolve(false),
    moduleOn ? getRecruitmentApplicationForm(viewing) : Promise.resolve(null),
    resolveAppUrlFromHeaders(),
    moduleOn ? listOpenIntroCallsForSubscriber(viewing) : Promise.resolve([]),
    moduleOn ? listHeldRecruitmentScopes(viewing) : Promise.resolve(new Set<string | null>()),
    moduleOn
      ? db.select({ id: cycle.id, name: cycle.name }).from(cycle).where(eq(cycle.communityId, viewing.communityId))
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const fields = (form?.fields as FormField[] | undefined) ?? [];
  // Where this holder's recruitment authority reaches (docs/cycle-
  // scope-remediation-plan.md §4.3) — the scope line and per-
  // application cycle tag below both render it.
  const cycleNameById = new Map(cycles.map((c) => [c.id, c.name] as const));
  const heldScopeCycles = cycles.filter((c) => heldScopes.has(c.id));
  const coverageLine = heldScopes.has(null)
    ? "You cover the community-wide scope — every application, event-tagged or not."
    : `You cover only: ${heldScopeCycles.map((c) => c.name).join(", ")}.`;
  const lapsed =
    Boolean(subscription?.id) &&
    !subscription?.active &&
    (subscription?.consecutiveNoAvailabilityCount ?? 0) >= communityRow.recruitmentSubscriptionLapseThreshold;

  let alerts: Awaited<ReturnType<typeof listApplicationAlerts>> = [];
  let full: Awaited<ReturnType<typeof listApplicationsForEvaluation>> = [];
  let conversations: Awaited<ReturnType<typeof listConversationsForEvaluation>> = [];
  let referralInvites: Awaited<ReturnType<typeof listOutstandingReferralInvites>> = [];
  if (moduleOn && isHolder) {
    full = await listApplicationsForEvaluation(viewing);
    conversations = await listConversationsForEvaluation(viewing);
    referralInvites = await listOutstandingReferralInvites(viewing);
  } else if (moduleOn) {
    try {
      alerts = await listApplicationAlerts(viewing);
    } catch (err) {
      if (!(err instanceof ForbiddenError)) throw err;
    }
  }

  // Everybody who could be asked to vouch — loaded only when there is an
  // application to ask about, because it is the whole member list.
  const askable =
    full.length > 0
      ? await db
          .select({ id: member.id, name: member.name })
          .from(member)
          .where(and(eq(member.communityId, viewing.communityId), ne(member.id, viewing.id)))
          .orderBy(member.name)
      : [];

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
          {supported && <p style={{ color: "#2a7a2a" }}>Thank you — your word is recorded.</p>}
          {asked && <p style={{ color: "#2a7a2a" }}>Asked. Each person you named got their own email with the link.</p>}
          {interviewConfirmed && <p style={{ color: "#2a7a2a" }}>Booked. The person has been told the time.</p>}
          {interviewHeld && <p style={{ color: "#2a7a2a" }}>Noted that the interview happened — reports can be filed now.</p>}
          {unsubscribed && <p style={{ color: "#2a7a2a" }}>Unsubscribed.</p>}
          {evaluated && <p style={{ color: "#2a7a2a" }}>Your recommendation was saved.</p>}

          <section style={{ marginTop: "1rem" }}>
            {lapsed && (
              <p style={{ color: "#b45309", fontSize: "0.85rem", marginBottom: "0.4rem" }}>
                You were automatically unsubscribed after {subscription?.consecutiveNoAvailabilityCount}{" "}
                intro calls in a row with no availability from you — no penalty, just a pause. Resubscribe
                any time below.
              </p>
            )}
            <form action={setRecruitmentSubscriptionAction}>
              <input type="hidden" name="active" value={(!subscription?.active).toString()} />
              <button type="submit" style={{ padding: "0.4rem 1rem" }}>
                {subscription?.active ? "Unsubscribe from alerts" : lapsed ? "Resubscribe" : "Subscribe to application alerts"}
              </button>
              {subscription?.active && (
                <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem", color: "#666" }}>
                  You&rsquo;ll see new applications below.
                </span>
              )}
            </form>

            {subscription?.active && openIntroCalls.length > 0 && (
              <div style={{ marginTop: "0.6rem" }}>
                <p style={{ fontSize: "0.85rem", margin: "0 0 0.3rem" }}>
                  Intro call{openIntroCalls.length > 1 ? "s" : ""} still gathering availability:
                </p>
                <ul style={{ margin: 0, fontSize: "0.85rem" }}>
                  {openIntroCalls.map((c) => (
                    <li key={c.pollId}>
                      <Link href={`/scheduling-polls/${c.pollId}`}>
                        {c.submittedByMe ? "Update your availability" : "Submit your availability"}
                      </Link>
                      {c.submittedByMe && <span style={{ color: "#2a7a2a" }}> — submitted</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                  {a.widerDiscussionStatus === "open" && (
                    <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
                      Anyone can raise a concern while the window is open —{" "}
                      <Link href="/community-check" style={{ color: "var(--accent-1)" }}>
                        see who&rsquo;s waiting on the community
                      </Link>
                      .
                    </p>
                  )}
                </div>
              ))}
            </section>
          )}

          {form && isHolder && (
            <section style={{ marginTop: "1.5rem" }}>
              {referralInvites.length > 0 && (
                <div style={{ marginBottom: "1.25rem" }}>
                  <h2>Outstanding referral invites ({referralInvites.length})</h2>
                  <p style={{ color: "#666", fontSize: "0.85rem" }}>
                    Event invites in referral mode route through the evaluated application here — they hold
                    no capacity slot, but their applicants may be on their way in (§4.3/8d).
                  </p>
                  {referralInvites.map((r) => (
                    <div
                      key={`${r.cycleId}:${r.createdAt.toISOString()}`}
                      style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                    >
                      <p style={{ margin: 0, fontSize: "0.85rem" }}>
                        <strong>{r.label || "(unlabeled)"}</strong> — for {r.cycleName}, created{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
              <h2>Applications ({full.length})</h2>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>{coverageLine}</p>
              {full.length === 0 && <p style={{ color: "#666" }}>Nothing pending.</p>}
              {full.map(({ response, evaluations, outcome, evaluationsFiled, evaluatorsNeeded, decision, widerDiscussionStatus, widerDiscussionDeadline, objections, convertedMember, arrival, supports, interview, interviewerIds }) => {
                const myEvaluation = evaluations.find((e) => e.evaluatorId === viewing.id);
                return (
                  <div
                    key={response.id}
                    style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}
                  >
                    <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "#666" }}>
                      Submitted {new Date(response.submittedAt).toLocaleString()}
                      {response.cycleId
                        ? ` — for ${cycleNameById.get(response.cycleId) ?? "that event"}`
                        : " — not tied to an event"}
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

              {conversations.length > 0 && (
                <>
                  <h2>Conversations without an application ({conversations.length})</h2>
                  <p style={{ color: "#666", fontSize: "0.85rem" }}>
                    People whose lane asks only for a conversation. There is nothing to read: you meet them, and the people who took part
                    report.
                  </p>
                  {conversations.map((item) => (
                    <ConversationCard
                      key={item.arrival.id}
                      item={item}
                      viewingId={viewing.id}
                      cycleName={item.arrival.cycleId ? (cycleNameById.get(item.arrival.cycleId) ?? "that event") : null}
                    />
                  ))}
                </>
              )}
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
                            {e.evaluatorId === viewing.id ? "You" : "Another evaluator"}:{" "}
                            {e.recommendation}
                            {e.notes ? ` — ${e.notes}` : ""}
                          </li>
                        ))}
                      </ul>
                    )}

                    {arrival && (
                      <div style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
                        <p style={{ margin: "0 0 0.3rem" }}>
                          <strong>Vouched for by</strong>{" "}
                          {supports.length === 0
                            ? "nobody yet"
                            : supports.map((sp) => `${sp.name} (${sp.knowsPersonally ? "knows them" : "thinks they'd fit"}${sp.knowsPersonally && sp.thinksGoodFit ? ", and thinks they'd fit" : ""})`).join("; ")}
                          {arrival.supportShortcutCount
                            ? ` — ${supports.length} of the ${arrival.supportShortcutCount} that would admit them without the rest`
                            : ""}
                        </p>
                        {!supports.some((sp) => sp.memberId === viewing.id) && (
                          <form action={supportApplicationAction} style={{ display: "flex", gap: "0.8rem", alignItems: "center", flexWrap: "wrap" }}>
                            <input type="hidden" name="arrivalId" value={arrival.id} />
                            <span>I support them:</span>
                            <label><input type="checkbox" name="knowsPersonally" /> I know them</label>
                            <label><input type="checkbox" name="thinksGoodFit" /> I think they&rsquo;d fit</label>
                            <button type="submit" style={{ padding: "0.2rem 0.6rem" }}>Add my word</button>
                          </form>
                        )}
                        <details style={{ marginTop: "0.4rem" }}>
                          <summary style={{ cursor: "pointer" }}>Ask members who might know them</summary>
                          <p style={{ margin: "0.3rem 0", color: "#666" }}>
                            Their link to hand over by hand: <span style={{ wordBreak: "break-all" }}>{appUrl}/support/{arrival.supportToken}</span>
                          </p>
                          <form action={askMembersToSupportAction} style={{ display: "flex", flexDirection: "column", gap: "0.3rem", maxWidth: 360 }}>
                            <input type="hidden" name="arrivalId" value={arrival.id} />
                            <select name="memberId" multiple size={5} style={{ padding: "0.3rem" }}>
                              {askable.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                            <span style={{ color: "#666" }}>Each gets their own email with the link, nobody else hears anything, and if none answer nothing happens to them.</span>
                            <button type="submit" style={{ padding: "0.2rem 0.6rem", width: "fit-content" }}>Ask them</button>
                          </form>
                        </details>
                      </div>
                    )}

                    {interview && arrival && (
                      <InterviewBlock interview={interview} arrivalId={arrival.id} interviewerIds={interviewerIds} viewingId={viewing.id} />
                    )}

                    <form
                      action={submitEvaluationAction}
                      style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}
                    >
                      <input type="hidden" name="formResponseId" value={response.id} />
                      <label style={{ fontSize: "0.85rem" }}>
                        Your recommendation
                        <br />
                        <SelectField
                          name="recommendation"
                          defaultValue={myEvaluation?.recommendation ?? "unsure"}
                          style={{ padding: "0.3rem" }}
                        >
                          <option value="proceed">Proceed</option>
                          <option value="unsure">Unsure</option>
                          <option value="decline">Decline</option>
                        </SelectField>
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
                              {widerDiscussionDeadline &&
                                ` (${widerDiscussionStatus === "open" ? "closes" : "closed"} ${new Date(widerDiscussionDeadline).toLocaleString()})`}
                              . It belongs to the community, not to the holders: it ends when nobody has raised a
                              concern by its deadline, or when the mediation body has settled the ones that were.
                            </p>
                            {objections.length > 0 && (
                              <ul style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                                {objections.map((o) => (
                                  <li key={o.id}>
                                    {o.note}{" "}
                                    <span style={{ color: "#666" }}>
                                      ({new Date(o.raisedAt).toLocaleDateString()} ·{" "}
                                      {OBJECTION_STATE_LABEL[o.resolution] ?? o.resolution}
                                      {o.resolutionNote ? ` — ${o.resolutionNote}` : ""})
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            )}
                            {/* §5/J7: while a concern is standing the arrival is the mediation body's.
                                There is no button here at all — nobody on the recruitment team can wave
                                a concern through, and a window ends by itself or by mediation. */}
                            {objections.some((o) => o.resolution === "standing") && (
                              <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem" }}>
                                Someone has raised a concern and it <strong>stands</strong> until the mediation
                                body talks it through — it is not resolved by waiting, and it isn&rsquo;t yours to
                                resolve.{" "}
                                <Link href="/recruitment/mediation" style={{ color: "var(--accent-1)" }}>
                                  Open the mediation queue
                                </Link>
                                .
                              </p>
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

                        {decision.resolution === "accepted" && (
                          <p style={{ margin: "0.3rem 0 0", fontSize: "0.85rem" }}>
                            {convertedMember ? (
                              <>New member created: <strong>{convertedMember.name}</strong>.</>
                            ) : (
                              <span style={{ color: "#b45309" }}>
                                No member was created automatically — this application&rsquo;s form
                                isn&rsquo;t tagged with a name/email field.
                              </span>
                            )}
                          </p>
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

// Where a person's interview is, read live — so a holder looking at the list can see
// whether it's waiting on the person, on holders, or ready to book — and the two things a
// holder does with it. Shared by the applications and by the arrivals that sent none.
type InterviewState = NonNullable<Awaited<ReturnType<typeof listApplicationsForEvaluation>>[number]["interview"]>;
function InterviewBlock({
  interview,
  arrivalId,
  interviewerIds,
  viewingId,
}: {
  interview: InterviewState;
  arrivalId: string;
  interviewerIds: string[];
  viewingId: string;
}) {
  return (
    <div style={{ margin: "0 0 0.6rem", fontSize: "0.85rem" }}>
        <p style={{ margin: "0 0 0.3rem" }}>
          <strong>Interview:</strong>{" "}
          {interview.confirmed
            ? `booked for ${new Date(interview.confirmed.start).toLocaleString()}${interview.held ? " — it has happened; the people who took part file the reports" : ""}`
            : !interview.poll
              ? "not made yet — conversations are closed, or no recruitment task has been created to file it under"
              : !interview.personHasOffered
                ? "waiting for them to say when they're free"
                : interview.qualifyingSlots.length === 0
                  ? "waiting for enough of you to offer a time they're free"
                  : `${interview.qualifyingSlots.length} time${interview.qualifyingSlots.length === 1 ? "" : "s"} suit them and enough of you — pick one to book`}
        </p>
        {interview.poll && !interview.confirmed && (
          <p style={{ margin: "0 0 0.3rem", color: "#666" }}>
            <Link href="/recruitment/availability" style={{ textDecoration: "underline" }}>Your standing availability</Link> counts here
            automatically, or offer times for just this one on{" "}
            <Link href={`/scheduling-polls/${interview.poll.id}`} style={{ textDecoration: "underline" }}>its poll</Link>.
          </p>
        )}
        {!interview.confirmed && interview.qualifyingSlots.length > 0 && (
          <form action={confirmInterviewAction} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="arrivalId" value={arrivalId} />
            <SelectField name="slot" defaultValue={interview.qualifyingSlots[0]} style={{ padding: "0.3rem" }}>
              {interview.qualifyingSlots.map((slot) => (
                <option key={slot} value={slot}>{new Date(slot).toLocaleString()}</option>
              ))}
            </SelectField>
            <button type="submit" style={{ padding: "0.2rem 0.6rem" }}>Book this time</button>
          </form>
        )}
        {interview.confirmed && !interview.held && interviewerIds.includes(viewingId) && (
          <form action={markInterviewHeldAction}>
            <input type="hidden" name="arrivalId" value={arrivalId} />
            <button type="submit" style={{ padding: "0.2rem 0.6rem" }}>It happened</button>
          </form>
        )}
      </div>
  );
}

// An arrival whose lane asks only for a conversation has no application to read, so what
// a holder is shown is the person, where their conversation is, and the reports on it.
type Conversation = Awaited<ReturnType<typeof listConversationsForEvaluation>>[number];
function ConversationCard({ item, viewingId, cycleName }: { item: Conversation; viewingId: string; cycleName: string | null }) {
  const { arrival, evaluations, outcome, evaluationsFiled, evaluatorsNeeded, decision, supports, interview, interviewerIds, concerns, windowDeadline } = item;
  const mine = evaluations.find((e) => e.evaluatorId === viewingId);
  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.75rem", marginBottom: "0.75rem" }}>
      <p style={{ margin: "0 0 0.4rem", fontSize: "0.8rem", color: "#666" }}>
        Arrived {new Date(arrival.createdAt).toLocaleString()}
        {cycleName ? ` — for ${cycleName}` : " — not tied to an event"} — no application: their lane asks for a conversation
      </p>
      <p style={{ margin: "0 0 0.4rem" }}>
        <strong>{arrival.name}</strong> <span style={{ color: "#666" }}>({arrival.email})</span>
      </p>
      <p style={{ margin: "0 0 0.4rem", fontSize: "0.85rem" }}>
        {evaluationsFiled}/{evaluatorsNeeded} reports filed
        {outcome && (
          <>
            {" "}
            · outcome: <strong>{OUTCOME_LABEL[outcome] ?? outcome}</strong>
          </>
        )}
        {supports.length > 0 && <> · vouched for by {supports.map((sp) => sp.name).join(", ")}</>}
      </p>
      {evaluations.length > 0 && (
        <ul style={{ margin: "0 0 0.5rem", fontSize: "0.85rem" }}>
          {evaluations.map((e) => (
            <li key={e.id}>
              {e.evaluatorId === viewingId ? "You" : "Another interviewer"}: {e.recommendation}
              {e.notes ? ` — ${e.notes}` : ""}
            </li>
          ))}
        </ul>
      )}
      {interview && <InterviewBlock interview={interview} arrivalId={arrival.id} interviewerIds={interviewerIds} viewingId={viewingId} />}
      {interview?.held && (
        <form action={submitArrivalEvaluationAction} style={{ display: "flex", flexDirection: "column", gap: "0.4rem", maxWidth: 400 }}>
          <input type="hidden" name="arrivalId" value={arrival.id} />
          <label style={{ fontSize: "0.85rem" }}>
            Your recommendation
            <br />
            <SelectField name="recommendation" defaultValue={mine?.recommendation ?? "unsure"} style={{ padding: "0.3rem" }}>
              <option value="proceed">Proceed</option>
              <option value="unsure">Unsure</option>
              <option value="decline">Decline</option>
            </SelectField>
          </label>
          <label style={{ fontSize: "0.85rem" }}>
            Notes (optional)
            <br />
            <textarea name="notes" rows={2} defaultValue={mine?.notes ?? ""} style={{ padding: "0.3rem", width: "100%" }} />
          </label>
          <button type="submit" style={{ padding: "0.3rem 0.6rem", width: "fit-content" }}>
            {mine ? "Update recommendation" : "File recommendation"}
          </button>
        </form>
      )}
      {decision && (
        <p style={{ margin: "0.6rem 0 0", fontSize: "0.85rem" }}>
          Decision: <strong>{OUTCOME_LABEL[decision.ruleOutcome] ?? decision.ruleOutcome}</strong>
          {decision.resolution && (
            <>
              {" "}
              → <strong>{RESOLUTION_LABEL[decision.resolution] ?? decision.resolution}</strong>
            </>
          )}
        </p>
      )}
      {windowDeadline && (
        <p style={{ margin: "0.4rem 0 0", fontSize: "0.85rem" }}>
          Community check open until {new Date(windowDeadline).toLocaleString()}.{" "}
          {concerns.some((c) => c.resolution === "standing") ? (
            <>
              A concern stands until the{" "}
              <Link href="/recruitment/mediation" style={{ color: "var(--accent-1)" }}>
                mediation body
              </Link>{" "}
              has talked it through; it isn&rsquo;t yours to resolve.
            </>
          ) : (
            "Anyone can raise a concern in the window."
          )}
        </p>
      )}
    </div>
  );
}

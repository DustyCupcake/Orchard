import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { isModuleEnabled } from "@/lib/modules";
import { getCommunityRow, isMediationMember } from "@/lib/recruitment";
import {
  getMediationQueue,
  listMediationMembers,
  listObjectionParties,
  type MediationItem,
  type MediationMember,
} from "@/lib/recruitment/mediation";
import PageHeader from "@/components/ui/PageHeader";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, Tag } from "@/components/ui/kit";
import {
  consentPartyToObjectionAction,
  recuseFromObjectionAction,
  resolveObjectionAction,
  withdrawConsentToObjectionAction,
  withdrawObjectionAction,
} from "./actions";

export const dynamic = "force-dynamic";

const RESOLUTION_LABEL: Record<string, string> = {
  cleared: "cleared",
  upheld: "the objection stands",
  overruled: "overruled",
  withdrawn: "withdrawn by whoever raised it",
};

const SUBJECT_LABEL: Record<string, string> = {
  application: "An application",
  invite: "An announced arrival",
};

type PartyList = { excluded: string[]; consented: string[] };

// §5.4's mediation surface, and the first page in the app whose whole
// purpose is a *duty* rather than a queue. The layout is built around the
// design goal in §2.6: a concern stands until somebody talks to the
// people involved, so outstanding ones lead, the body is named, and the
// one thing that is an exception rather than a right — the overrule — is
// stated with the threshold the community set and never presented as a
// normal option.
export default async function RecruitmentMediationPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    resolved?: string;
    recused?: string;
    consented?: string;
    consentWithdrawn?: string;
    withdrawn?: string;
  }>;
}) {
  const params = await searchParams;
  const ctx = await getViewingContext();
  if (!ctx.real || !ctx.viewing) redirect("/login");
  const actor = ctx.viewing;

  const communityRow = await getCommunityRow(actor.communityId);
  if (!isModuleEnabled(communityRow, "recruitment")) {
    return (
      <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader title="Recruitment mediation" />
        <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Recruitment is switched off for this community, so there is nothing to mediate.
        </p>
      </main>
    );
  }

  if (!(await isMediationMember(actor))) {
    return (
      <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
        <PageHeader
          title="Recruitment mediation"
          description="Concerns about who joins are handled by this community's mediation body."
        />
        <div className="mt-4 max-w-[620px]">
          <Banner tone="warning">
            You don&rsquo;t hold Recruitment mediation, so there is nothing here for you to see. That
            is deliberate: this is the one place in the joining process where people&rsquo;s identities
            are visible, and the plan is explicit that they are visible to the mediation body and
            nobody else — not to the evaluators, not to the person being objected to, and not to
            their inviter.
          </Banner>
          <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
            An Admin can grant the role under Access &amp; permissions, on the
            &ldquo;Recruitment mediation&rdquo; row. It can go on the recruitment task, the conflict
            team&rsquo;s task, or a task of its own — the community decides, and by default nothing
            holds it at all.
          </p>
          <Link href="/recruitment" className={`${BUTTON_SECONDARY} mt-4 inline-flex`}>
            Back to recruitment
          </Link>
        </div>
      </main>
    );
  }

  const queue = await getMediationQueue(actor);
  const body: MediationMember[] = await listMediationMembers(actor.communityId);
  const parties: Record<string, PartyList> = {};
  for (const item of queue.standing) {
    if (item.objectorName === null) continue;
    const listed = await listObjectionParties(item.id);
    parties[item.id] = {
      excluded: listed.excluded.map((e) => e.memberId),
      consented: listed.consented.map((c) => c.memberId),
    };
  }

  const flash = [
    params.resolved && "The objection has been settled.",
    params.recused && "That person is now recused from this objection.",
    params.consented && "That person may now be told who raised it.",
    params.consentWithdrawn && "That consent is withdrawn.",
    params.withdrawn && "Your objection has been withdrawn.",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="mx-auto max-w-[860px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader
        title="Recruitment mediation"
        description="Someone raised a concern about someone's arrival. It stands until it's talked through — a clock never ends it, and nobody is admitted or refused by a timer."
        actions={
          <Link href="/recruitment" className={BUTTON_SECONDARY}>
            Back to recruitment
          </Link>
        }
      />

      {params.error && (
        <div className="mt-4">
          <Banner tone="danger">{params.error}</Banner>
        </div>
      )}
      {flash && (
        <div className="mt-4">
          <Banner tone="success">{flash}</Banner>
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">The body</h2>
        {queue.authority ? (
          <div className="mt-2 max-w-[620px]">
            <Banner tone="warning">
              {queue.authority.open
                ? "Recruitment mediation is open to every member, so nobody is excluded from seeing an objection — including whoever it is about."
                : queue.authority.grantingTaskCount === 0
                  ? "No task grants Recruitment mediation, so there is nobody to mediate with. Grant it under Access & permissions."
                  : "A task grants Recruitment mediation but nobody holds it, so every concern is sitting with a body that doesn't exist. This is the failure §2.6 exists to end: a concern nobody is on the hook for is a quiet refusal."}
            </Banner>
          </div>
        ) : (
          <p className="mt-1 max-w-[620px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            {body.length === 1 ? "One person: " : `${body.length} people: `}
            {body.map((m) => m.name).join(", ")}.
            {body.length > 1
              ? " They can see who raised each concern and talk it through with everyone involved."
              : " With one person there is nobody to overrule a concern with — see the threshold below."}
          </p>
        )}

        <div className="mt-3 max-w-[620px] rounded-[var(--radius-md)] border border-[var(--border)] p-3">
          <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">The overrule, when there is one</p>
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text)]">
            Admitting somebody <em>over</em> a concern is the exception, not the way this works. If
            mediation doesn&rsquo;t clear the concern, the default is that it stands and the person
            doesn&rsquo;t join.
          </p>
          <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
            {queue.community.recruitmentObjectionOverrule === "majority" ? (
              <>
                This community needs a majority of the body as it stands right now —{" "}
                {queue.overrule.threshold} of {queue.overrule.bodySize}
                {queue.overrule.bodySize === 1
                  ? " (a body of one decides alone; there is nobody else to ask)"
                  : ""}
                . A lone objector has to win the room every time.
              </>
            ) : (
              <>
                This community has set a fixed quorum of {queue.community.recruitmentObjectionQuorum}.
              </>
            )}
          </p>
          {!queue.overrule.available && queue.overrule.reason && (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--warning)]">{queue.overrule.reason}</p>
          )}
        </div>
      </section>

      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-[length:var(--text-title)] font-semibold text-[var(--text)]">
          Outstanding concerns
          {queue.standing.length > 0 && <Tag tone="warning">{queue.standing.length}</Tag>}
        </h2>
        {queue.standing.length === 0 ? (
          <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
            Nothing is waiting on the body. A new concern appears here the moment a member raises one.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-4">
            {queue.standing.map((item) => (
              <StandingObjection
                key={item.id}
                item={item}
                body={body}
                parties={parties[item.id] ?? null}
                canOverrule={queue.overrule.available}
                threshold={queue.overrule.threshold}
                bodySize={queue.overrule.bodySize}
              />
            ))}
          </div>
        )}
      </section>

      {queue.settled.length > 0 && (
        <section className="mt-8">
          <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Settled</h2>
          <p className="mt-1 max-w-[620px] text-[length:var(--text-body)] text-[var(--text-muted)]">
            The record the plan asks for: every outcome, with the note the body wrote at the time. A
            pattern of concerns being overruled is visible here without anybody keeping a private
            tally of it.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {queue.settled.map((item) => (
              <div
                key={item.id}
                className="rounded-[var(--radius-md)] border border-[var(--border)] p-3"
                style={{ opacity: 0.75 }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                    {SUBJECT_LABEL[item.subject.kind]}
                  </span>
                  <Tag tone={item.resolution === "overruled" ? "warning" : "neutral"}>
                    {RESOLUTION_LABEL[item.resolution] ?? item.resolution}
                  </Tag>
                  <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    raised {new Date(item.raisedAt).toLocaleDateString()}
                    {item.resolvedAt
                      ? ` · settled ${new Date(item.resolvedAt).toLocaleDateString()}`
                      : ""}
                  </span>
                </div>
                <p className="mt-1.5 text-[length:var(--text-body)] text-[var(--text-muted)]">{item.note}</p>
                {item.resolutionNote && (
                  <p className="mt-1.5 text-[length:var(--text-body)] text-[var(--text)]">
                    <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                      The body&rsquo;s note:{" "}
                    </span>
                    {item.resolutionNote}
                  </p>
                )}
                {item.objectorName && (
                  <p className="mt-1.5 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                    Raised by {item.objectorName} — you can see that because you raised it.
                  </p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function StandingObjection({
  item,
  body,
  parties,
  canOverrule,
  threshold,
  bodySize,
}: {
  item: MediationItem;
  body: MediationMember[];
  parties: PartyList | null;
  canOverrule: boolean;
  threshold: number;
  bodySize: number;
}) {
  const isObjector = item.objectorName !== null;
  return (
    <article
      className="rounded-[var(--radius-md)] border p-4"
      style={{ background: "var(--warning-soft)", borderColor: "var(--warning-border)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[length:var(--text-heading)] font-medium text-[var(--text)]">
          {SUBJECT_LABEL[item.subject.kind]}
        </span>
        <Tag tone="warning">standing</Tag>
        <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          raised {new Date(item.raisedAt).toLocaleDateString()}
        </span>
        {item.subject.kind === "invite" && item.subject.consentAt && (
          <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
            · the invitee consented on {new Date(item.subject.consentAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <p className="mt-2 text-[length:var(--text-body)] text-[var(--text)]">{item.note}</p>
      {item.subject.kind === "application" && (
        <Link
          href={`/applications#response-${item.subject.formResponseId}`}
          className="mt-1 inline-block text-[length:var(--text-body)] text-[var(--accent-1)] underline"
        >
          Open the application
        </Link>
      )}

      {isObjector && parties ? (
        <ObjectorControls
          objectionId={item.id}
          body={body}
          excluded={parties.excluded}
          consented={parties.consented}
        />
      ) : (
        <p className="mt-2 text-[length:var(--text-meta)] text-[var(--text-muted)]">
          Who raised this is shielded — from the applicant, from their inviter, and from the
          evaluators. The person who raised it can recuse anyone from this queue, and can consent
          for one named person to be told.
        </p>
      )}

      <form action={resolveObjectionAction} className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="objectionId" value={item.id} />
        <label className="flex flex-col gap-1">
          <span className={LABEL}>What happened when you talked it through? (required, and kept)</span>
          <textarea name="note" required rows={2} className={INPUT} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" name="outcome" value="cleared" className={BUTTON_PRIMARY}>
            Clear it — they carry on
          </button>
          <button type="submit" name="outcome" value="upheld" className={BUTTON_SECONDARY}>
            It stands — they don&rsquo;t join
          </button>
          {canOverrule && (
            <button type="submit" name="outcome" value="overruled" className={BUTTON_SECONDARY}>
              Overrule anyway ({threshold} of {bodySize})
            </button>
          )}
        </div>
        <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
          {canOverrule
            ? "The overrule is the exception: it exists for a mediation split where the body still wants them in, and because it is an exception your note goes onto the permanent record."
            : "No overrule is available here, so a concern mediation can't clear means the person doesn't join. That is the default, and it is the whole reason a concern is never thrown out by a timer."}
        </p>
      </form>
    </article>
  );
}

function ObjectorControls({
  objectionId,
  body,
  excluded,
  consented,
}: {
  objectionId: string;
  body: MediationMember[];
  excluded: string[];
  consented: string[];
}) {
  const nameOf = (memberId: string) => body.find((m) => m.memberId === memberId)?.name ?? "Someone";
  return (
    <details className="mt-3 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] p-3">
      <summary className="cursor-pointer text-[length:var(--text-body)] font-medium text-[var(--text)]">
        Your controls over who finds out{" "}
        <span className="font-normal text-[var(--text-muted)]">
          ({excluded.length} recused, {consented.length} told)
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
          Nobody is told you raised this, and nobody will be unless you say so. You can take people
          off the list that can see it at all, and name one person to be told — the shield holds
          either way, because being told is not the same as being able to see it.
        </p>
        {excluded.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Recused</span>
            {excluded.map((memberId) => (
              <div key={memberId} className="flex items-center justify-between gap-2 text-[length:var(--text-body)]">
                <span className="text-[var(--text)]">{nameOf(memberId)}</span>
                <form action={withdrawConsentToObjectionAction}>
                  <input type="hidden" name="objectionId" value={objectionId} />
                  <input type="hidden" name="memberId" value={memberId} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Undo
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        {consented.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">Told</span>
            {consented.map((memberId) => (
              <div key={memberId} className="flex items-center justify-between gap-2 text-[length:var(--text-body)]">
                <span className="text-[var(--text)]">{nameOf(memberId)}</span>
                <form action={withdrawConsentToObjectionAction}>
                  <input type="hidden" name="objectionId" value={objectionId} />
                  <input type="hidden" name="memberId" value={memberId} />
                  <button type="submit" className={BUTTON_SECONDARY}>
                    Take it back
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
        <form action={recuseFromObjectionAction} className="flex items-end gap-2">
          <input type="hidden" name="objectionId" value={objectionId} />
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>Recuse someone from seeing this</span>
            <select name="memberId" required className={INPUT} defaultValue="">
              <option value="" disabled>
                — pick someone —
              </option>
              {body
                .filter((m) => !excluded.includes(m.memberId))
                .map((m) => (
                  <option key={m.memberId} value={m.memberId}>
                    {m.name}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_SECONDARY}>
            Recuse
          </button>
        </form>
        <form action={consentPartyToObjectionAction} className="flex items-end gap-2">
          <input type="hidden" name="objectionId" value={objectionId} />
          <label className="flex flex-1 flex-col gap-1">
            <span className={LABEL}>Let one person know it was you</span>
            <select name="memberId" required className={INPUT} defaultValue="">
              <option value="" disabled>
                — pick someone —
              </option>
              {body.map((m) => (
                <option key={m.memberId} value={m.memberId}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={BUTTON_SECONDARY}>
            Tell them
          </button>
        </form>
        <form action={withdrawObjectionAction}>
          <input type="hidden" name="objectionId" value={objectionId} />
          <button type="submit" className={BUTTON_SECONDARY}>
            Withdraw my objection — they join
          </button>
        </form>
      </div>
    </details>
  );
}

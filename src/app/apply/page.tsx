import { getOrCreateCommunity } from "@/lib/community";
import {
  communityInviteStatus,
  getCommunityInviteByToken,
  getCycleJoiningState,
  getJoinLaneRule,
  getInviteRedemptionPath,
  getRecruitmentApplicationFormPublic,
  getRecruitmentApplicationFormPublicById,
  joiningLaneForInvite,
  getPairingByToken,
} from "@/lib/recruitment";
import { consensusDisclosure, consensusWindowFor } from "@/lib/recruitment/consensus";
import { describeLaneConsequence, type JoiningLaneRule } from "@/lib/recruitment/lanes";
import { NotFoundError } from "@/lib/errors";
import type { FormField } from "@/lib/forms";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import { Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
import { submitApplicationAction } from "./actions";

export const dynamic = "force-dynamic";

// Public, no login required — "the actual evaluated-admission funnel"
// (docs/spec.md's Recruitment). Renders whatever Form the Community
// has configured as its application, the same field-rendering shape
// /feedback already uses for the authenticated post-cycle survey.
//
// Four things ride on the query string now (docs/joining-admission-plan.md
// §2.4/§2.8), and all four are the same idea: the link somebody was sent
// is the context, and the page has to honour it rather than treating
// itself as the plain public door.
//
//   ?invite=<token>    an invite's token, carried through to the
//                      submission — the vouch. It also decides the
//                      *lane*, because an invite's lane is fixed by the
//                      inviter's marks: a direct one can't apply at all
//                      (it redeems on its own page), while a nomination
//                      or consensus one is this page wrapped in that
//                      lane's window.
//   ?pair=<token>      §2.8's pairing link. Pre-pairs the applicant with
//                      whoever named them, so the pair is a fact recorded
//                      at the funnel rather than something to
//                      reconstruct afterwards.
//   ?cycle=<id>        targets a cycle's own joining config and form.
//   ?supportToken=&    set by the action *after* a nomination was opened
//                      for the application, so the "here's your link"
//                      follow-up is shown to the person who just applied
//                      rather than being lost in a redirect.
export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    submitted?: string;
    invite?: string;
    cycle?: string;
    pair?: string;
    supportToken?: string;
  }>;
}) {
  const { error, submitted, invite, cycle: cycleParam, pair, supportToken } = await searchParams;

  const community = await getOrCreateCommunity();
  const cycleId = cycleParam?.trim() || null;

  // Resolve the door + form for the targeted surface. A foreign or
  // nonexistent cycle id renders the "cycle not found" notice below
  // rather than erroring the page.
  let cycleContext: Awaited<ReturnType<typeof getCycleJoiningState>> | null = null;
  let cycleMissing = false;
  if (cycleId) {
    try {
      cycleContext = await getCycleJoiningState(community.id, cycleId);
    } catch (err) {
      if (err instanceof NotFoundError) {
        cycleMissing = true;
      } else {
        throw err;
      }
    }
  }

  // The invite is read here, not only in the action, because it decides
  // which lane's rule applies — and therefore whether this page owes the
  // applicant a consent disclosure, a support link, or nothing extra at
  // all. A dead or revoked token is treated as no token here so a stale
  // link still lands on a usable application page; the action is what
  // refuses it.
  const inviteRow = invite ? await getCommunityInviteByToken(invite) : undefined;
  const inviteUsable = Boolean(inviteRow) && communityInviteStatus(inviteRow) === "valid";
  const targetCycleId = cycleContext?.cycle.id ?? (inviteUsable ? (inviteRow!.cycleId ?? null) : null);
  const lane = inviteUsable && inviteRow ? joiningLaneForInvite(inviteRow) : "public_application";
  const rule = await getJoinLaneRule(community.id, targetCycleId, lane);
  const { communityName, windowHours } = await consensusWindowFor(community.id);
  const disclosure = consensusDisclosure(communityName, windowHours);

  // A pairing link is a fact about who arrived with whom and nothing
  // more (J9). The page says who named them, so the applicant isn't
  // applying into a mystery, and the platform decides nothing from it.
  const pairing = pair ? await getPairingByToken(pair) : null;

  // A direct-lane invite is refused by the lib, so say so here rather
  // than rendering a form whose submission will be rejected.
  const directInvite =
    inviteUsable && inviteRow ? (await getInviteRedemptionPath(community.id, inviteRow)) === "direct" : false;

  const form = cycleMissing
    ? null
    : targetCycleId
      ? cycleContext && cycleContext.cycle.recruitmentApplicationFormId
        ? await getRecruitmentApplicationFormPublicById(
            community.id,
            cycleContext.cycle.recruitmentApplicationFormId,
          )
        : null
      : (await getRecruitmentApplicationFormPublic(community.id)) ?? null;

  const fields = (form?.fields as FormField[] | undefined) ?? [];
  const heading = cycleContext
    ? `Apply to join ${cycleContext.cycle.name}`
    : pairing
      ? `You’re applying with ${pairing.namerName}`
      : "Apply to join";

  // §4.3/8c door state for a cycle-targeted landing: period + the
  // cycle's own applicationsOpen flag + capacity room. Shut or
  // unconfigured → "not accepting" copy instead of the form.
  const cycleDoorShut =
    cycleContext !== null &&
    !(cycleContext.periodOpen && cycleContext.cycle.applicationsOpen && !cycleContext.atCapacity);
  const notAccepting = !form || cycleDoorShut || directInvite;

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">{heading}</h1>

      {cycleMissing ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">That event doesn&apos;t exist — check the link.</p>
      ) : directInvite ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          That invite doesn&rsquo;t need an application — whoever sent it can tell you what to do
          instead, and it will be quicker for you both.
        </p>
      ) : notAccepting ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {cycleContext
            ? cycleContext.atCapacity
              ? "This event is at capacity — applications for it are closed."
              : cycleContext.periodOpen
                ? "Applications for this event are closed."
                : "Applications for this event aren’t open yet."
            : "Not accepting applications right now."}
        </p>
      ) : submitted ? (
        <SubmittedNotice rule={rule} windowHours={windowHours} supportToken={supportToken} />
      ) : (
        <>
          {pairing && (
            <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">
              {pairing.namerName} said you&rsquo;re coming together. That&rsquo;s all we do with it —
              we record it so you can see each other&rsquo;s name and be offered one interview
              between you if you both want that. It doesn&rsquo;t change how either of you is
              assessed.
            </p>
          )}
          {form.description && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">{form.description}</p>}
          {error && (
            <div className="mt-4">
              <Banner tone="danger">{error}</Banner>
            </div>
          )}

          <form action={submitApplicationAction} className="mt-6 flex flex-col gap-4">
            {inviteUsable && <input type="hidden" name="inviteToken" value={invite} />}
            {pairing && <input type="hidden" name="pairingToken" value={pairing.pair.token} />}
            {targetCycleId && <input type="hidden" name="cycleId" value={targetCycleId} />}
            {fields.map((f) => (
              <FieldPreview
                key={f.key}
                field={toPreviewShape({ ...f, label: f.label, required: f.required ?? false })}
                name={`field_${f.key}`}
              />
            ))}

            {rule.verificationMode === "consensus" && (
              // J10's binding consent for somebody who applied on their
              // own. There is no redemption step for this person, so the
              // disclosure and the tick have to happen here or a
              // consensus lane can't be used from the public door at all.
              // The hidden field is what gets stored, so the record
              // keeps the exact words rather than a version of them.
              <div className="flex flex-col gap-2">
                <input type="hidden" name="disclosure" value={disclosure} />
                <div
                  className="rounded-[var(--radius-md)] border border-[var(--border)] p-3 text-[length:var(--text-body)] text-[var(--text-muted)]"
                  style={{ background: "var(--neutral-100)" }}
                >
                  <p className="mb-1 text-[length:var(--text-meta)] font-medium text-[var(--text)]">
                    Before you send this — please read this
                  </p>
                  {disclosure}
                </div>
                <label className="flex items-start gap-2 text-[length:var(--text-body)] text-[var(--text)]">
                  <input type="checkbox" name="consentAccepted" required className="mt-0.5" />
                  <span>
                    I&rsquo;ve read that and understood my arrival would be announced to {communityName},
                    and that someone may raise a concern about it.
                  </span>
                </label>
              </div>
            )}

            <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
              Submit application
            </button>
          </form>

          {rule.verificationMode === "nomination" && (
            // §2.4's "the public applicant gets the same shape" — stated
            // honestly. This is a bonus, not a gate, and saying so is the
            // difference between asking and expecting; §2.5/J6 is
            // explicit that a lapsed nomination falls through.
            <p className="mt-4 text-[length:var(--text-meta)] text-[var(--text-muted)]">
              Once you&rsquo;ve sent this we&rsquo;ll give you a link to pass to people in the
              community who know you. It&rsquo;s entirely optional and nobody is waiting on it — if
              nobody uses it, or you decide not to bother, your application carries on exactly as it
              is.
            </p>
          )}
        </>
      )}

      <p className="mt-8 max-w-[560px] text-[length:var(--text-meta)] text-[var(--text-muted)]">
        What happens to this application: {lowerFirst(describeLaneConsequence(rule))}
      </p>
    </main>
  );
}

function SubmittedNotice({
  rule,
  windowHours,
  supportToken,
}: {
  rule: JoiningLaneRule;
  windowHours: number;
  supportToken?: string;
}) {
  return (
    <>
      <div className="mt-4">
        <Banner tone="success">Thanks — your application was submitted.</Banner>
      </div>
      {rule.verificationMode === "nomination" && (
        <div className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
          <p>
            There&rsquo;s one optional thing you can do: ask people in the community who know you to
            back you up. Nobody is waiting on it, and it changes nothing if nobody does — it usually
            just moves things along a little faster.
          </p>
          {supportToken ? (
            <p className="mt-2">
              <a href={`/support/${supportToken}`} className="text-[var(--accent-1)] underline">
                Get your link
              </a>{" "}
              — then pass it to whoever you like. If you&rsquo;d rather not, that&rsquo;s fine too.
            </p>
          ) : (
            <p className="mt-2">
              If you change your mind, reply to whoever you&rsquo;ve been in touch with and
              they&rsquo;ll be able to pass you a link.
            </p>
          )}
        </div>
      )}
      {rule.verificationMode === "consensus" && (
        <p className="mt-3 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Because this community announces arrivals, yours will be announced and any member has{" "}
          {windowHours} hours to raise a concern. A concern doesn&rsquo;t disappear on a timer — the
          mediation team talks it through, and unless they agree it&rsquo;s resolved, your arrival is
          held rather than waved through. Nobody is told who raised it, and you can ask us to stop at
          any time.
        </p>
      )}
    </>
  );
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

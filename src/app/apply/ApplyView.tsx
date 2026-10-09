import { getOrCreateCommunity } from "@/lib/community";
import {
  communityInviteStatus,
  declarationFromInvite,
  getCommunityInviteByToken,
  getCycleJoiningState,
  getPairingByToken,
  getRecruitmentApplicationFormPublicById,
  getRecruitmentApplicationFormPublic,
  resolveInviteLane,
  resolvePublicLane,
  type AdmissionLane,
} from "@/lib/recruitment";
import { consensusDisclosure, consensusWindowFor } from "@/lib/recruitment/consensus";
import { describeLanePath } from "@/lib/recruitment/lane-rules";
import { laneRuleOf } from "@/lib/recruitment/admission-lanes";
import { NotFoundError } from "@/lib/errors";
import type { FormField } from "@/lib/forms";
import FieldPreview, { toPreviewShape } from "@/components/FieldPreview";
import { Banner, BUTTON_PRIMARY } from "@/components/ui/kit";
import { submitApplicationAction } from "./actions";

// Public, no login required — "the actual evaluated-admission funnel"
// (docs/spec.md's Recruitment). Renders whatever Form the Community has
// configured as its application, the same field-rendering shape /feedback
// already uses for the authenticated post-cycle survey.
//
// The address is the lane (docs/admission-flow.md §2a): `/apply` is the first
// public lane and `/apply/<slug>` another, each a different starting point
// with its own process. Three things ride on the query string, and all three
// are the same idea — the link somebody was sent is the context, and the page
// has to honour it rather than treating itself as the plain public door:
//
//   ?invite=<token>  an invite's token, carried through to the submission —
//                    the vouch. It also decides the *lane*, because an
//                    invite's lane is found from what the inviter declared.
//   ?pair=<token>    §2.8's pairing link. Pre-pairs the applicant with
//                    whoever named them, so the pair is a fact recorded at
//                    the funnel rather than something to reconstruct later.
//   ?cycle=<id>      targets an event's own door and form, and the lanes the
//                    event has opened.
export default async function ApplyView({
  searchParams,
  slug,
}: {
  searchParams: Promise<{
    error?: string;
    invite?: string;
    cycle?: string;
    pair?: string;
  }>;
  slug: string | null;
}) {
  const { error, invite, cycle: cycleParam, pair } = await searchParams;

  const community = await getOrCreateCommunity();
  const cycleId = cycleParam?.trim() || null;

  // Resolve the door + form for the targeted surface. A foreign or
  // nonexistent cycle id renders the "cycle not found" notice below rather
  // than erroring the page.
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
  // which lane applies — and therefore whether this page owes the applicant a
  // consent disclosure or nothing extra at all. A dead or revoked token is
  // treated as no token here so a stale link still lands on a usable
  // application page; the action is what refuses it.
  const inviteRow = invite ? await getCommunityInviteByToken(invite) : undefined;
  const inviteUsable = Boolean(inviteRow) && communityInviteStatus(inviteRow) === "valid";
  const targetCycleId = cycleContext?.cycle.id ?? (inviteUsable ? (inviteRow!.cycleId ?? null) : null);

  let lane: AdmissionLane | null = null;
  if (!cycleMissing) {
    lane =
      inviteUsable && inviteRow
        ? await resolveInviteLane(community.id, targetCycleId, declarationFromInvite(inviteRow))
        : await resolvePublicLane(community.id, targetCycleId, slug);
  }
  const { communityName, windowHours } = await consensusWindowFor(community.id);
  const disclosure = consensusDisclosure(communityName, windowHours);

  // A pairing link is a fact about who arrived with whom and nothing more
  // (J9). The page says who named them, so the applicant isn't applying into
  // a mystery, and the platform decides nothing from it.
  const pairing = pair ? await getPairingByToken(pair) : null;

  const form = cycleMissing
    ? null
    : targetCycleId
      ? cycleContext && cycleContext.cycle.recruitmentApplicationFormId
        ? await getRecruitmentApplicationFormPublicById(community.id, cycleContext.cycle.recruitmentApplicationFormId)
        : (await getRecruitmentApplicationFormPublic(community.id)) ?? null
      : (await getRecruitmentApplicationFormPublic(community.id)) ?? null;

  const fields = (form?.fields as FormField[] | undefined) ?? [];
  const heading = cycleContext
    ? `Apply to join ${cycleContext.cycle.name}`
    : pairing
      ? `You’re applying with ${pairing.namerName}`
      : "Apply to join";

  // §4.3/8c door state for an event landing: period + the event's own
  // applicationsOpen flag + capacity room. Shut or unconfigured → "not
  // accepting" copy instead of the form.
  const cycleDoorShut =
    cycleContext !== null &&
    !(cycleContext.periodOpen && cycleContext.cycle.applicationsOpen && !cycleContext.atCapacity);
  const communityDoorShut = !cycleContext && !community.recruitmentApplicationsOpen;
  const noApplicationNeeded = Boolean(lane) && !lane!.applicationRequired;
  const notAccepting = !form || !lane || cycleDoorShut || communityDoorShut || noApplicationNeeded;

  const heldInvite = inviteUsable && !lane;
  const isCheck = lane?.verification === "community_check";

  return (
    <main className="mx-auto max-w-[640px] px-6 py-16">
      <h1 className="text-[length:var(--text-display)] font-semibold leading-tight text-[var(--text)]">{heading}</h1>

      {cycleMissing ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">That event doesn&apos;t exist — check the link.</p>
      ) : heldInvite ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          This invitation can&rsquo;t be used right now &mdash; {communityName} isn&rsquo;t taking this kind of
          invitation at the moment. Your link is kept, so it&rsquo;s worth trying again later.
        </p>
      ) : noApplicationNeeded ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          That invitation doesn&rsquo;t need an application — open its join link instead.
        </p>
      ) : !lane ? (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          {cycleContext
            ? "This event isn’t taking public applications — if you’ve been invited, use your invitation’s link."
            : "This community isn’t taking public applications right now — if you’ve been invited, use your invitation’s link."}
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
            {slug && <input type="hidden" name="publicSlug" value={slug} />}
            {fields.map((f) => (
              <FieldPreview
                key={f.key}
                field={toPreviewShape({ ...f, label: f.label, required: f.required ?? false })}
                name={`field_${f.key}`}
              />
            ))}

            {isCheck && (
              // The binding consent for somebody who applied on their own.
              // There is no redemption step for this person, so the
              // disclosure and the tick have to happen here. The hidden
              // field is what gets stored, so the record keeps the exact
              // words rather than a version of them.
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
        </>
      )}

      {lane && !notAccepting && (
        <p className="mt-8 max-w-[560px] text-[length:var(--text-meta)] text-[var(--text-muted)]">
          What happens to this application: {describeLanePath(laneRuleOf(lane))}
        </p>
      )}
    </main>
  );
}

import { redirect } from "next/navigation";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { cycle, member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  communityInviteStatus,
  getJoinLaneRule,
  isRecruitmentTaskHolder,
  joiningLaneForInvite,
  listInquiries,
  listMyCommunityInvites,
} from "@/lib/recruitment";
import { getNominationForInvite } from "@/lib/recruitment/support";
import { JOINING_LANE_COPY } from "@/lib/recruitment/lanes";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, INPUT, LABEL, Tag, type Tone } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import InviteMarkPicker from "./InviteMarkPicker";
import {
  claimInquiryAction,
  createCommunityInviteAction,
  pokeForSupportAction,
  resolveInquiryAction,
  revokeCommunityInviteAction,
} from "./actions";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  valid: "active",
  redeemed: "redeemed",
  revoked: "revoked",
  expired: "expired",
};

const STATUS_TONE: Record<string, Tone> = {
  valid: "success",
  redeemed: "neutral",
  revoked: "danger",
  expired: "warning",
};

// See docs/spec.md's Recruitment "Invite links" and "A public inquiry
// inbox, not a CRM," and docs/development-plan.md's Phase 32 — the two
// low-structure public entry points, plus the authenticated surfaces that
// manage them.
//
// §5.3's change is the marks. They used to be two bare checkboxes with
// their consequence in a paragraph *below* the event picker, which meant
// the person about to tick one was reading about capacity holds rather
// than about their friend. Now the form starts by asking what the two
// marks mean in this community's own configuration and shows the live
// consequence sentence for whichever combination is currently selected —
// the same sentence the settings panel and the applicant both read, from
// the same function, so the three can never disagree.
export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    revoked?: string;
    claimed?: string;
    inquiryResolved?: string;
    invite?: string;
    poked?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, created, revoked, claimed, inquiryResolved, invite: focusedInviteId, poked } =
    await searchParams;

  const communityRow = await getCommunity(viewing);
  const moduleOn = isModuleEnabled(communityRow, "recruitment");

  const [myInvites, isHolder, appUrl, cycles] = await Promise.all([
    moduleOn ? listMyCommunityInvites(viewing) : Promise.resolve([]),
    moduleOn ? isRecruitmentTaskHolder(viewing) : Promise.resolve(false),
    resolveAppUrlFromHeaders(),
    // The cycle picker — open cycles only: closed ones admit no one.
    moduleOn
      ? db
          .select({ id: cycle.id, name: cycle.name })
          .from(cycle)
          .where(and(eq(cycle.communityId, viewing.communityId), isNull(cycle.closedAt)))
          .orderBy(cycle.name)
      : Promise.resolve([]),
  ]);
  const inquiries = moduleOn && isHolder ? await listInquiries(viewing) : [];
  const cycleNames = new Map(cycles.map((c) => [c.id, c.name]));

  // The three invite-lane rules for the *general* (cycle-less) context,
  // which is what the form's marks resolve against before an event is
  // chosen. An event with its own overrides is picked afterwards, and the
  // page says so rather than pretending the general answer is universal.
  const laneRules = await Promise.all(
    (["invited_knows_personally", "invited_good_fit", "invited_neither"] as const).map((lane) =>
      getJoinLaneRule(viewing.communityId, null, lane),
    ),
  );

  const focusedInvite = focusedInviteId ? myInvites.find((i) => i.id === focusedInviteId) : undefined;
  const focusedNomination = focusedInvite ? await getNominationForInvite(focusedInvite.id) : null;
  // Only loaded when there's a nomination to poke for, because it's the
  // whole member list and the rest of the page doesn't want it.
  const pokeCandidates =
    focusedNomination && moduleOn
      ? await db
          .select({ id: member.id, name: member.name })
          .from(member)
          .where(and(eq(member.communityId, viewing.communityId), ne(member.id, viewing.id)))
          .orderBy(member.name)
      : [];

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader title="Invites" />

      {!moduleOn && (
        <p className="mt-4 text-[length:var(--text-body)] text-[var(--text-muted)]">
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <Banner tone="danger">{error}</Banner>}
          {created && <Banner tone="success">Invite created — copy the link below.</Banner>}
          {revoked && <Banner tone="success">Invite revoked.</Banner>}
          {claimed && <Banner tone="success">Inquiry claimed.</Banner>}
          {inquiryResolved && <Banner tone="success">Inquiry marked resolved.</Banner>}
          {poked && (
            <Banner tone="success">
              Asked. Each person you named got their own email with the support link, and nobody
              else was told anything.
            </Banner>
          )}

          {focusedInvite && focusedNomination && (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--accent-1)] p-4">
              <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">Your support link</p>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Hand this to whoever you trust to answer, or name them below and let the platform
                send it. Either way it&rsquo;s per-person: nobody&rsquo;s name is announced to anybody
                else.
              </p>
              <p className="mt-2 break-all text-[length:var(--text-body)] text-[var(--text)]">
                {appUrl}/support/{focusedNomination.supportToken}
              </p>
              {focusedNomination.deadline && (
                <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Open until{" "}
                  {new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
                    focusedNomination.deadline,
                  )}
                  . After that nobody has to do anything — they carry on either way.
                </p>
              )}
              {/* §2.4's poke: named people, one email each, never a
                  broadcast. The people most likely to actually know are
                  usually not the people a directory search would surface,
                  which is why this is a picker over every member rather
                  than a role list. */}
              <form action={pokeForSupportAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="inviteId" value={focusedInvite.id} />
                <p className="text-[length:var(--text-meta)] font-medium text-[var(--text-muted)]">
                  Who else might know them?
                </p>
                <select name="pokeMemberId" multiple size={6} className={`${INPUT} h-auto`}>
                  {pokeCandidates.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <p className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  Hold ⌘/Ctrl to pick more than one. Each of them gets their own email with the
                  link; nobody else hears anything, and if none of them answer nothing happens to
                  this person.
                </p>
                <button type="submit" className={`${BUTTON_SECONDARY} w-fit`}>
                  Ask them
                </button>
              </form>
            </div>
          )}

          <section className="mt-6">
            <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Create an invite link</h2>
            <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
              Always single-use — shows nothing about you or the community&rsquo;s roster to whoever
              opens it, just a path to become a member.
            </p>

            <form action={createCommunityInviteAction} className="mt-3 flex max-w-[480px] flex-col gap-3">
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Label (optional — so you can tell several links apart)</span>
                <input type="text" name="label" className={INPUT} />
              </label>
              {/* The mark checkboxes themselves live in InviteMarkPicker so
                  the consequence sentence can be derived from their live
                  state as they're ticked — and so the awareness box the
                  consensus lane demands can appear and disappear with the
                  marks it depends on. It renders *inside* this form, so
                  there is still one Create button. */}
              <InviteMarkPicker
                laneRules={{
                  invited_knows_personally: laneRules[0],
                  invited_good_fit: laneRules[1],
                  invited_neither: laneRules[2],
                }}
                communityName={communityRow.name}
              />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>For an event (optional — off = a general community invite)</span>
                <select name="cycleId" className={INPUT} defaultValue="">
                  <option value="">— general invite —</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  An event can have its own admission rules, set on the event&rsquo;s own settings
                  page — what you see above is the community-wide default.
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Expires at (optional)</span>
                <input type="datetime-local" name="expiresAt" className={INPUT} />
                <span className="text-[length:var(--text-meta)] text-[var(--text-muted)]">
                  A direct invite into a capacity-capped event holds a place until it&rsquo;s used,
                  revoked or expired, so one of those needs a real date. Read on the event&rsquo;s
                  clock, or the community&rsquo;s when it isn&rsquo;t for one particular event.
                </span>
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Create invite
              </button>
            </form>
          </section>

          <section className="mt-8">
            <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Your invite links</h2>
            {myInvites.length === 0 && <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">None yet.</p>}
            <div className="mt-3 space-y-3">
              {myInvites.map((invite) => {
                const status = communityInviteStatus(invite);
                const lane = joiningLaneForInvite(invite);
                return (
                  <div key={invite.id} className={CARD}>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="text-[var(--text)]">{invite.label || "(unlabeled)"}</strong>
                      <Tag tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status]}</Tag>
                      {invite.consensusState === "announced" && <Tag tone="warning">community check open</Tag>}
                      {invite.consensusState === "withheld" && <Tag tone="danger">objected to</Tag>}
                    </div>
                    {status === "valid" && (
                      <p className="mt-1 break-all text-[length:var(--text-body)] text-[var(--text)]">
                        {appUrl}/invite/{invite.token}
                      </p>
                    )}
                    <p className="mt-1 text-[length:var(--text-meta)] text-[var(--text-muted)]">
                      {invite.cycleId && cycleNames.has(invite.cycleId) && (
                        <span className="font-medium text-[var(--text)]">{cycleNames.get(invite.cycleId)} · </span>
                      )}
                      {JOINING_LANE_COPY[lane].title} · created {new Date(invite.createdAt).toLocaleDateString()}
                      {invite.expiresAt && ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                    </p>
                    {status === "valid" && (
                      <form action={revokeCommunityInviteAction} className="mt-2">
                        <input type="hidden" name="inviteId" value={invite.id} />
                        <button type="submit" className={BUTTON_SECONDARY}>
                          Revoke
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {isHolder && (
            <section className="mt-8">
              <h2 className="text-[length:var(--text-title)] font-semibold text-[var(--text)]">Inquiry inbox</h2>
              <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                Visible to you because you hold the recruitment task. Claim one so two people
                don&rsquo;t unknowingly reach out to the same person.
              </p>
              {inquiries.length === 0 && (
                <p className="mt-2 text-[length:var(--text-body)] text-[var(--text-muted)]">Nothing pending.</p>
              )}
              <div className="mt-3 space-y-3">
                {inquiries.map((inq) => (
                  <div key={inq.id} className={CARD}>
                    <p className="text-[length:var(--text-body)] text-[var(--text)]">{inq.message}</p>
                    <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">
                      Contact: {inq.contactInfo} · submitted {new Date(inq.submittedAt).toLocaleString()}
                    </p>
                    <p className="mt-1">
                      <Tag tone={inq.resolvedAt ? "success" : inq.claimedBy ? "accent" : "warning"}>
                        {inq.resolvedAt
                          ? "Resolved"
                          : inq.claimedBy
                            ? `Claimed ${new Date(inq.claimedAt!).toLocaleString()}`
                            : "Unclaimed"}
                      </Tag>
                    </p>
                    {!inq.resolvedAt && (
                      <div className="mt-2 flex gap-2">
                        {!inq.claimedBy && (
                          <form action={claimInquiryAction}>
                            <input type="hidden" name="inquiryId" value={inq.id} />
                            <button type="submit" className={BUTTON_SECONDARY}>
                              Claim
                            </button>
                          </form>
                        )}
                        <form action={resolveInquiryAction}>
                          <input type="hidden" name="inquiryId" value={inq.id} />
                          <button type="submit" className={BUTTON_SECONDARY}>
                            Mark resolved
                          </button>
                        </form>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}

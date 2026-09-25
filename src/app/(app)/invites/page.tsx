import { redirect } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { cycle } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { getCommunity } from "@/lib/settings";
import { isModuleEnabled } from "@/lib/modules";
import {
  communityInviteStatus,
  isRecruitmentTaskHolder,
  listInquiries,
  listMyCommunityInvites,
} from "@/lib/recruitment";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import { Banner, BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, CheckField, INPUT, LABEL, Tag, type Tone } from "@/components/ui/kit";
import PageHeader from "@/components/ui/PageHeader";
import {
  claimInquiryAction,
  createCommunityInviteAction,
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
// inbox, not a CRM," and docs/development-plan.md's Phase 32 — the
// two low-structure public entry points, plus the authenticated
// surfaces that manage them.
export default async function InvitesPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    created?: string;
    revoked?: string;
    claimed?: string;
    inquiryResolved?: string;
  }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error, created, revoked, claimed, inquiryResolved } = await searchParams;

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

  return (
    <main className="mx-auto max-w-[760px] px-6 py-10 md:px-12 md:py-14">
      <PageHeader title="Invites" />

      {!moduleOn && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
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

          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">Create an invite link</h2>
            <p className="mt-1 text-[13px] text-[var(--text-muted)]">
              Always single-use — shows nothing about you or the community&rsquo;s roster to
              whoever opens it, just a path to become a member.
            </p>
            <form
              action={createCommunityInviteAction}
              className="mt-3 flex max-w-[480px] flex-col gap-3"
            >
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Label (optional — so you can tell several links apart)</span>
                <input type="text" name="label" className={INPUT} />
              </label>
              <CheckField label="I think this person is a good fit" name="inviterThinksGoodFit" />
              <CheckField label="I personally know this person" name="inviterKnowsPersonally" />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>For a cycle (optional — off = a general community invite)</span>
                <select name="cycleId" className={INPUT} defaultValue="">
                  <option value="">— general invite —</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-[var(--text-muted)]">
                  An invite&rsquo;s lane is fixed by your marks: marked as known personally, it redeems on the spot
                  and holds a capacity slot until used (an expiry is required for capacity-capped cycles); otherwise
                  it routes through the evaluated application instead and holds nothing (docs/joining-admission-plan.md §2).
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={LABEL}>Expires at (optional)</span>
                <input type="datetime-local" name="expiresAt" className={INPUT} />
              </label>
              <button type="submit" className={`${BUTTON_PRIMARY} w-fit`}>
                Create invite
              </button>
            </form>
          </section>

          <section className="mt-6">
            <h2 className="text-[22px] font-semibold text-[var(--text)]">Your invite links</h2>
            {myInvites.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">None yet.</p>}
            <div className="mt-3 space-y-3">
            {myInvites.map((invite) => {
              const status = communityInviteStatus(invite);
              return (
                <div key={invite.id} className={CARD}>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong className="text-[var(--text)]">{invite.label || "(unlabeled)"}</strong>
                    <Tag tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status]}</Tag>
                  </div>
                  {status === "valid" && (
                    <p className="mt-1 break-all text-[13px] text-[var(--text)]">
                      {appUrl}/invite/{invite.token}
                    </p>
                  )}
                  <p className="mt-1 text-[12px] text-[var(--text-muted)]">
                    {invite.cycleId && cycleNames.has(invite.cycleId) && (
                      <span className="font-medium text-[var(--text)]">{cycleNames.get(invite.cycleId)} · </span>
                    )}
                    {invite.inviterThinksGoodFit && "good fit · "}
                    {invite.inviterKnowsPersonally && "know personally · "}
                    created {new Date(invite.createdAt).toLocaleDateString()}
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
            <section className="mt-6">
              <h2 className="text-[22px] font-semibold text-[var(--text)]">Inquiry inbox</h2>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">
                Visible to you because you hold the recruitment task. Claim one so two people don&rsquo;t
                unknowingly reach out to the same person.
              </p>
              {inquiries.length === 0 && <p className="mt-2 text-[13px] text-[var(--text-muted)]">Nothing pending.</p>}
              <div className="mt-3 space-y-3">
              {inquiries.map((inq) => (
                <div key={inq.id} className={CARD}>
                  <p className="text-[13px] text-[var(--text)]">{inq.message}</p>
                  <p className="mt-1 text-[13px] text-[var(--text-muted)]">
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

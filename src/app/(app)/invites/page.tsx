import { redirect } from "next/navigation";
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

  const [myInvites, isHolder, appUrl] = await Promise.all([
    moduleOn ? listMyCommunityInvites(viewing) : Promise.resolve([]),
    moduleOn ? isRecruitmentTaskHolder(viewing) : Promise.resolve(false),
    resolveAppUrlFromHeaders(),
  ]);
  const inquiries = moduleOn && isHolder ? await listInquiries(viewing) : [];

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 760 }}>
      <h1>Invites</h1>

      {!moduleOn && (
        <p style={{ color: "#666" }}>
          Recruitment isn&rsquo;t turned on for this Community yet — a current Admins holder can
          enable it under Modules on the Settings screen.
        </p>
      )}

      {moduleOn && (
        <>
          {error && <p style={{ color: "crimson" }}>{error}</p>}
          {created && <p style={{ color: "#2a7a2a" }}>Invite created — copy the link below.</p>}
          {revoked && <p style={{ color: "#2a7a2a" }}>Invite revoked.</p>}
          {claimed && <p style={{ color: "#2a7a2a" }}>Inquiry claimed.</p>}
          {inquiryResolved && <p style={{ color: "#2a7a2a" }}>Inquiry marked resolved.</p>}

          <section style={{ marginTop: "1rem" }}>
            <h2>Create an invite link</h2>
            <p style={{ color: "#666", fontSize: "0.85rem" }}>
              Always single-use — shows nothing about you or the community&rsquo;s roster to
              whoever opens it, just a path to become a member.
            </p>
            <form
              action={createCommunityInviteAction}
              style={{ display: "flex", flexDirection: "column", gap: "0.5rem", maxWidth: 480 }}
            >
              <label>
                Label (optional — so you can tell several links apart)
                <br />
                <input type="text" name="label" style={{ padding: "0.4rem", width: "100%" }} />
              </label>
              <label>
                <input type="checkbox" name="inviterThinksGoodFit" /> I think this person is a good
                fit
              </label>
              <label>
                <input type="checkbox" name="inviterKnowsPersonally" /> I personally know this
                person
              </label>
              <label>
                Expires at (optional)
                <br />
                <input type="datetime-local" name="expiresAt" style={{ padding: "0.4rem" }} />
              </label>
              <button type="submit" style={{ padding: "0.4rem 1rem", width: "fit-content" }}>
                Create invite
              </button>
            </form>
          </section>

          <section style={{ marginTop: "2rem" }}>
            <h2>Your invite links</h2>
            {myInvites.length === 0 && <p style={{ color: "#666" }}>None yet.</p>}
            {myInvites.map((invite) => {
              const status = communityInviteStatus(invite);
              return (
                <div
                  key={invite.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <strong>{invite.label || "(unlabeled)"}</strong>{" "}
                  <span style={{ color: "#666" }}>— {STATUS_LABEL[status]}</span>
                  {status === "valid" && (
                    <p style={{ margin: "0.3rem 0", fontSize: "0.85rem", wordBreak: "break-all" }}>
                      {appUrl}/invite/{invite.token}
                    </p>
                  )}
                  <p style={{ margin: "0.2rem 0", fontSize: "0.8rem", color: "#666" }}>
                    {invite.inviterThinksGoodFit && "good fit · "}
                    {invite.inviterKnowsPersonally && "know personally · "}
                    created {new Date(invite.createdAt).toLocaleDateString()}
                    {invite.expiresAt && ` · expires ${new Date(invite.expiresAt).toLocaleDateString()}`}
                  </p>
                  {status === "valid" && (
                    <form action={revokeCommunityInviteAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                        Revoke
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </section>

          {isHolder && (
            <section style={{ marginTop: "2rem" }}>
              <h2>Inquiry inbox</h2>
              <p style={{ color: "#666", fontSize: "0.85rem" }}>
                Visible to you because you hold the recruitment task. Claim one so two people don&rsquo;t
                unknowingly reach out to the same person.
              </p>
              {inquiries.length === 0 && <p style={{ color: "#666" }}>Nothing pending.</p>}
              {inquiries.map((inq) => (
                <div
                  key={inq.id}
                  style={{ border: "1px solid #ccc", borderRadius: 6, padding: "0.6rem", marginBottom: "0.5rem" }}
                >
                  <p style={{ margin: "0 0 0.3rem" }}>{inq.message}</p>
                  <p style={{ margin: "0 0 0.3rem", fontSize: "0.85rem", color: "#666" }}>
                    Contact: {inq.contactInfo} · submitted {new Date(inq.submittedAt).toLocaleString()}
                  </p>
                  <p style={{ margin: "0 0 0.3rem", fontSize: "0.8rem" }}>
                    {inq.resolvedAt
                      ? "Resolved"
                      : inq.claimedBy
                        ? `Claimed ${new Date(inq.claimedAt!).toLocaleString()}`
                        : "Unclaimed"}
                  </p>
                  {!inq.resolvedAt && (
                    <div style={{ display: "flex", gap: "0.5rem" }}>
                      {!inq.claimedBy && (
                        <form action={claimInquiryAction}>
                          <input type="hidden" name="inquiryId" value={inq.id} />
                          <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                            Claim
                          </button>
                        </form>
                      )}
                      <form action={resolveInquiryAction}>
                        <input type="hidden" name="inquiryId" value={inq.id} />
                        <button type="submit" style={{ padding: "0.3rem 0.6rem" }}>
                          Mark resolved
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </main>
  );
}

import type { community as communityTable, member as memberTable } from "@/db/schema";
import { isOidcConfigured } from "@/lib/oidc";
import { zitadelConfigFor } from "@/lib/zitadel";
import { listLinkableMembers, listUnmatchedSignIns } from "@/lib/sign-in/unmatched";
import { listSignInTodos } from "@/lib/sign-in/provision";
import { db } from "@/db";
import { eq } from "drizzle-orm";
import { member } from "@/db/schema";
import { SelectField, SettingsGroup, SettingsPanel, ToggleField } from "./ui";
import {
  linkSignInAction,
  markSignInSetUpAction,
  removeEmptyMemberAction,
  retrySignInSetupAction,
  turnAwaySignInAction,
  updateSsoProvisioningAction,
} from "./actions";

type Community = typeof communityTable.$inferSelect;
type Member = typeof memberTable.$inferSelect;

const button =
  "rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-[length:var(--text-body)] text-[var(--text)] hover:bg-[var(--neutral-100)]";
const meta = "text-[length:var(--text-meta)] text-[var(--text-muted)]";

const JOIN_POLICY_LABEL = {
  anyone_with_role: "Anyone who has the role at the provider gets an account on first sign-in",
  admitted_only: "Only people admitted here — anyone else waits for an administrator",
} as const;

// docs/admission-flow.md §6a — what "admitted" means at the provider, the sign-ins Orchard
// will not turn into a member by itself, and the one way an administrator can remove a member
// who has nothing to their name. The first two are shown only when single sign-on is
// configured (a community without it has no provider to disagree with); the last is always
// there, because duplicates are not only an SSO problem.
export default async function SignInAccounts({ community, viewer }: { community: Community; viewer: Member }) {
  const sso = isOidcConfigured(community);
  const automationReady = sso && Boolean(zitadelConfigFor(community));
  const [todos, unmatched, linkable, everyone] = await Promise.all([
    sso ? listSignInTodos(viewer) : Promise.resolve([]),
    sso ? listUnmatchedSignIns(viewer) : Promise.resolve([]),
    sso ? listLinkableMembers(viewer) : Promise.resolve([]),
    db.select({ id: member.id, name: member.name }).from(member).where(eq(member.communityId, viewer.communityId)).orderBy(member.name),
  ]);

  return (
    <div className="flex flex-col gap-4">
      {sso && (
        <SettingsGroup
          action={updateSsoProvisioningAction}
          submitLabel="Save provider settings"
          title="Accounts at the provider"
          stateLabel="Whether admitting someone creates their sign-in account, whether leaving takes the role back, and who may join through the provider"
          state={
            <>
              {community.ssoCreateOnAdmit ? "Creates an account when someone is admitted" : "Doesn't create accounts"} ·{" "}
              {community.ssoRevokeOnLeave ? "takes the role back on leaving" : "leaves the role when someone leaves"} ·{" "}
              {JOIN_POLICY_LABEL[community.ssoJoinPolicy]}
            </>
          }
          description="All off until you turn them on. Creating and revoking need a service token in the environment (ZITADEL_TOKEN and ZITADEL_PROJECT_ID, next to the client secret); without one, admission still completes and the to-do below tells you what to do by hand."
        >
          {!automationReady && (
            <p className={meta}>The provider&rsquo;s service token or project isn&rsquo;t set up for Orchard, so creating and revoking can&rsquo;t run yet.</p>
          )}
          <ToggleField
            label="Create a sign-in account when someone is admitted"
            name="ssoCreateOnAdmit"
            defaultChecked={community.ssoCreateOnAdmit}
            hint="Finds the person at the provider by email (or creates them), has the provider email them to set up their own sign-in, and grants the role. Orchard never sees a password."
          />
          <ToggleField
            label="Take the role back when someone leaves"
            name="ssoRevokeOnLeave"
            defaultChecked={community.ssoRevokeOnLeave}
            hint="So the provider and Orchard can't disagree about who belongs. If the provider can't be reached, leaving still works and tells the person it didn't go through."
          />
          <SelectField
            label="Who may join through the provider"
            name="ssoJoinPolicy"
            defaultValue={community.ssoJoinPolicy}
            wide
            options={[
              { value: "anyone_with_role", label: JOIN_POLICY_LABEL.anyone_with_role },
              { value: "admitted_only", label: JOIN_POLICY_LABEL.admitted_only },
            ]}
            hint="Either way, someone whose address already belongs to a member is never given a second account — they wait for an administrator to connect them."
          />
        </SettingsGroup>
      )}

      {sso && todos.length > 0 && (
        <SettingsPanel
          title={`Sign-in still being set up (${todos.length})`}
          description="People who were admitted but can't sign in at the provider yet. Admission is complete for all of them; this is only the account."
        >
          <ul className="flex flex-col gap-3">
            {todos.map(({ setup, name }) => (
              <li key={setup.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                  {name} <span className={meta}>· {setup.status === "pending" ? "will be tried again" : "needs you"} · {setup.attempts} attempt{setup.attempts === 1 ? "" : "s"}</span>
                </p>
                {setup.lastError && <p className={`mt-1 ${meta}`}>{setup.lastError}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <form action={retrySignInSetupAction}>
                    <input type="hidden" name="memberId" value={setup.memberId} />
                    <button type="submit" className={button}>Try again</button>
                  </form>
                  <form action={markSignInSetUpAction}>
                    <input type="hidden" name="memberId" value={setup.memberId} />
                    <button type="submit" className={button}>I did it by hand</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </SettingsPanel>
      )}

      {sso && unmatched.length > 0 && (
        <SettingsPanel
          title={`Sign-ins waiting for you (${unmatched.length})`}
          description="Someone signed in at the provider with the role, but Orchard wouldn't decide by itself which member they are — or whether to make one. Nothing was created."
        >
          <ul className="flex flex-col gap-3">
            {unmatched.map((u) => (
              <li key={u.id} className="rounded-[var(--radius-md)] border border-[var(--border)] p-3">
                <p className="text-[length:var(--text-body)] font-medium text-[var(--text)]">
                  {u.givenName || u.nickname || u.loginEmail}{" "}
                  <span className={meta}>
                    · {u.loginEmail} · {u.emailVerified === true ? "address confirmed by the provider" : "address not confirmed"} · last tried{" "}
                    {new Date(u.lastSeenAt).toLocaleString()}
                  </span>
                </p>
                {u.suggestedMemberName && (
                  <p className={`mt-1 ${meta}`}>
                    A member already has this address: <strong className="text-[var(--text)]">{u.suggestedMemberName}</strong>.
                  </p>
                )}
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  <form action={linkSignInAction} className="flex flex-wrap items-end gap-2">
                    <input type="hidden" name="unmatchedId" value={u.id} />
                    <SelectField
                      label="Connect to"
                      name="memberId"
                      defaultValue={u.suggestedMemberId ?? ""}
                      options={[{ value: "", label: "— choose a member —" }, ...linkable.map((m) => ({ value: m.id, label: m.name }))]}
                    />
                    <button type="submit" className={button}>Connect them</button>
                  </form>
                  <form action={turnAwaySignInAction}>
                    <input type="hidden" name="unmatchedId" value={u.id} />
                    <button type="submit" className={button}>Turn away</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </SettingsPanel>
      )}

      <SettingsPanel
        title="Remove an empty member"
        description="For a duplicate or a test account with nothing to its name. It deletes their sign-in, contact details and answers, then the member — but only if nothing else points at them: a task they hold, a place in an event, a report, a comment or an admission all stop it, and are listed so you can see why. It can't be undone, and it's recorded in the history."
      >
        <form action={removeEmptyMemberAction} className="flex flex-wrap items-end gap-3">
          <SelectField
            label="Member"
            name="memberId"
            defaultValue=""
            options={[{ value: "", label: "— choose a member —" }, ...everyone.filter((m) => m.id !== viewer.id).map((m) => ({ value: m.id, label: m.name }))]}
          />
          <label className="flex items-center gap-2 text-[length:var(--text-body)] text-[var(--text)]">
            <input type="checkbox" name="confirm" required /> I understand this can&rsquo;t be undone
          </label>
          <button type="submit" className={button}>Remove</button>
        </form>
      </SettingsPanel>
    </div>
  );
}

import Image from "next/image";
import type { branch as branchTable, community as communityTable, member as memberTable, tier as tierTable } from "@/db/schema";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, INPUT, LABEL, Tag } from "@/components/ui/kit";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { COMMUNITY_ICON_ACCEPT } from "@/lib/settings/community-icon";
import SignInAccounts from "../SignInAccounts";
import {
  FieldGroup,
  SelectField,
  SettingsCard,
  SettingsField,
  SettingsGroup,
  SettingsPanel,
  SettingsSection,
  TextField,
  TimeZoneField,
  ToggleField,
} from "../ui";
import {
  confirmPendingBranchAction,
  createBranchAction,
  deleteBranchAction,
  removeAppIconAction,
  rejectPendingBranchAction,
  updateAppIconAction,
  updateBranchAction,
  updateBrandingAction,
  updateCallDefaultsAction,
  updateGeneralBasicsAction,
  updateSsoAction,
} from "../actions";

export default function GeneralTab({
  community,
  tiers,
  viewer,
  confirmedBranches,
  pendingBranches,
}: {
  community: typeof communityTable.$inferSelect;
  tiers: (typeof tierTable.$inferSelect)[];
  viewer: typeof memberTable.$inferSelect;
  confirmedBranches: (typeof branchTable.$inferSelect)[];
  pendingBranches: (typeof branchTable.$inferSelect)[];
}) {
  const iconVersion = community.iconUpdatedAt?.getTime();
  const iconSrc = `/api/community/icon/32${iconVersion ? `?v=${iconVersion}` : ""}`;

  return (
    <div className="flex flex-col gap-8">
      <SettingsSection
        title="The basics"
        description="What this community is called, and the two structural switches everything else hangs off."
      >
        <SettingsGroup
          action={updateGeneralBasicsAction}
          submitLabel="Save basics"
          title="Name and structure"
        stateLabel="The community name, its time zone, whether it runs events, whether events have phases, and how dates are displayed"
          state={
            <>
              {community.name} ·{" "}
              {[
                community.cyclesEnabled ? "events on" : "no events",
                community.phasesEnabled ? "phases on" : "no phases",
                community.onsiteModeEnabled ? "on-site mode on" : "on-site mode off",
              ].join(" · ")}{" "}
              ·{" "}
              {community.timeZone ?? "UTC"}{" "}
              ·{" "}
              {community.defaultDateDisplayMode === "period"
                ? "dates read as periods"
                : "dates read exactly"}{" "}
              ·{" "}
              {community.cycleInitiationTierId
                ? `starting an event needs ${tiers.find((t) => t.id === community.cycleInitiationTierId)?.name ?? "a tier that no longer exists"}`
                : "anyone can start an event"}
            </>
          }
          description="Turning Events on gives the community dated runs with their own capacity, doors and joining windows. Turning Phases on splits each event into stages — and is a prerequisite for on-site mode."
        >
          <TextField label="Community name" name="name" defaultValue={community.name} required wide />
          <ToggleField
            label="This community runs events"
            name="cyclesEnabled"
            defaultChecked={community.cyclesEnabled}
            hint="Off means one permanent, undated run of everything. On means each event has its own dates, capacity and joining rules."
          />
          <ToggleField
            label="Events have phases"
            name="phasesEnabled"
            defaultChecked={community.phasesEnabled}
            hint="Stages within an event. Phases carry their own dates, tasks and relative milestones."
          />
          <ToggleField
            label="On-site mode"
            name="onsiteModeEnabled"
            defaultChecked={community.onsiteModeEnabled}
            disabledReason={
              community.phasesEnabled ? undefined : "Turn Phases on first — on-site mode is built on them."
            }
            hint="Locks every settings change while you're actually running the event, so nobody rewrites the rules mid-event. Turning it back off is always allowed: it's the only way out."
          />
          <SelectField
            label="How dates read by default"
            name="defaultDateDisplayMode"
            defaultValue={community.defaultDateDisplayMode}
            options={[
              { value: "exact", label: "Exact — always the real date" },
              { value: "period", label: "Period — the weekday, inside an event or phase that lasts a week or less" },
            ]}
            hint="Dates inside a short event or phase read as 'Fri' (with the event or phase name where the page doesn't already say it); everything else keeps its full date. A starting point for every member; anyone can override it for themselves."
          />
          <TimeZoneField defaultValue={community.timeZone} />
          <SelectField
            label="Starting an event needs this tier"
            name="cycleInitiationTierId"
            defaultValue={community.cycleInitiationTierId ?? ""}
            options={[
              { value: "", label: "— anyone can start an event —" },
              ...tiers.map((t) => ({ value: t.id, label: t.name })),
            ]}
            hint="Whoever meets this bar is trusted to open an event and size it. Leaving it empty means any member can."
          />
        </SettingsGroup>

        <SettingsGroup
          action={updateCallDefaultsAction}
          submitLabel="Save call defaults"
          title="What a call needs to be finished"
        stateLabel="The community-wide call defaults, which a branch can override"
          state={
            <>
              Defaults only — a branch can override each of these.{" "}
              {[
                community.defaultCallHasAgenda ? "agenda" : null,
                community.defaultCallNeedsSummary ? "summary" : null,
                community.defaultCallRequireRead ? "read confirmation" : null,
              ]
                .filter(Boolean)
                .join(" · ") || "no requirements by default"}
            </>
          }
          description="Set per call, but these are the starting values. A branch can override any of them."
        >
          <ToggleField
            label="Calls need an agenda"
            name="defaultCallHasAgenda"
            defaultChecked={community.defaultCallHasAgenda}
          />
          <ToggleField
            label="Calls need a summary afterwards"
            name="defaultCallNeedsSummary"
            defaultChecked={community.defaultCallNeedsSummary}
          />
          <ToggleField
            label="Someone has to confirm they read the summary"
            name="defaultCallRequireRead"
            defaultChecked={community.defaultCallRequireRead}
            hint="Turn this on and the summary stays on each attendee's list until they've said they read it."
          />
        </SettingsGroup>
      </SettingsSection>

      <SettingsSection
        title="Look"
        description="Colours, a logo, and the app icon. Leave the colours and logo blank and the design tokens' own defaults are used; the app icon has a built-in Orchard mark until you upload one."
      >
        <SettingsGroup
          action={updateBrandingAction}
          submitLabel="Save branding"
          title="Colours and logo"
        stateLabel="The two accent colours and the logo"
          state={
            <>
              {/* The *resolved* accent, not the raw column: a null accent is
                  not "no colour", it is the design tokens' own default, and
                  a state line reading "none" would be a lie about what the
                  app is currently showing. Same fallback the inputs use, so
                  the line matches what saving an untouched form would write. */}
              <Swatch hex={community.accentPrimary ?? "#3a6cd9"} /> primary ·{" "}
              <Swatch hex={community.accentSecondary ?? "#8c4bb0"} /> secondary ·{" "}
              {community.logoUrl ? "logo set" : "no logo — the community name is used"}
            </>
          }
          description="Hex colours, read across the whole app. A URL rather than an upload, because nothing in this codebase stores files yet."
        >
          <FieldGroup legend="Colours">
            <div className="flex flex-wrap gap-4">
              <TextField
                label="Primary"
                name="accentPrimary"
                type="color"
                defaultValue={community.accentPrimary ?? "#3a6cd9"}
                hint="Links, primary buttons, the active tab."
              />
              <TextField
                label="Secondary"
                name="accentSecondary"
                type="color"
                defaultValue={community.accentSecondary ?? "#8c4bb0"}
                hint="Used sparingly, to mark the second thing in a pair."
              />
            </div>
          </FieldGroup>
          <TextField
            label="Logo URL"
            name="logoUrl"
            defaultValue={community.logoUrl ?? ""}
            type="url"
            wide
            hint="A hosted image. Shown in the sidebar and on the sign-in page."
          />
        </SettingsGroup>

        <SettingsCard
          action={updateAppIconAction}
          submitLabel="Upload icon"
          affordance="Change"
          encType="multipart/form-data"
          title="App icon"
          stateLabel={
            community.iconFileName
              ? `App icon: ${community.iconFileName}, used for the browser tab and phone home screen`
              : "App icon: the Orchard mark is used for the browser tab and phone home screen"
          }
          state={
            <>
              <Image
                src={iconSrc}
                alt=""
                width={24}
                height={24}
                unoptimized
                className="mr-2 inline-block align-middle rounded-[var(--radius-sm)] object-cover"
              />
              {community.iconFileName ? community.iconFileName : "Orchard mark (default)"} · used for the browser tab and phone home screen
            </>
          }
          description="Upload one square PNG with a background; the browser-tab sizes, Apple touch icon, and the installable app's home-screen icon are generated from it. Use a square image at least 64×64, ideally 512×512 or larger."
          aside={
            community.iconUpdatedAt ? (
              <form action={removeAppIconAction}>
                <SubmitButton className={BUTTON_SECONDARY}>Remove uploaded icon</SubmitButton>
              </form>
            ) : undefined
          }
        >
          <SettingsField
            label="PNG file"
            hint="A square PNG. The other sizes are generated automatically and stored with the community."
          >
            <input
              type="file"
              name="icon"
              accept={COMMUNITY_ICON_ACCEPT}
              required
              className={`${INPUT} disabled:cursor-not-allowed disabled:opacity-60`}
            />
          </SettingsField>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title="Signing in"
        description="Orchard always has magic-link sign-in. Single sign-on is a second way in, not a replacement — leaving all three fields empty means magic-link only."
      >
        <SettingsGroup
          action={updateSsoAction}
          submitLabel="Save sign-in settings"
          title="Single sign-on (OIDC)"
        stateLabel="Whether single sign-on is configured, which provider, and whether it is the main way in"
          state={
            community.oidcIssuerUrl ? (
              <>
                Configured via {hostOf(community.oidcIssuerUrl)}
                {community.oidcPrimary ? " · the main way in" : " · offered alongside magic-link"}
                {community.oidcRequiredRole ? ` · accounts need the ${community.oidcRequiredRole} role` : " · any account from that provider is allowed"}
              </>
            ) : (
              "Not configured — everyone signs in with a magic link"
            )
          }
          description="A second identity provider. The client secret lives in the environment, never here, and never leaves the server."
        >
          <TextField
            label="Issuer URL"
            name="oidcIssuerUrl"
            defaultValue={community.oidcIssuerUrl ?? ""}
            type="url"
            wide
            hint="Your provider's issuer, e.g. https://id.example.com"
          />
          <TextField label="Client ID" name="oidcClientId" defaultValue={community.oidcClientId ?? ""} wide />
          <TextField
            label="Required role"
            name="oidcRequiredRole"
            defaultValue={community.oidcRequiredRole ?? ""}
            wide
            hint="The role a token has to carry before an account can be created at all. Empty means any signed-in person from that provider can make an account."
          />
          <ToggleField
            label="Treat single sign-on as the main way in"
            name="oidcPrimary"
            defaultChecked={community.oidcPrimary}
            disabledReason={
              community.oidcIssuerUrl ? undefined : "Configure an issuer URL first — this only means something once OIDC is set up."
            }
            hint="On, the sign-in page goes straight to your provider and magic-link stops originating new accounts. Off, both are offered as equals — useful while you're migrating."
          />
        </SettingsGroup>
        <SignInAccounts community={community} viewer={viewer} />
      </SettingsSection>
      {pendingBranches.length > 0 && (
        <SettingsSection
          title="Waiting on a decision"
          description="A Task Pack import created these from someone who didn't hold Admins at the time. The tasks are already attached and claimable; confirming locks the branch in, rejecting re-points them at a real one instead."
        >
          <div className="flex flex-col gap-2">
            {pendingBranches.map((b) => (
              <div
                key={b.id}
                className="rounded-[var(--radius-md)] p-3"
                style={{ background: "var(--warning-soft)", border: "1px solid var(--warning-border)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[length:var(--text-body)] font-medium text-[var(--text)]">{b.name}</span>
                  <Tag tone="warning">pending</Tag>
                </div>
                {b.description && (
                  <p className="mt-1 text-[length:var(--text-body)] text-[var(--text-muted)]">{b.description}</p>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <form action={confirmPendingBranchAction}>
                    <input type="hidden" name="branchId" value={b.id} />
                    <button type="submit" className={BUTTON_PRIMARY}>
                      Confirm
                    </button>
                  </form>
                  <form action={rejectPendingBranchAction} className="flex items-center gap-2">
                    <input type="hidden" name="branchId" value={b.id} />
                    <label className="flex flex-col gap-1">
                      <span className={LABEL}>Or reassign its tasks to</span>
                      <select name="reassignToBranchId" required defaultValue="" className={INPUT}>
                        <option value="" disabled>
                          — pick a branch —
                        </option>
                        {confirmedBranches.map((cb) => (
                          <option key={cb.id} value={cb.id}>
                            {cb.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className={BUTTON_SECONDARY}>
                      Reject
                    </button>
                  </form>
                </div>
              </div>
            ))}
          </div>
        </SettingsSection>
      )}

      <SettingsSection
        title="Branches"
        description="Every task, shift, call and poll belongs to a branch. Branches are how a community splits its own work up without splitting itself in two — and why one can't be deleted out from under the tasks already in it."
      >
        {confirmedBranches.length === 0 && (
          <SettingsPanel>
            <p className="text-[length:var(--text-body)] text-[var(--text-muted)]">
              No branches yet. A community with none can&rsquo;t hold a task, so this is the first
              thing to set up.
            </p>
          </SettingsPanel>
        )}

        {confirmedBranches.map((b) => (
          <SettingsCard
            key={b.id}
            action={updateBranchAction}
            submitLabel="Save branch"
            title={b.name}
            stateLabel={`${b.name}, a branch. Its description and its call defaults`}
            state={
              <>
                {b.description?.trim() || "No description yet."}{" "}
                {b.defaultCallHasAgenda === null &&
                b.defaultCallNeedsSummary === null &&
                b.defaultCallRequireRead === null ? (
                  <>Calls use the community defaults.</>
                ) : (
                  <>
                    Calls here need{" "}
                    {[
                      b.defaultCallHasAgenda === true ? "an agenda" : b.defaultCallHasAgenda === false ? "no agenda" : null,
                      b.defaultCallNeedsSummary === true ? "a summary" : b.defaultCallNeedsSummary === false ? "no summary" : null,
                      b.defaultCallRequireRead === true ? "read confirmation" : b.defaultCallRequireRead === false ? "no read confirmation" : null,
                    ]
                      .filter(Boolean)
                      .join(", ") || "nothing beyond the community default"}
                    .
                  </>
                )}
              </>
            }
            aside={
              <form action={deleteBranchAction}>
                <input type="hidden" name="branchId" value={b.id} />
                <button type="submit" className={BUTTON_SECONDARY}>
                  Delete
                </button>
              </form>
            }
          >
            <input type="hidden" name="branchId" value={b.id} />
            <TextField label="Name" name="name" defaultValue={b.name} required />
            <TextAreaish
              label="What this branch is for"
              name="description"
              defaultValue={b.description ?? ""}
            />
            <SelectField
              label="Calls need an agenda"
              name="defaultCallHasAgenda"
              defaultValue={triState(b.defaultCallHasAgenda)}
              options={TRISTATE_OPTIONS}
            />
            <SelectField
              label="Calls need a summary"
              name="defaultCallNeedsSummary"
              defaultValue={triState(b.defaultCallNeedsSummary)}
              options={TRISTATE_OPTIONS}
            />
            <SelectField
              label="Summaries need reading"
              name="defaultCallRequireRead"
              defaultValue={triState(b.defaultCallRequireRead)}
              options={TRISTATE_OPTIONS}
            />
          </SettingsCard>
        ))}

        <SettingsCard
          action={createBranchAction}
          submitLabel="Create branch"
          title="Add a branch"
          affordance="Create"
          description="One sentence on what it's for is enough. Everything else is filled in later."
        >
          <TextField label="Name" name="name" required />
          <TextAreaish label="What it's for" name="description" />
        </SettingsCard>
      </SettingsSection>
    </div>
  );
}


/** The colour as a chip, so the state line answers "what does the app look
 *  like" without the reader having to interpret a hex string. */
function Swatch({ hex }: { hex: string }) {
  return (
    <span
      className="mr-1 inline-block h-2.5 w-2.5 align-middle rounded-[2px] border border-[var(--border)]"
      style={{ backgroundColor: hex }}
      aria-hidden
    />
  );
}

/** The host of an issuer URL, because "configured via
 *  https://id.example.com/realms/main" is a configuration detail and
 *  "configured via id.example.com" is the thing you'd recognise. Falls back
 *  to the raw string rather than to nothing, since a hand-edited value that
 *  isn't a URL should still be visible here rather than silently blank. */
function hostOf(issuerUrl: string): string {
  try {
    return new URL(issuerUrl).host;
  } catch {
    return issuerUrl;
  }
}
function TextAreaish({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: string;
}) {
  return (
    <label className="flex max-w-[420px] flex-col gap-1">
      <span className={LABEL}>{label}</span>
      <textarea name={name} rows={2} defaultValue={defaultValue} className={`${INPUT} disabled:opacity-60`} />
    </label>
  );
}

const TRISTATE_OPTIONS = [
  { value: "inherit", label: "Use the community's default" },
  { value: "on", label: "Always required here" },
  { value: "off", label: "Never required here" },
];

function triState(value: boolean | null) {
  return value === null ? "inherit" : value ? "on" : "off";
}

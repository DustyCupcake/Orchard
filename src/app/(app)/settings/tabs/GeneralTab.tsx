import type { community as communityTable, tier as tierTable } from "@/db/schema";
import {
  FieldGroup,
  SelectField,
  SettingsGroup,
  SettingsSection,
  TextField,
  ToggleField,
} from "../ui";
import {
  updateBrandingAction,
  updateCallDefaultsAction,
  updateGeneralBasicsAction,
  updateSsoAction,
} from "../actions";

export default function GeneralTab({  community,
  tiers,
}: {
  community: typeof communityTable.$inferSelect;
  tiers: (typeof tierTable.$inferSelect)[];
}) {
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
        stateLabel="The community name, whether it runs events, whether events have phases, and how dates are displayed"
          state={
            <>
              {community.name} ·{" "}
              {[
                community.cyclesEnabled ? "events on" : "no events",
                community.phasesEnabled ? "phases on" : "no phases",
                community.onsiteModeEnabled ? "on-site mode on" : "on-site mode off",
              ].join(" · ")}{" "}
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
              { value: "period", label: "Period — 'the 12th to the 19th' where a period is what the member chose" },
            ]}
            hint="A starting point for every member; anyone can override it for themselves."
          />
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
        description="Colours and a logo. Leave them blank and the design tokens' own defaults are used."
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

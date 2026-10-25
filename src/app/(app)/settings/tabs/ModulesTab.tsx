import Link from "next/link";
import type { community as communityTable, form as formTable, KitchenSignal } from "@/db/schema";
import { Banner } from "@/components/ui/kit";
import { MODULE_DEFINITIONS } from "@/lib/modules";
import { SelectField, SettingsGroup, SettingsSection, ToggleField } from "../ui";
import { updateBudgetSettingsAction, updateModulesSettingsAction, updatePostCycleFeedbackAction } from "../actions";
import PerBackerField from "./PerBackerField";

// A short, honest line per module: what turns off when you untick it.
// The old tab was a bare list of checkboxes with no consequences stated,
// which made "is this one important?" a question only the person who
// wrote the module could answer.
const MODULE_CONSEQUENCE: Record<string, string> = {
  sensitive_data: "The sensitive-fields layer. Turning it off doesn't un-mark anything you've already marked sensitive — it stops the access rules from being enforced.",
  budget: "Each event's budget, the community's own, and the proposals in them. Data stays; the pages go.",
  event_scheduling: "Event proposals, review and the published Programme.",
  shifts: "Shift series, sign-ups and confirmations.",
  recruitment: "Invites, applications, the pipeline and mediation. Turn this off and the Recruitment tab below stops mattering.",
  spatial_planning: "Plots, zones, placements and the collaboration surface.",
  kitchen: "Menus, dishes and the food-ideas inbox.",
};

export default function ModulesTab({
  community,
  forms,
  unwiredKitchenSignals,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
  // The Kitchen signals with no question behind them — empty when Kitchen is
  // off, or when all three are set up. Non-empty is the prompt below.
  unwiredKitchenSignals: KitchenSignal[];
}) {
  return (
    <div className="flex flex-col gap-8">
      {unwiredKitchenSignals.length > 0 && (
        <Banner tone="warning">
          The Kitchen is on, but {unwiredKitchenSignals.length === 3 ? "none" : `${3 - unwiredKitchenSignals.length} of 3`}{" "}
          of its dietary questions are set up, so the kitchen can&rsquo;t see anyone&rsquo;s allergies, intolerances or
          dislikes yet.{" "}
          <Link href="/settings?tab=profile-privacy#kitchen-questions" className="font-medium underline">
            Set them up
          </Link>
        </Banner>
      )}

      <SettingsSection
        title="What's switched on"
        description="Each of these is a whole area of the app. Nothing here is on by default except what you see ticked — a community that turns everything on is opting into maintaining all of it."
      >
        <SettingsGroup
          action={updateModulesSettingsAction}
          submitLabel="Save modules"
          title="Modules"
        stateLabel="Which modules are switched on"
          state={
            community.modulesEnabled.length === 0
              ? "None switched on — Orchard is running as a task board and nothing else"
              : `${community.modulesEnabled.length} of ${MODULE_DEFINITIONS.length} on: ${MODULE_DEFINITIONS.filter((m) => community.modulesEnabled.includes(m.key)).map((m) => m.label).join(", ")}`
          }
          description="Untick to hide a module's pages. Existing records stay exactly where they are and come back if you retick."
        >
          {MODULE_DEFINITIONS.map((m) => (
            <ToggleField
              key={m.key}
              label={m.label}
              name="modulesEnabled"
              value={m.key}
              defaultChecked={community.modulesEnabled.includes(m.key)}
              hint={MODULE_CONSEQUENCE[m.key]}
            />
          ))}
        </SettingsGroup>
      </SettingsSection>

      {community.modulesEnabled.includes("budget") && (
        <SettingsSection
          title="Budget"
          description="Anyone can propose spending, in an event's budget or in the community's own, and other members back it. The budget's owner approves what has been backed."
        >
          <SettingsGroup
            action={updateBudgetSettingsAction}
            submitLabel="Save budget settings"
            title="How much backing a proposal needs"
            stateLabel="How much money each person behind a budget proposal stands behind"
            state={
              community.fundSupportPerBacker
                ? `Each person behind a proposal stands behind ${community.fundSupportPerBacker}`
                : "Not set — a budget's owner decides alone, and nothing needs backing"
            }
            description="A proposal for more than its backers cover can't be approved for the excess. Applies to every budget, events' and the community's."
          >
            <PerBackerField defaultValue={community.fundSupportPerBacker} />
          </SettingsGroup>
        </SettingsSection>
      )}

      <SettingsSection
        title="After an event"
        description="One standing question, asked once an event is over, of everyone in it."
      >
        <SettingsGroup
          action={updatePostCycleFeedbackAction}
          submitLabel="Save feedback form"
          title="The feedback ask"
        stateLabel="Which form is sent after every event"
          state={
            forms.find((f) => f.id === community.postCycleFeedbackFormId)
              ? `Sent after every event: "${forms.find((f) => f.id === community.postCycleFeedbackFormId)!.title}"`
              : "No form chosen — nobody is asked anything after an event"
          }
          description="Which form to send out once an event closes. Without one there's no ask at all — the platform has no default question to put to anybody."
        >
          <SelectField
            label="Feedback form"
            name="postCycleFeedbackFormId"
            defaultValue={community.postCycleFeedbackFormId ?? ""}
            wide
            options={[
              { value: "", label: "— none —" },
              ...forms
                .filter((f) => !f.archivedAt)
                .map((f) => ({ value: f.id, label: f.title })),
            ]}
            hint="Build it under the Forms tab. Who reviews the answers is a permission, not a setting — see Access & permissions."
          />
        </SettingsGroup>
      </SettingsSection>
    </div>
  );
}

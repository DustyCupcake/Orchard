import type { community as communityTable, form as formTable, KitchenSignal } from "@/db/schema";
import CoordinationTab from "./CoordinationTab";
import ModulesTab from "./ModulesTab";

// The two "operational" tabs — coordination (deadlines, response
// tracking, indicators) and modules (what's switched on, budget,
// post-event feedback) — are both about how the community's machinery
// runs, so they share a tab.
export default function OperationsTab({
  community,
  forms,
  unwiredKitchenSignals,
}: {
  community: typeof communityTable.$inferSelect;
  forms: (typeof formTable.$inferSelect)[];
  unwiredKitchenSignals: KitchenSignal[];
}) {
  return (
    <div className="flex flex-col gap-8">
      <CoordinationTab community={community} />
      <ModulesTab community={community} forms={forms} unwiredKitchenSignals={unwiredKitchenSignals} />
    </div>
  );
}

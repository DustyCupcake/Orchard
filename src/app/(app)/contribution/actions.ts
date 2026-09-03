"use server";

import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { updateContributionVisibility } from "@/lib/contribution";

// Phase 54 (View-as): every write in this file goes through
// requireMember() below rather than the raw @/lib/api import
// directly, so a session actively rendering as someone else can
// never perform one -- "disabled at the UI layer [...] and
// re-checked/rejected server-side regardless." See src/lib/view-as.ts.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export async function setContributionVisibleAction(formData: FormData) {
  const actor = await requireMember();
  const visible = formData.get("visible") === "true";

  await updateContributionVisibility(actor, { visible });
  revalidatePath("/contribution");
}

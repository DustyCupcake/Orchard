"use server";

import { revalidatePath } from "next/cache";
import { requireMember } from "@/lib/api";
import { updateContributionVisibility } from "@/lib/contribution";

export async function setContributionVisibleAction(formData: FormData) {
  const actor = await requireMember();
  const visible = formData.get("visible") === "true";

  await updateContributionVisibility(actor, { visible });
  revalidatePath("/contribution");
}

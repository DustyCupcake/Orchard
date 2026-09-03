"use server";

import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { commitPackImport, type CommitPackImportInput } from "@/lib/task-packs";
import { AppError } from "@/lib/errors";
import { encodeImportState, decodeImportState, type StagedImportState } from "./state";

// Phase 54 (View-as) — see participation/actions.ts's identical comment.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

function redirectWithError(packId: string, err: unknown): never {
  if (err instanceof AppError) {
    redirect(`/task-packs/import/${packId}?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

// Screen one's submit — see docs/spec.md's "Pack import review." If
// nothing was declined, this commits immediately; a decline routes to
// screen two (the per-task reassignment view) instead, carrying every
// already-decided resolution forward through the URL rather than
// committing anything yet — "nothing is created until the whole flow
// is confirmed."
export async function reviewPackImportAction(formData: FormData) {
  const actor = await requireMember();
  const packId = String(formData.get("packId"));
  const cycleName = String(formData.get("cycleName") ?? "").trim();
  const cycleTypeId = String(formData.get("cycleTypeId") ?? "").trim() || null;
  const hints = JSON.parse(String(formData.get("hints") ?? "[]")) as string[];

  const resolvedHints: StagedImportState["resolvedHints"] = {};
  const declinedHints: string[] = [];
  for (const hint of hints) {
    const value = String(formData.get(`resolution__${hint}`) ?? "");
    if (value === "__decline__") {
      declinedHints.push(hint);
    } else if (value === "__create_new__") {
      resolvedHints[hint] = { action: "create_new" };
    } else if (value) {
      resolvedHints[hint] = { action: "use_existing", branchId: value };
    }
  }

  if (declinedHints.length === 0) {
    try {
      await commitPackImport(actor, { packId, cycleName, cycleTypeId, hintResolutions: resolvedHints });
    } catch (err) {
      redirectWithError(packId, err);
    }
    redirect("/participation?cycleCreated=1");
  }

  const state = encodeImportState({ cycleName, cycleTypeId, resolvedHints, declinedHints });
  redirect(`/task-packs/import/${packId}?stage=reassign&state=${encodeURIComponent(state)}`);
}

// Screen two's submit, only ever reached after a decline — every
// previously-declined item now needs a real, existing branch (no
// "create new"/"decline" here, per spec: "each needing a real existing
// branch picked before the import can commit").
export async function finalizePackImportAction(formData: FormData) {
  const actor = await requireMember();
  const packId = String(formData.get("packId"));
  const stateRaw = String(formData.get("state") ?? "");
  const declinedItemIds = JSON.parse(String(formData.get("declinedItemIds") ?? "[]")) as string[];

  const state = decodeImportState(stateRaw);
  if (!state) {
    redirect(`/task-packs/import/${packId}?error=${encodeURIComponent("That review session expired — start over")}`);
  }

  const itemBranchOverrides: Record<string, string> = {};
  for (const itemId of declinedItemIds) {
    const branchId = String(formData.get(`itemBranch__${itemId}`) ?? "");
    if (branchId) itemBranchOverrides[itemId] = branchId;
  }

  const input: CommitPackImportInput = {
    packId,
    cycleName: state.cycleName,
    cycleTypeId: state.cycleTypeId,
    hintResolutions: state.resolvedHints,
    itemBranchOverrides,
  };

  try {
    await commitPackImport(actor, input);
  } catch (err) {
    redirectWithError(packId, err);
  }

  redirect("/participation?cycleCreated=1");
}

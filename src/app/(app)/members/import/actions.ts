"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import { requireAdmins } from "@/lib/settings/admins";
import {
  commitBulkMemberImport,
  parseBulkMemberRows,
  previewBulkMemberImport,
} from "@/lib/settings/bulk-members";
import { decodeBulkMemberState, encodeBulkMemberState } from "./state";

// The two steps of the roster import, moved here from src/app/(app)/settings/
// actions.ts. They are unchanged in behaviour — same two-step review/confirm,
// same re-check of claimed emails at commit time, same base64url state in
// the URL — and only the tab they redirect to has changed. See
// ../page.tsx for why an action rather than a setting.

function fail(message: string): never {
  redirect(`/members/import?error=${encodeURIComponent(message)}`);
}

// View-as (Phase 54): a session rendering as someone else must never be
// able to import members. Same wrapper src/app/(app)/settings/actions.ts uses
// for its own writes, and for the same reason — the UI hides the link from
// a viewing session, and this is what makes that hiding a real gate rather
// than a courtesy.
async function requireMember() {
  const actor = await requireRealMember();
  await assertNotViewingAs();
  return actor;
}

export async function reviewBulkMemberImportAction(formData: FormData) {
  const actor = await requireMember();
  const file = formData.get("file");
  const pastedText = String(formData.get("pastedText") ?? "");

  let state: string;
  try {
    await requireAdmins(actor);
    const raw = file instanceof File && file.size > 0 ? await file.text() : pastedText;
    const { rows, malformedLines } = parseBulkMemberRows(raw);
    const { newRows, alreadyExistsRows } = await previewBulkMemberImport(actor, rows);
    state = encodeBulkMemberState({ newRows, alreadyExistsRows, malformedLines });
  } catch (err) {
    fail(err instanceof Error ? err.message : "That import could not be read");
  }

  redirect(`/members/import?bulkStage=review&bulkState=${encodeURIComponent(state)}`);
}

// Only ever reached from the review screen above, decoding exactly the rows
// it already showed rather than re-parsing raw text a second time.
// commitBulkMemberImport re-checks for an already-claimed email itself
// (defense in depth, same as every other two-step confirm flow here) in
// case something changed between review and confirm.
export async function confirmBulkMemberImportAction(formData: FormData) {
  const actor = await requireMember();
  const stateRaw = String(formData.get("state") ?? "");

  const state = decodeBulkMemberState(stateRaw);
  if (!state) {
    fail("That review expired — start over");
  }

  let created: number;
  try {
    await requireAdmins(actor);
    ({ created } = await commitBulkMemberImport(actor, state.newRows));
  } catch (err) {
    fail(err instanceof Error ? err.message : "That import could not be completed");
  }

  revalidatePath("/members");
  redirect(`/members/import?bulkAdded=${created}`);
}

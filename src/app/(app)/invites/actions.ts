"use server";

import { ZodError } from "zod";
import { eventInstantFromLocal } from "@/lib/cycles";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMember as requireRealMember } from "@/lib/api";
import { assertNotViewingAs } from "@/lib/view-as";
import {
  claimInquiry,
  createCommunityInvite,
  createCommunityInviteInput,
  getInviteFollowUp,
  resolveInquiry,
  revokeCommunityInvite,
} from "@/lib/recruitment";
import { pokeMembersForSupport } from "@/lib/recruitment/pairs";
import { getCommunity } from "@/lib/settings";
import { resolveAppUrlFromHeaders } from "@/lib/app-url";
import { AppError, ForbiddenError, NotFoundError } from "@/lib/errors";

function redirectWithError(err: unknown): never {
  if (err instanceof ZodError) {
    redirect(`/invites?error=${encodeURIComponent(err.issues[0]?.message ?? "Invalid input")}`);
  }
  if (err instanceof AppError) {
    redirect(`/invites?error=${encodeURIComponent(err.message)}`);
  }
  throw err;
}

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

export async function createCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();
  let created;

  try {
    // Typed on the clock of the event the invite is for, else the
    // community's — not the server's.
    const inviteCycleId = String(formData.get("cycleId") ?? "").trim() || null;
    const expiresRaw = String(formData.get("expiresAt") ?? "").trim();
    const input = createCommunityInviteInput.parse({
      label: String(formData.get("label") ?? "").trim() || null,
      inviterThinksGoodFit: formData.get("inviterThinksGoodFit") === "on",
      inviterKnowsPersonally: formData.get("inviterKnowsPersonally") === "on",
      // §2.6/J10 — the inviter's own awareness tick, mandatory on a
      // consensus lane (createCommunityInvite refuses without it) and
      // simply absent anywhere else.
      awarenessConfirmed: formData.get("awarenessConfirmed") === "on",
      cycleId: String(formData.get("cycleId") ?? "").trim() || null,
      expiresAt: expiresRaw ? await eventInstantFromLocal(actor.communityId, inviteCycleId, expiresRaw) : null,
    });
    created = await createCommunityInvite(actor, input);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  // A nomination needs its support link shown straight away — the whole
  // of §2.4's poke option is that the inviter can hand it over or ask
  // specific people *now*, while they still remember who.
  redirect(created ? `/invites?created=1&invite=${created.id}` : "/invites?created=1");
}

// §2.4's poke: the inviter names the members they think also know the
// invitee, and each of them gets their own email with the support link.
// Deliberately one email per person and never a broadcast — "nothing
// broadcasts the nominee's existence beyond who the inviter chose" is the
// plan's exact wording, and a BCC would break it in the one place it
// matters.
export async function pokeForSupportAction(formData: FormData) {
  const actor = await requireMember();
  const inviteId = String(formData.get("inviteId") ?? "");
  const memberIds = formData.getAll("pokeMemberId").map(String).filter(Boolean);
  const appUrl = await resolveAppUrlFromHeaders();

  try {
    const followUp = await getInviteFollowUp(inviteId);
    if (!followUp) {
      throw new NotFoundError("Invite not found");
    }
    if (followUp.invite.createdBy !== actor.id) {
      throw new ForbiddenError("Only the member who sent this invite can ask others to support it");
    }
    if (!followUp.supportToken) {
      throw new AppError("This invite isn't waiting on anybody's support");
    }
    const communityRow = await getCommunity(actor);
    const { poked } = await pokeMembersForSupport({
      communityId: actor.communityId,
      communityName: communityRow.name,
      askerId: actor.id,
      askerName: actor.name,
      nomineeLabel: followUp.invite.label,
      supportUrl: `${appUrl}/support/${followUp.supportToken}`,
      windowHours: communityRow.recruitmentNominationWindowHours,
      memberIds,
    });
    if (poked.length === 0) {
      throw new AppError("Nobody was asked — pick at least one person, and check they have an email on file");
    }
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect(`/invites?poked=1&invite=${encodeURIComponent(inviteId)}`);
}

export async function revokeCommunityInviteAction(formData: FormData) {
  const actor = await requireMember();
  const inviteId = String(formData.get("inviteId"));

  try {
    await revokeCommunityInvite(actor, inviteId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?revoked=1");
}

// Recruitment-task-holder-gated, enforced inside claimInquiry.
export async function claimInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await claimInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?claimed=1");
}

export async function resolveInquiryAction(formData: FormData) {
  const actor = await requireMember();
  const inquiryId = String(formData.get("inquiryId"));

  try {
    await resolveInquiry(actor, inquiryId);
  } catch (err) {
    redirectWithError(err);
  }

  revalidatePath("/invites");
  redirect("/invites?inquiryResolved=1");
}

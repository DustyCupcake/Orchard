"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireMember } from "@/lib/api";
import { resolveViewScopeFromSegment } from "@/lib/cycles";
import { assertNotViewingAs } from "@/lib/view-as";

// The confirm-switch button on an object-detail page's cross-cycle-
// boundary banner (docs/development-plan.md's Phase 66) — a plain
// <form>-friendly counterpart to nav-actions.ts's setViewScopeAction
// (built for a client component's direct call, which a server-
// rendered task/wiki page isn't). Same invariant either way: a shared
// link's own "?scope=" carries no weight on its own — only an
// explicit click here ever moves Member.lastViewedCycleId, after the
// visitor's actually seen which two scopes disagree.
export async function switchToLinkedScopeAction(formData: FormData) {
  const actor = await requireMember();
  await assertNotViewingAs();

  const scope = String(formData.get("scope") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");

  let cycleId: string | null = null;
  if (scope !== "active") {
    const resolved = await resolveViewScopeFromSegment(actor, scope);
    if (!resolved || resolved.kind !== "single") redirect(returnTo);
    cycleId = resolved.cycle.id;
  }

  await db.update(member).set({ lastViewedCycleId: cycleId }).where(eq(member.id, actor.id));
  redirect(returnTo);
}

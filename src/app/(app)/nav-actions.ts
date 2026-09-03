"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireMember } from "@/lib/api";
import { assertNotViewingAs, deactivateViewAs } from "@/lib/view-as";

// Manual "pin this for me" toggle — called directly from AppShell.tsx
// (a client component) rather than through a <form action>, since it's
// a small icon-button click inside a list, not a page-level form. No
// authorization gate beyond being a member: pinning is a personal nav
// preference, not access to anything. AppShell already hides the pin
// button while View-as is active (it would otherwise silently write to
// the *real* member's pins while the sidebar shows the viewed member's
// state — see AppShell.tsx's own comment); assertNotViewingAs is the
// server-side backstop, same as every other write this phase touches.
// Deliberately NOT applied to endViewAsAction below, which has to keep
// working precisely while View-as is active.
export async function toggleFavoriteNavItem(itemKey: string) {
  const actor = await requireMember();
  await assertNotViewingAs();
  const current = actor.pinnedModuleKeys;
  const next = current.includes(itemKey) ? current.filter((k) => k !== itemKey) : [...current, itemKey];

  await db.update(member).set({ pinnedModuleKeys: next }).where(eq(member.id, actor.id));
  revalidatePath("/", "layout");
}

// The persistent banner's "End View-as" button — called directly from
// AppShell.tsx, same client-component-invoked-Server-Action pattern as
// toggleFavoriteNavItem above. requireMember() resolves the *real*
// session member (see src/lib/session.ts's getCurrentMember — never
// swapped by an active View-as overlay), so this always ends the real
// session's own overlay regardless of who it's currently rendering as.
export async function endViewAsAction() {
  const actor = await requireMember();
  await deactivateViewAs(actor);
  revalidatePath("/", "layout");
}

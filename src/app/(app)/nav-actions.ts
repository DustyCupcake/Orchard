"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/schema";
import { requireMember } from "@/lib/api";

// Manual "pin this for me" toggle — called directly from AppShell.tsx
// (a client component) rather than through a <form action>, since it's
// a small icon-button click inside a list, not a page-level form. No
// authorization gate beyond being a member: pinning is a personal nav
// preference, not access to anything.
export async function toggleFavoriteNavItem(itemKey: string) {
  const actor = await requireMember();
  const current = actor.pinnedModuleKeys;
  const next = current.includes(itemKey) ? current.filter((k) => k !== itemKey) : [...current, itemKey];

  await db.update(member).set({ pinnedModuleKeys: next }).where(eq(member.id, actor.id));
  revalidatePath("/", "layout");
}

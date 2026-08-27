"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";

export async function updateProfile(formData: FormData) {
  const current = await getCurrentMember();
  if (!current) {
    redirect("/login");
  }

  const name = String(formData.get("name") ?? "").trim();
  const tags = String(formData.get("tags") ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const tierIds = formData.getAll("tierIds").map(String);

  if (!name) {
    return;
  }

  await db.update(member).set({ name, tags, tierIds }).where(eq(member.id, current.id));
  revalidatePath("/profile");
}

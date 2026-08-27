import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { tier } from "@/db/schema";
import { getCurrentMember } from "@/lib/session";
import { updateProfile } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const communityTiers = await db
    .select()
    .from(tier)
    .where(eq(tier.communityId, currentMember.communityId));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Your profile</h1>
      <form action={updateProfile} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Name
          <br />
          <input
            type="text"
            name="name"
            defaultValue={currentMember.name}
            required
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <label>
          Tags (comma-separated)
          <br />
          <input
            type="text"
            name="tags"
            defaultValue={currentMember.tags.join(", ")}
            placeholder="carpentry, spanish, night-owl"
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        {communityTiers.length > 0 && (
          <fieldset>
            <legend>Tiers (manual assignment for now)</legend>
            {communityTiers.map((t) => (
              <label key={t.id} style={{ display: "block" }}>
                <input
                  type="checkbox"
                  name="tierIds"
                  value={t.id}
                  defaultChecked={currentMember.tierIds.includes(t.id)}
                />{" "}
                {t.name}
              </label>
            ))}
          </fieldset>
        )}

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Save
        </button>
      </form>

      <form action="/api/auth/logout" method="post" style={{ marginTop: "2rem" }}>
        <button type="submit">Log out</button>
      </form>
    </main>
  );
}

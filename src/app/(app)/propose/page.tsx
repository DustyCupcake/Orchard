import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { member } from "@/db/schema";
import { getViewingContext } from "@/lib/view-as";
import { submitProposal } from "./actions";

export const dynamic = "force-dynamic";

export default async function ProposePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  const communityMembers = await db
    .select()
    .from(member)
    .where(eq(member.communityId, viewing.communityId));

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 520 }}>
      <h1>Propose a task</h1>
      <p style={{ color: "#666" }}>
        Just a title and a rough description is enough — no need to know its branch, tags, or
        criticality. Whoever does branch coordination will fill that in when they review it.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form
        action={submitProposal}
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        <label>
          Title
          <br />
          <input type="text" name="title" required style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          Description (optional, rough is fine)
          <br />
          <textarea name="description" rows={4} style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          <input type="checkbox" name="wantsToClaim" /> I&rsquo;d like to claim this myself
        </label>

        <fieldset>
          <legend>I&rsquo;d suggest this person (optional)</legend>
          <select name="suggestedMemberId" defaultValue="" style={{ padding: "0.5rem" }}>
            <option value="">— nobody in particular —</option>
            {communityMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <br />
          <input
            type="text"
            name="suggestedMemberNote"
            placeholder="why they'd be a good fit (optional)"
            style={{ padding: "0.5rem", width: "100%", marginTop: "0.5rem" }}
          />
        </fieldset>

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Submit proposal
        </button>
      </form>
    </main>
  );
}

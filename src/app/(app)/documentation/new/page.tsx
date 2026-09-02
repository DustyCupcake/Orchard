import { redirect } from "next/navigation";
import { getCurrentMember } from "@/lib/session";
import { listBranches } from "@/lib/settings";
import { createWikiPageAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewWikiPagePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const currentMember = await getCurrentMember();
  if (!currentMember) {
    redirect("/login");
  }

  const { error } = await searchParams;
  const branches = await listBranches(currentMember);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 520 }}>
      <h1>New page</h1>
      <p style={{ color: "#666" }}>
        Leave the content blank to post it as an open question instead — it&rsquo;ll sit flagged
        as unanswered until someone fills one in.
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form
        action={createWikiPageAction}
        style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
      >
        <label>
          Title (or the question, if you don&rsquo;t have an answer yet)
          <br />
          <input type="text" name="title" required style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          Branch (optional — leave unset for general/platform knowledge)
          <br />
          <select name="branchId" defaultValue="" style={{ padding: "0.5rem", width: "100%" }}>
            <option value="">General</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Content (optional)
          <br />
          <textarea name="content" rows={6} style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Create page
        </button>
      </form>
    </main>
  );
}

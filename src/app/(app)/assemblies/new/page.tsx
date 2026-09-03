import { redirect } from "next/navigation";
import { getViewingContext } from "@/lib/view-as";
import { proposeAssemblyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function NewAssemblyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { real, viewing } = await getViewingContext();
  if (!real || !viewing) {
    redirect("/login");
  }

  const { error } = await searchParams;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 520 }}>
      <h1>Propose an Assembly</h1>
      <p style={{ color: "#666" }}>
        Every duration is yours to set — compress agenda and notice to nearly nothing for
        something urgent, or give a slow, structural question real time to breathe. All three
        durations are in minutes (60 = 1 hour, 1440 = 1 day, 10080 = 1 week).
      </p>

      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <form action={proposeAssemblyAction} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <label>
          Title
          <br />
          <input type="text" name="title" required style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          Description (optional)
          <br />
          <textarea name="description" rows={4} style={{ padding: "0.5rem", width: "100%" }} />
        </label>

        <label>
          Agenda-building window (minutes)
          <br />
          <input
            type="number"
            name="agendaMinutes"
            min={0}
            required
            defaultValue={1440}
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <label>
          Notice window (minutes) — agenda locked and visible, voting not open yet
          <br />
          <input
            type="number"
            name="noticeMinutes"
            min={0}
            required
            defaultValue={1440}
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <label>
          Voting window (minutes)
          <br />
          <input
            type="number"
            name="votingMinutes"
            min={1}
            required
            defaultValue={4320}
            style={{ padding: "0.5rem", width: "100%" }}
          />
        </label>

        <button type="submit" style={{ padding: "0.5rem 1rem", width: "fit-content" }}>
          Propose
        </button>
      </form>
    </main>
  );
}

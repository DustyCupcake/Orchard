import Link from "next/link";

export default function Nav({ memberName }: { memberName: string }) {
  return (
    <nav
      style={{
        display: "flex",
        alignItems: "center",
        gap: "1rem",
        marginBottom: "2rem",
        paddingBottom: "1rem",
        borderBottom: "1px solid #ccc",
      }}
    >
      <Link href="/dashboard">Dashboard</Link>
      <Link href="/board">Board</Link>
      <Link href="/propose">Propose a task</Link>
      <Link href="/proposals">Proposals</Link>
      <Link href="/escalation">Escalation</Link>
      <Link href="/coordination">Coordination</Link>
      <Link href="/input-rounds">Input round</Link>
      <Link href="/assemblies">Assemblies</Link>
      <Link href="/scheduling-polls">Scheduling</Link>
      <Link href="/documentation">Documentation</Link>
      <Link href="/conflict-reports">Conflict</Link>
      <Link href="/sensitive-data">Sensitive data</Link>
      <Link href="/budget">Budget</Link>
      <Link href="/schedule">Event schedule</Link>
      <Link href="/shifts">Shifts</Link>
      <Link href="/participation">Participation</Link>
      <Link href="/invites">Invites</Link>
      <Link href="/applications">Applications</Link>
      <Link href="/contribution">Contribution</Link>
      <Link href="/feedback">Feedback</Link>
      <Link href="/profile">Profile</Link>
      <Link href="/settings">Settings</Link>
      <span style={{ marginLeft: "auto", color: "#666" }}>{memberName}</span>
      <form action="/api/auth/logout" method="post">
        <button type="submit">Log out</button>
      </form>
    </nav>
  );
}

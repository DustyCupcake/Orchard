import Link from "next/link";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That login link is missing its token.",
  invalid_or_expired: "That login link is invalid or has expired — request a new one.",
  no_account: "No account found for that email. If you have an invite link, use it — otherwise, get in touch below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Log in to Orchard</h1>
      {error && ERROR_MESSAGES[error] && (
        <p style={{ color: "crimson" }}>{ERROR_MESSAGES[error]}</p>
      )}
      <LoginForm />
      {error === "no_account" && (
        <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
          <Link href="/inquiry">Send us a message</Link> and someone will get back to you.
        </p>
      )}
    </main>
  );
}

import Link from "next/link";
import { getOrCreateCommunity } from "@/lib/community";
import { isOidcConfigured } from "@/lib/oidc";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

const ERROR_MESSAGES: Record<string, string> = {
  missing_token: "That login link is missing its token.",
  invalid_or_expired: "That login link is invalid or has expired — request a new one.",
  no_account: "No account found for that email. If you have an invite link, use it — otherwise, get in touch below.",
  oidc_not_configured: "Single sign-on isn't configured for this community.",
  oidc_state_missing: "That sign-in attempt expired or was tampered with — try again.",
  oidc_error: "Something went wrong signing in with Zitadel — try again.",
  oidc_not_authorized:
    "You're signed in to Zitadel, but don't have the role needed for an Orchard account. Contact an admin if you think this is wrong.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const community = await getOrCreateCommunity();
  const oidcOn = isOidcConfigured(community);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480 }}>
      <h1>Log in to Orchard</h1>
      {error && ERROR_MESSAGES[error] && (
        <p style={{ color: "crimson" }}>{ERROR_MESSAGES[error]}</p>
      )}
      <LoginForm />
      {oidcOn && (
        <p style={{ marginTop: "1rem" }}>
          <a href="/api/auth/oidc/login">Sign in with Zitadel</a>
        </p>
      )}
      {error === "no_account" && (
        <p style={{ marginTop: "1rem", fontSize: "0.9rem" }}>
          <Link href="/inquiry">Send us a message</Link> and someone will get back to you.
        </p>
      )}
    </main>
  );
}

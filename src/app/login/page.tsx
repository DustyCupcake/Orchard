import Link from "next/link";
import { getOrCreateCommunity } from "@/lib/community";
import { isOidcConfigured } from "@/lib/oidc";
import { Banner, BUTTON_SECONDARY } from "@/components/ui/kit";
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
    <main className="mx-auto max-w-[480px] px-6 py-16">
      <h1 className="text-[32px] font-semibold leading-tight text-[var(--text)]">Log in to Orchard</h1>

      {error && ERROR_MESSAGES[error] && (
        <div className="mt-4">
          <Banner tone="danger">{ERROR_MESSAGES[error]}</Banner>
        </div>
      )}

      <div className="mt-6">
        <LoginForm />
      </div>

      {oidcOn && (
        <div className="mt-4">
          <a href="/api/auth/oidc/login" className={BUTTON_SECONDARY}>
            Sign in with Zitadel
          </a>
        </div>
      )}

      {error === "no_account" && (
        <p className="mt-4 text-[13px] text-[var(--text-muted)]">
          <Link href="/inquiry" className="text-[var(--accent-1)] hover:underline">
            Send us a message
          </Link>{" "}
          and someone will get back to you.
        </p>
      )}
    </main>
  );
}
